# Authentication & Onboarding

End-to-end documentation of how a user goes from "not signed in" to "owns a registered, named, on-chain personal agent" via the three supported login methods.

- **Path A — Google OAuth** (`session.via='google'`)
- **Path B — Passkey / WebAuthn** (`session.via='passkey'`)
- **Path C — MetaMask / SIWE** (`session.via='siwe'`)

A fourth path, demo users (`session.via='demo'`), is excluded from this doc; demo agents are pre-seeded by `scripts/seed-*.sh` and skip most server actions.

---

## 1. Conceptual model

Every authenticated user converges on the same logical identity:

```
┌─────────────────────────────┐     ┌────────────────────────────────┐
│  Login factor (per method)  │ ──► │  AgentAccount (ERC-4337)       │
│                             │     │  = "Personal Agent"            │
│  - Google ID token          │     │                                │
│  - Passkey (WebAuthn P-256) │     │  registered in:                │
│  - MetaMask EOA (SIWE)      │     │   - AgentAccountResolver       │
└─────────────────────────────┘     │   - AgentNameRegistry/Resolver │
                                    └────────────────────────────────┘
```

What differs across paths is **which EOA becomes the smart account's first `_owner`**, and **where the salt comes from**:

| Method | Initial owner EOA | Salt source | `walletAddress` in DB | User-controlled EOA? |
|---|---|---|---|---|
| Google | server deployer (`DEPLOYER_PRIVATE_KEY`) | `sha256(SERVER_PEPPER ‖ lower(email) ‖ rotation)` | = smart account | no |
| Passkey | server deployer | `keccak256(credIdHex ‖ now).slice(0,18)` (random per signup) | = smart account | no |
| MetaMask (SIWE) | **user's actual EOA** | `0` (constant) | = user's EOA | yes |

`users.walletAddress` is `NOT NULL UNIQUE` in the schema. For OAuth/passkey users with no separate EOA it is set to the smart account address; for SIWE users it is the MetaMask EOA, distinct from `smartAccountAddress`. This drives several auth-method-specific branches in onboarding.

---

## 2. Path A — Sign in with Google

### 2.1 Files

| File | Role |
|---|---|
| `apps/web/src/app/sign-in/SignInClient.tsx` | "Sign in with Google" link |
| `apps/web/src/app/api/auth/google-start/route.ts` | Issue state+nonce cookies, redirect to Google `/authorize` |
| `apps/web/src/lib/auth/google-oauth.ts` | OAuth helpers + `deriveSaltFromEmail` |
| `apps/web/src/app/api/auth/google-callback/route.ts` | Exchange code, decode id_token, deploy account, mint session, redirect |
| `apps/web/src/app/passkey-enroll/PasskeyEnrollClient.tsx` | Optional post-Google ceremony: enroll first passkey + recovery delegation |
| `apps/web/src/lib/actions/passkey/enroll-oauth.action.ts` | Server side of that ceremony |

### 2.2 Step-by-step

1. **User clicks "Sign in with Google"**. Plain `<a href="/api/auth/google-start">` — no JS.
2. **`GET /api/auth/google-start`**:
   - Generate `state` and `nonce` (32 bytes URL-safe base64).
   - Set `sa-oauth-state`, `sa-oauth-nonce`, `sa-oauth-intent` cookies (`httpOnly`, `lax`, 10-minute TTL).
   - Redirect to Google's authorize URL with `response_type=code`, `scope=openid email profile`, `prompt=select_account`.
3. **Google authenticates the user**, redirects back to `GOOGLE_REDIRECT_URI` (`/api/auth/google-callback`) with `?code=…&state=…`.
4. **`GET /api/auth/google-callback`**:
   - Verify `state` cookie matches Google's echo (CSRF defense).
   - `exchangeCode` POSTs the code to Google's `/token` with `client_secret`. TLS + `client_secret` authenticates Google to us. Response includes `id_token`.
   - `decodeAndVerifyIdToken`: base64url-decode JWT body, check `iss ∈ {accounts.google.com, https://accounts.google.com}`, `aud === GOOGLE_CLIENT_ID`, `exp > now`, `nonce === nonceCookie`, `email_verified !== false`. Signature is **not** verified locally because TLS+client_secret already authenticated the issuer.
   - **Derive deterministic salt**: `salt = BigInt(sha256(SERVER_PEPPER ‖ lower(email) ‖ rotation))`. Same email + same rotation ⇒ same smart account address forever.
   - **Deploy smart account**: `factory.createAccount(serverEOA, salt)`. Idempotent — `deploySmartAccount` checks `getCode` first.
   - **Upsert user row**: `users.id = "gsub:${sub}"`, `privyUserId = "did:google:${sub}"`, `walletAddress = smartAccountAddress`, `privateKey = null`.
   - **Mint session JWT** with `via='google'`, set `smart-agent-session` cookie (HS256 with `SESSION_JWT_SECRET`, 30-day TTL, `httpOnly + sameSite=lax`).
   - **Redirect**:
     - `intent=recover` → `/recover-device`
     - `!onboardingComplete` → `/onboarding`
     - `passkeyCount === 0n` → `/passkey-enroll`
     - else → `/catalyst`
5. **First-time user**: lands on `/onboarding` (see §5).
6. **Optional `/passkey-enroll`**: a two-ceremony enrollment that adds the user's first passkey to the account and persists a recovery delegation. See §6.

### 2.3 Final state for a Google user

- On-chain: `AgentAccount` with `_owners = [serverEOA]`, optional `_passkeys[digest]`, registered in resolver, `.agent` name registered.
- DB: `users` row, optional `passkeys` row, optional `recovery_delegations` row.
- Session cookie: `via=google`, `sub=did:google:<sub>`.
- The user has **no EOA they control**. The "EOA" backing their account on-chain is the server's deployer.

---

## 3. Path B — Sign up / Sign in with Passkey

### 3.1 Files

| File | Role |
|---|---|
| `apps/web/src/app/sign-up/SignUpClient.tsx` | First-time passkey signup UI |
| `apps/web/src/app/api/auth/passkey-signup/route.ts` | Server side: deploy account + addPasskey UserOp |
| `apps/web/src/app/sign-in/SignInClient.tsx` | "Sign in with passkey" UI |
| `apps/web/src/app/api/auth/passkey-challenge/route.ts` | Issues random challenge + JWT token |
| `apps/web/src/app/api/auth/passkey-verify/route.ts` | Verifies via on-chain `isValidSignature` (ERC-1271) |

### 3.2 Sign-up (first time)

1. User picks a display name in `/sign-up` and clicks "Sign up with passkey".
2. **`navigator.credentials.create()`** with `pubKeyCredParams: [-7, -257]`, `residentKey: 'preferred'`, `rp.id = window.location.hostname`. The browser surfaces the OS picker (TouchID, Windows Hello, hybrid QR for phone). User authenticates; browser returns an attestation.
3. `parseAttestationObject` (in SDK) extracts:
   - `credentialIdBase64Url` (raw credentialId, base64url-encoded)
   - `pubKeyX`, `pubKeyY` (decimal strings of the P-256 public key components)
4. POST to **`/api/auth/passkey-signup`**:
   - `credentialIdDigest = keccak256(credIdBytes)` — used as the on-chain key under `_passkeys[digest]`.
   - **Salt** = `BigInt(keccak256(`${credIdHex}${Date.now()}`)).slice(0,18)` — random per signup.
   - **Deploy smart account** via `factory.createAccount(deployer, salt)`. Owner = deployer.
   - Pre-fund via `anvil_setBalance` (dev only) so EntryPoint prefund clears.
   - **Build a UserOp** `account.execute(account, 0, addPasskey(digest, x, y))`, signed by deployer (sole owner at this moment).
   - Pack via `toPackedUserOperation`, submit via a separate relayer EOA's `EntryPoint.handleOps`.
   - On revert, surface `UserOperationRevertReason`. Otherwise continue.
   - Insert `users` row: `id = credIdHex`, `privyUserId = did:passkey:${chainId}:${accountAddr}`, `walletAddress = accountAddr`, `smartAccountAddress = accountAddr`, `privateKey = null`.
   - Mirror credential to `passkeys` table.
   - Mint session JWT `via='passkey'`, set cookie.
5. Browser redirects to `/catalyst` (or `/onboarding` if profile incomplete).

The deployer **remains** as an owner of the account post-signup so future server-relayed UserOps still work.

### 3.3 Sign-in (returning passkey user)

1. User clicks "Sign in with passkey".
2. **`GET /api/auth/passkey-challenge`** → `{ challenge, token }`. The JWT binds the challenge so the verifier knows it wasn't replayed.
3. Browser reads `localStorage["smart-agent.passkeys.local"]` (hint of credentialIds the user signed up on this device) and calls `navigator.credentials.get({ publicKey: { challenge, rpId, allowCredentials: hints } })`. OS picker fires.
4. POST `/api/auth/passkey-verify` with: `token, challenge, credentialIdBase64Url, authenticatorData, clientDataJSON, signature` (all base64url).
5. Server:
   - `verifyPasskeyChallenge(token, challenge)` — JWT signature + nonce match + TTL.
   - Lookup user: prefer `passkeys` table; fallback to legacy `users.id == credIdHex`.
   - Locate `accountAddr = users.smartAccountAddress`.
   - Pack the assertion as `0x01 || abi.encode(WebAuthnLib.Assertion)` — exactly what `AgentAccount._verifyWebAuthn` expects.
   - **Verify by calling `AgentAccount.isValidSignature(challengeHash, packedSig)`** on-chain. If it returns `0x1626ba7e` (ERC-1271 magic value), the passkey signature is valid.
   - On success: mint `via='passkey'` session JWT, set cookie.

The auth server does **no client-side P-256 math**. It hands the proof to the on-chain ERC-1271 path, which routes through the same `_verifyWebAuthn → WebAuthnLib.verify → P256Verifier` stack used for UserOp validation. Single source of truth.

---

## 4. Path C — Sign in with MetaMask (SIWE)

### 4.1 Files

| File | Role |
|---|---|
| `apps/web/src/app/sign-in/SignInClient.tsx` | "Sign in with Ethereum" button |
| `apps/web/src/app/api/auth/siwe-challenge/route.ts` | Build EIP-4361 message + challenge JWT |
| `apps/web/src/app/api/auth/siwe-verify/route.ts` | Verify ECDSA, deploy account if first-time, mint session |

### 4.2 Step-by-step

1. **User clicks "Sign in with Ethereum"**:
   - `eth_requestAccounts` → MetaMask prompts user, returns address.
   - `GET /api/auth/siwe-challenge?domain=…&address=…`. Server builds canonical EIP-4361 message:
     ```
     <domain> wants you to sign in with your Ethereum account:
     <address>

     Sign in to Smart Agent.

     URI: https://<domain>
     Version: 1
     Chain ID: <chain>
     Nonce: <hex>
     Issued At: <iso>
     ```
   - Returns `{ message, nonce, token }`. Token is a 10-minute JWT (`kind=passkey-challenge`, repurposed) that commits to the nonce.
2. Browser calls `personal_sign(message, address)` on MetaMask. User confirms in MetaMask popup.
3. POST `/api/auth/siwe-verify` with `{ token, message, signature, address }`:
   - CSRF guard on `Origin` header.
   - Extract nonce from message, `verifySiweChallengeToken(token, nonce)`.
   - Confirm message line-2 (the address per SIWE spec) matches `body.address`.
   - **Verify the signature** via `verifyMessage({ address, message, signature })` (viem's standard EIP-4361 verification — handles the EIP-191 prefix internally).
   - **First-time user (no row matching `walletAddress = lower(eoa)`)**:
     - **Salt = `0n`** (constant for SIWE).
     - **Initial owner = the user's MetaMask EOA itself** (not the deployer): `factory.getAddress(eoa, 0n)` predicts the smart account; if `getCode === '0x'`, deployer signs `factory.createAccount(eoa, 0n)`.
     - `users` row: `id = eoaLower`, `walletAddress = eoaLower` (the user's real EOA), `smartAccountAddress = smartAcct`, `privyUserId = did:ethr:${chainId}:${eoaLower}`.
     - Top up smart account balance via `anvil_setBalance` (dev only).
   - Returning user: just look up the row.
   - Mint session JWT `via='siwe'`, set cookie.

### 4.3 Distinctive properties

- The **only auth method that gives the user a real, user-controlled EOA**.
- The smart account's first `_owner` is the user's MetaMask address. They can sign `personal_sign` and `eth_signTypedData` directly with MetaMask, and any dApp that respects ERC-1271 can verify those against the smart account.
- They can optionally enroll a passkey later via `/settings/passkeys` for a second signing factor; the MetaMask EOA stays in `_owners`.
- They do **not** go through the OAuth Phase-2 enrollment dance; their EOA is already a non-custodial signer.

---

## 5. Personal Agent (Smart Account)

The on-chain artifact is `AgentAccount` (`packages/contracts/src/AgentAccount.sol`):

- **ERC-4337 v0.7 account** — `validateUserOp`, `execute`, paid via EntryPoint.
- **Multi-signer** — `_owners` (ECDSA) + `_passkeys[digest] → (X, Y)` (WebAuthn). `_validateSig` dispatcher routes by signature type byte: `0x00` → ECDSA, `0x01` → WebAuthn.
- **ERC-1271** — `isValidSignature` shares the same dispatcher, with ERC-6492 unwrapping for pre-deploy signatures.
- **Self-call admin** — `addOwner`, `removeOwner`, `addPasskey`, `removePasskey` are `onlySelf`. Authority changes only via UserOps signed by an existing signer.
- **Multi-signer invariant** — `removeOwner` reverts with `CannotRemoveLastSigner` if `_ownerCount == 1 && _passkeyStorage().count == 0`.

### 5.1 Deployment

`apps/web/src/lib/contracts.ts` — `deploySmartAccount(owner, salt)`:

1. `getSmartAccountAddress(owner, salt)` — predicts the CREATE2 address via `factory.getAddress`.
2. `getCode(address)` — return early if already deployed (idempotent).
3. `factory.createAccount(owner, salt)` — deploys a UUPS proxy pointing at the `AgentAccount` implementation, with `owner` as the initial single ECDSA owner.

### 5.2 Process-wide deployer lock

`getWalletClient` wraps the deployer's `writeContract` and `sendTransaction` in `withDeployerLock`. Reason: every server-side write uses the same deployer key, and viem fetches the next nonce only after the previous tx has been broadcast. Without serialization, two concurrent server flows race and one gets "replacement transaction underpriced." The lock holds across the entire Node process via `globalThis` so dev-mode HMR can't fragment it.

### 5.3 Why the deployer stays as an owner

For all three paths the deployer ends up in `_owners` after signup, and stays there because:

- **Resolver writes** (`AgentAccountResolver`, `AgentNameRegistry`, `AgentNameResolver`) gate every state-changing call with `onlyAgentOwner` (= `agent.isOwner(msg.sender)` ECDSA-only). Without an ECDSA owner the deployer can't write metadata for the user.
- The **Phase 4 repair flow** (`apps/web/src/lib/actions/onboarding/repair-account.action.ts`) exists to re-add the deployer for legacy accounts that did remove it.
- Long-term, those gates would be replaced by ERC-1271 / passkey-signed resolver writes; until then, "deployer co-owner" is the pragmatic default.

---

## 6. Phase 2 — Optional passkey enrollment for OAuth users

Path: `/passkey-enroll`. Only for `session.via === 'google'`. Three-step browser dance + recovery delegation.

### 6.1 Step A — Browser creates a passkey

`navigator.credentials.create()` mints a fresh P-256 passkey (alg `-7` = ES256). `parseAttestationObject` extracts `credentialIdBase64Url`, `pubKeyX`, `pubKeyY`.

### 6.2 Step B — Server adds the passkey on-chain

`enrollOAuthAddPasskeyAction` (`apps/web/src/lib/actions/passkey/enroll-oauth.action.ts`):

- `credentialIdDigest = keccak256(credIdBytes)`.
- Build UserOp `account.execute(account, 0, addPasskey(digest, x, y))`, signed by **server EOA** (still in `_owners`).
- Submit via relayer → `EntryPoint.handleOps`.
- Mirror credential into the `passkeys` table.
- Build a `RecoveryEnforcer` delegation (`account` → `serverEOA`, with caveats `[Recovery, AllowedTargets, AllowedMethods]`). Return its EIP-712 hash for the client to sign.

### 6.3 Step C — Browser passkey signs the delegation

`navigator.credentials.get(challenge=delegationHash, allowCredentials=[newCredId])`. The new passkey signs the delegation hash. Result is packed as `0x01 || abi.encode(Assertion)` — the WebAuthn type byte the contract dispatcher recognizes.

### 6.4 Step D — Server persists the delegation

`enrollOAuthFinalizeAction`:

- Persist signed delegation into `recovery_delegations` table.
- The `removeOwner(serverEOA)` step is **deliberately skipped** because resolver writes still need an ECDSA owner. The "true non-custody" lift is gated behind a future Phase 4 ERC-1271 resolver migration.

After enrollment the account has `_owners=[serverEOA]` plus `_passkeys[digest]`. The user can sign UserOps with their passkey directly; the server can still write resolver records on their behalf.

---

## 7. Onboarding (`/onboarding`)

UI: `apps/web/src/app/(authenticated)/onboarding/OnboardingClient.tsx`. Wizard with 4 steps for non-demo users, 2 for demo:

- Real users: `profile → register → name → choose`
- Demo users: `profile → choose` (registry + name pre-seeded)

Server actions are idempotent — partial completion plus reload picks up where the user left off via `getOnboardingStatus`.

### 7.1 Step 1 — Profile

Form: name + email. Submits `PUT /api/auth/profile`. Updates `users.name` and `users.email`. Required to be non-empty and not the placeholder `"Agent User"`.

### 7.2 Step 2 — Register the agent

Auto-runs on mount. Pre-flight via `prepareReAuthBootstrapAction`:

- Checks if `account.isOwner(serverEOA)`.
- Yes (common case): proceed to `ensurePersonAgentRegistered`.
- No (legacy stuck account): surface "Authorize with passkey" CTA, run the **Phase 4 repair flow** (passkey-signed UserOp that re-adds the server EOA via `addOwner`), then proceed.

`ensurePersonAgentRegistered`:

- Reads `AgentAccountResolver.isRegistered(smartAcct)`. Idempotent skip if already registered.
- Calls `registerAgentMetadata({ agentAddress: smartAcct, displayName: <user.name>, description: '', agentType: 'person' })`.
- For SIWE users only (where `walletAddress !== smartAccountAddress`): `addAgentController(smartAcct, walletAddress)` to mark the user's MetaMask EOA as a controller of the agent. For OAuth/passkey users this is skipped because their `walletAddress === smartAccountAddress`.

### 7.3 Step 3 — Pick `.agent` name

Two modes:

- **Root**: `<label>.agent`. Free, anyone can claim an unused root.
- **Hub**: `<label>.<hub>.agent` where `<hub>` is one of the hubs returned by `listHubsForOnboarding` (every active `TYPE_HUB` agent in the resolver that has `ATL_PRIMARY_NAME` set).

`registerPersonalAgentName`:

1. Normalise label, compute `parentNode = namehash(parentName)` and `childNode = keccak256(parentNode, labelhash)`.
2. **Idempotency**: if the child already exists, check it resolves to this account. If yes, fall through and re-set metadata; if no, fail with "name already taken."
3. **Tx sequence (deployer-signed, each awaited)**:
   1. `AgentNameRegistry.register(parentNode, label, accountAddr, resolver, 0)` — claim the name.
   2. `AgentNameResolver.setAddr(childNode, accountAddr)` — forward record.
   3. `AgentAccountResolver.setStringProperty(accountAddr, ATL_NAME_LABEL, label)`.
   4. `AgentAccountResolver.setStringProperty(accountAddr, ATL_PRIMARY_NAME, fullName)`.
4. **DB mirror**: `users.agentName = fullName`. Fallback for stuck accounts where resolver writes (3, 4) revert.
5. **Failure handling**: each resolver write that reverts with `NotAgentOwner` is captured into `writeWarnings` and surfaced in the UI; the registry record is treated as the source of truth.

### 7.4 Step 4 — Choose

`ChooseStep`: pick a destination (e.g., catalyst dashboard) or join a hub.

- **`joinHubAsPerson(hubAddress)`**: validates `agentType === TYPE_HUB && active`, then `createRelationship(hub, person, [ROLE_MEMBER], HAS_MEMBER)` followed by `confirmRelationship(edgeId)`. Both deployer-signed.
- **`onPick(target)`**: `markOnboardingComplete()` (sets `users.onboardedAt`), hard-navigate.

`markOnboardingComplete` is the master gate. The `(authenticated)` layout reads `users.onboardedAt`; if set, the user is never bounced back to `/onboarding` even if some downstream resolver writes failed.

---

## 8. Sessions, cookies, and the unified principal

All three paths converge on the same session model:

- **Cookie**: `smart-agent-session`, HS256 JWT signed with `SESSION_JWT_SECRET`, 30-day TTL, `httpOnly + sameSite=lax`. Defined in `apps/web/src/lib/auth/native-session.ts`.
- **Claims**: `{ sub, walletAddress, smartAccountAddress, name, email, via, kind: 'session' }` where `via ∈ {google, passkey, siwe, demo}`.
- **Server-side resolution**: `requireSession()` → `getCurrentUser()` → DB lookup by `users.privyUserId === session.userId`.

Auth-method-specific code is limited to:

- The **OAuth-only path guard** in `enrollOAuthAddPasskeyAction` — only Google users go through the two-step passkey enrollment.
- The **`walletAddress !== smartAccountAddress` branch** in `ensurePersonAgentRegistered` — only SIWE users have a separate EOA to add as controller.
- **`signWalletAction`** in `apps/web/src/lib/ssi/signer.ts` — currently only works for demo users (it uses `privateKeyToAccount(userRow.privateKey)`). SIWE/Google/passkey users can't sign SSI WalletActions through this path; this is the SSI integration gap.

---

## 9. Lifecycle summary

### 9.1 What's deployed and when

| Path | At sign-in/up | After onboarding step 2 | After onboarding step 3 |
|---|---|---|---|
| Google | AgentAccount deployed; `_owners=[serverEOA]` | + Resolver `register`, metadata properties | + AgentNameRegistry record, `ATL_PRIMARY_NAME`, `ATL_NAME_LABEL` |
| Passkey | AgentAccount deployed; `_owners=[serverEOA]`; `_passkeys[digest]` | + same | + same |
| SIWE | AgentAccount deployed; `_owners=[userEOA]` | + same; `addAgentController(userEOA)` | + same |

### 9.2 EOA semantics per path

| Property | Google | Passkey | SIWE |
|---|---|---|---|
| User has private key? | no | no (uses passkey) | yes (MetaMask) |
| Initial `_owners[0]` | `serverEOA` | `serverEOA` | `userEOA` |
| Can sign UserOps without server? | no (until passkey added) | yes (after addPasskey) | yes (MetaMask) |
| `walletAddress` in DB | smartAccountAddress | smartAccountAddress | userEOA |
| `smartAccountAddress` in DB | smartAccountAddress | smartAccountAddress | smartAccountAddress |
| `did:` prefix | `did:google:<sub>` | `did:passkey:<chain>:<acct>` | `did:ethr:<chain>:<eoa>` |
| Salt | `sha256(pepper‖email‖rotation)` | random per signup | `0` |

### 9.3 File reference

| Stage | Files |
|---|---|
| Login UI | `app/sign-in/SignInClient.tsx`, `app/sign-up/SignUpClient.tsx` |
| Google OAuth | `app/api/auth/google-{start,callback}/route.ts`, `lib/auth/google-oauth.ts` |
| Passkey signup | `app/api/auth/passkey-signup/route.ts` |
| Passkey signin | `app/api/auth/passkey-{challenge,verify}/route.ts` |
| SIWE | `app/api/auth/siwe-{challenge,verify}/route.ts` |
| Session | `lib/auth/native-session.ts`, `lib/auth/session.ts`, `lib/auth/jwt.ts` |
| Account deployment | `lib/contracts.ts` (`deploySmartAccount`, `getSmartAccountAddress`) |
| Phase 2 enroll | `app/passkey-enroll/PasskeyEnrollClient.tsx`, `lib/actions/passkey/enroll-oauth.action.ts` |
| Phase 4 repair | `lib/actions/onboarding/repair-account.action.ts` |
| Onboarding | `app/(authenticated)/onboarding/OnboardingClient.tsx`, `lib/actions/onboarding/setup-agent.action.ts` |
| Resolver writes | `lib/agent-resolver.ts`, `lib/actions/agent-metadata.action.ts` |
| Name registration | `setup-agent.action.ts:registerPersonalAgentName` |
| DB schema | `db/schema.ts` (`users`, `passkeys`, `recovery_delegations`, `recovery_intents`) |

---

## 10. End-to-end happy-path diagram (Google)

```
User           Browser           web (Next.js)        chain                 Google
 │               │                    │                  │                     │
 │  click "Sign in with Google"      │                  │                     │
 │ ─────────────►│                    │                  │                     │
 │               │ GET /google-start  │                  │                     │
 │               │ ─────────────────► │                  │                     │
 │               │                    │ set state/nonce  │                     │
 │               │ ◄ 302 Google /auth │                  │                     │
 │               │ ──────────────────────────────────────────────────────────► │
 │ Google login  │                                                              │
 │               │ ◄ 302 /google-callback?code=…                               │
 │               │ ─────────────────► │                                        │
 │               │                    │ POST /token  ───────────────────────► │
 │               │                    │ ◄ id_token                            │
 │               │                    │ verify aud/iss/nonce                  │
 │               │                    │ deriveSaltFromEmail(email,0)          │
 │               │                    │ deploySmartAccount ──► factory.createAccount(serverEOA, salt)
 │               │                    │                  │   tx mined         │
 │               │                    │ upsert users     │                     │
 │               │                    │ mintSession      │                     │
 │               │ ◄ 302 /onboarding (cookie)            │                     │
 │               │ ─────────────────► │                  │                     │
 │               │                    │ getOnboardingStatus → step=profile    │
 │ enter name+email                                                             │
 │               │ PUT /auth/profile                                            │
 │               │ ─────────────────► │ update users    │                     │
 │ wizard → register step (auto)                                                │
 │               │ prepareReAuthBootstrap → already owner: true               │
 │               │ ensurePersonAgentRegistered ──► resolver.register, metadata
 │ wizard → name step                                                            │
 │ pick "joe.agent"                                                              │
 │               │ registerPersonalAgentName ──► nameRegistry.register, nameResolver.setAddr, resolver.setString×2
 │               │                    │ users.agentName = "joe.agent"          │
 │ wizard → choose step                                                          │
 │ pick destination                                                              │
 │               │ markOnboardingComplete (users.onboardedAt = now)             │
 │               │ ─────► /catalyst (cookie still valid)                        │
 │ landing page  │                                                              │
 │ optional: /passkey-enroll for first passkey                                  │
 │               │ navigator.credentials.create()                               │
 │               │ enrollOAuthAddPasskeyAction → UserOp addPasskey (deployer-signed) → handleOps
 │               │ navigator.credentials.get(challenge=delegationHash)         │
 │               │ enrollOAuthFinalizeAction → DB.recovery_delegations, removeOwner deliberately skipped
 │ done.                                                                         │
```

---

## 11. Operational notes

- **`SERVER_PEPPER` change**: rotates every Google user's account address. There is no migration. Treat as immutable in production.
- **`DEPLOYER_PRIVATE_KEY` rotation**: every account's `_owners` would point to the old deployer; new deployer can't write resolver records. Need a per-account `addOwner(newDeployer); removeOwner(oldDeployer)` migration via UserOps signed by something the user controls.
- **Bundler-less environments**: `passkey-signup` and `enroll-oauth` use a server-held relayer EOA + `EntryPoint.handleOps` directly (no bundler). Production needs either real bundler infra or this same self-relay pattern.
- **Anvil-only fast paths**: `anvil_setBalance` is used to top up smart accounts in dev. On real chains the user (or paymaster) must fund the account before its first UserOp.
- **Sequential resolver writes**: `registerAgentMetadata` and `registerPersonalAgentName` each issue 4–5 sequential `writeContract`+`waitForTransactionReceipt` pairs. That's the bulk of onboarding latency and the main optimization target (multicall, batched broadcast, async await).
- **Stuck-state accounts**: legacy passkey-only accounts trigger the Phase 4 repair flow on next onboarding load. The repair UserOp is passkey-signed; the user must have at least one passkey enrolled or the repair is impossible.
- **DB mirrors as fallbacks**: `users.agentName`, `users.smartAccountAddress`, `passkeys` rows. All three are best-effort, never block user flow, used only as fallbacks/lookups.

---

## 12. Per-persona summary

**Google user** — TLS-authenticated email becomes a deterministic salt. The server's deployer EOA becomes the smart account's first owner. Optional passkey enrollment adds a non-custodial signer; deployer remains co-owner so resolver writes still work.

**Passkey-first user** — A fresh WebAuthn keypair is registered into the contract via a deployer-signed UserOp. Account address is randomized per signup. Login is "browser proves possession of the passkey, server verifies via on-chain `isValidSignature`." No EOA in the user's hands.

**MetaMask user** — User signs SIWE with their EOA. That EOA becomes the smart account's first owner, with `salt=0`. The only path where the user controls a real EOA. Smart account is deployed on-the-fly during first SIWE login.

**All three** then run the same onboarding wizard: profile → register agent in `AgentAccountResolver` → claim a `.agent` name in `AgentNameRegistry` → choose destination, mark onboarded. The session model (`smart-agent-session` JWT cookie) is unified; the only auth-method-specific code is in (a) the post-auth callback that deploys the account, (b) the OAuth-only passkey enrollment ceremony, and (c) the SIWE-only `addAgentController(userEOA)` step in onboarding.
