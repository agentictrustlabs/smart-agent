# AnonCreds and `person-mcp`

End-to-end documentation of how Smart Agent issues, stores, and presents
AnonCreds credentials. The system splits authority across `apps/web`
(UI + signer), `apps/person-mcp` (consent gateway, PII gateway, and
cryptographic holder vault), and an on-chain `CredentialRegistry` for
schema/credDef provenance.

This document covers:

- the conceptual model and trust split
- service topology + component layout
- storage layout per service
- object-interaction (sequence) diagrams for each privileged flow
- anti-correlation properties and policy layers
- a file-reference index

---

## 1. Conceptual model

### 1.1 What is AnonCreds here

AnonCreds-v1 (Hyperledger) gives us **selective disclosure**, **predicate
proofs** (e.g. "minorBirthYear ≥ 2006"), and **link secrets** (per-holder
secrets that bind every credential the holder owns and let them prove "all
these credentials are mine" without ever revealing the link secret itself).

The native `anoncreds-rs` binding is loaded once in the MCP process via
`AnonCreds.registerNativeBinding`. All holder-side cryptography (link secret
creation, credential request build, credential processing, presentation
creation) runs **inside `apps/person-mcp`** — never in the web app.

### 1.2 Runtime split


| Layer            | Process               | What it owns                                                                                             | What it never sees                                            |
| ---------------- | --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| UI + holder signer | `apps/web` (Next.js)  | User session, browser-side passkey ceremony for `WalletAction` envelopes (EIP-712 hash → WebAuthn assertion) | Link secrets, raw credentials, attribute values, passkey private key |
| Combined MCP     | `apps/person-mcp`     | Builds unsigned `WalletAction`s, re-verifies signatures, writes audit/metadata, gates PII via delegation, manages the encrypted holder vault, link secrets, credentials, and AnonCreds operations | The user's passkey private key or browser authenticator secret |


The split means a compromise of `apps/web` cannot reveal credentials or link
secrets. `apps/person-mcp` holds the vault, but it still cannot spend or sign
as the user: every privileged SSI action requires a signed, replay-protected
`WalletAction` whose passkey signature is verified through the user's
`AgentAccount`.

### 1.3 Vocabulary and the credential-kinds registry

Smart Agent has three kinds of "this agent claims something" objects.
We use a deliberately consistent vocabulary so the UI can teach all
three with one mental model.

| Noun           | Where it lives                              | What it is                                                  |
| -------------- | ------------------------------------------- | ----------------------------------------------------------- |
| **Relationship** | `AgentRelationship` on chain              | Public link between two agents (membership, alliance, …)   |
| **Geo claim**    | `GeoClaimRegistry` on chain               | Public link from an agent to a `.geo` feature              |
| **Credential**   | Holder Askar vault                        | Private AnonCred — invisible until you present it           |

Verbs:

- **Publish** — write the public on-chain version (relationship / geo
  claim).
- **Get / Request** — receive an AnonCred into the vault.
- **Verify / Present** — submit a vault credential to a verifier.

Every AnonCred kind Smart Agent supports is described by a single
**`CredentialKindDescriptor`** in
`packages/sdk/src/credential-types.ts`. The registry is pure data
— `credentialType`, `schemaId`, `credDefId`, `attributeNames`,
`displayName`, `noun`, `description`, `issuerKey`. Both the web app
and `verifier-mcp` import from it, so issuance, vault display, and
verification stay in lockstep.

```
packages/sdk/src/credential-types.ts        ← single source of truth
       │
       ├── apps/web      — IssueCredentialDialog reads form by kind
       │                  HeldCredentialsPanel reads displayName
       │                  HubLayout dropdown auto-renders one entry per kind
       │
       └── apps/verifier-mcp — specs.ts pairs each kind with a buildRequest
                                + reveal/predicate selection
```

Adding a new credential kind:

1. Append a descriptor to `CREDENTIAL_KINDS`.
2. Add a React form in
   `apps/web/src/lib/credentials/forms/<KindName>Form.tsx` and
   register it in `apps/web/src/lib/credentials/registry.tsx`.
3. Add a `buildRequest` + selection in
   `apps/verifier-mcp/src/verifiers/specs.ts`.
4. Wire the issuer's `/credential/offer` and `/credential/issue`
   endpoints into `apps/web/src/lib/ssi/clients.ts` (one entry per
   `issuerKey`).

The dropdown menu, generic dialog, held-credentials display, and
verifier-mcp routes pick the new kind up automatically — no per-type
dialogs, no per-type web actions.

### 1.4 Trust roots


| Trust root                  | Source of truth                                                                                                                                                       | Verified by                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Holder identity             | **Passkey (primary)** — `AgentAccount` ERC-1271; signature is `0x01 ‖ abi.encode(WebAuthnLib.Assertion)` validated on-chain by `_verifyWebAuthn` → `P256Verifier`. Legacy EOA fallback (demo / SIWE only) — 65-byte secp256k1 ECDSA against `users.walletAddress`. | `verifyWalletAction` in `packages/privacy-creds/src/wallet-actions/verify.ts` — routes by signature shape: ERC-1271 `readContract.isValidSignature` for passkeys, `recoverTypedDataAddress` for EOA. |
| Schema / CredDef provenance | `CredentialRegistry.sol` events on-chain                                                                                                                              | `loadVerifiedSchema` / `loadVerifiedCredDef` (in `packages/credential-registry`)                                                                       |
| Issuer identity             | `did:ethr:<chainId>:<address>` matched against `msg.sender` of publish tx                                                                                             | Resolver + `IssuerAgent.ensureIssuerRegistered`                                                                                                        |
| Verifier identity           | EIP-191 signature over the presentation request                                                                                                                       | `apps/person-mcp` verifier registry logic (only enforced when `SSI_KNOWN_VERIFIERS` is set)                                                            |

Location-specific credential semantics, `.geo` feature binding, and
third-party verifier receipts are documented separately in
`docs/architecture/agent-location-credential.md`.

## 2. Service topology

### 2.1 Arch diagram — running processes

```
Browser
   │
   │ HTTPS (cookies, server-actions)
   ▼
┌──────────────────────────────────────────┐         ┌──────────────────────┐
│ apps/web                  :3000          │  HTTP   │ apps/a2a-agent :3100 │
│  - Next.js App Router                    ├────────►│  (mints delegation   │
│  - SignInClient / SignUpClient           │         │   tokens for PII)    │
│  - server actions in lib/actions/ssi/    │         └──────────┬───────────┘
│  - lib/ssi/signer.ts (passkey primary,   │                    │
│    EOA fallback for demo/SIWE)           │                    │ delegation
│  - lib/ssi/clients.ts                    │                    │ tokens
│    person/org/family/geo/verifier        │                    │
└────┬───────────┬─────────┬───────────────┘                    │
     │ /tools/*  │         │  /credential/* (issuers)           │
     │           │         │  /verify/*     (verifier-mcp)      │
     ▼           ▼         ▼                                    │
┌──────────────────────┐  ┌──────────────────────────────────┐  │
│ apps/person-mcp :3200│  │ Issuers (separate processes):    │  │
│  - HTTP + MCP stdio  │  │   apps/org-mcp     :3400          │  │
│  - SSI tools         │  │   apps/family-mcp  :3500 (also v) │  │
│  - PII tools         │  │   apps/geo-mcp     :3600          │  │
│  - audit sqlite      │  │ Each: IssuerAgent + /credential/* │  │
│  - holder_wallets    │  └────────────────┬─────────────────┘  │
│  - action_nonces     │                   │                    │
│  - credential_meta   │  ┌────────────────┴─────────────────┐  │
│  - Askar vault       │  │ apps/verifier-mcp :3700           │  │
│  - native anoncreds  │  │  third-party verifier (Trusted    │  │
└──────────┬───────────┘  │  Auditor)                         │  │
           │ readContract │  /verify/<credentialType>/request │  │
           │              │  /verify/<credentialType>/check   │  │
           │              │  · org-membership                 │  │
           │              │  · guardian                       │  │
           │              │  · geo-location                   │  │
           │              │  consumed-nonce sqlite            │  │
           │              │  (no on-chain writes)             │  │
           │              └────────────────┬─────────────────┘  │
           ▼                               ▼                    ▼
┌──────────────────────────────────────────────────────────────┐
│ EVM chain  (Anvil :8545)                                     │
│  - CredentialRegistry.sol     (schemas/credDefs)             │
│  - AgentAccount (ERC-1271 verify)                            │
│  - AgentNameRegistry (.agent/.geo/.pg)                       │
│  - GeoFeatureRegistry / GeoClaimRegistry                     │
│  - DelegationManager                                         │
└──────────────────────────────────────────────────────────────┘
```

Default ports come from `apps/web/src/lib/ssi/config.ts`. The
`verifier-mcp` is a single third-party verifier service that exercises
the AnonCreds proof path for every credential type — it never publishes
schemas or credDefs and is read-only against the on-chain registry.

### 2.2 Public surface per service


| Service                          | Routes                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `person-mcp`                     | `POST /tools/<toolName>` for `ssi_create_wallet_action`, `ssi_provision_wallet`, `ssi_start_credential_exchange`, `ssi_finish_credential_exchange`, `ssi_create_presentation`, `ssi_list_my_credentials`, `ssi_list_wallets`, `ssi_list_proof_audit`, `ssi_rotate_link_secret`, plus profile/identity/chat tools (delegation-gated). Internally owns holder-wallet, credential, proof, nonce, and vault modules. |
| `org-mcp` (issuer)               | `POST /credential/offer`, `POST /credential/issue`, OID4VCI endpoints                                                                                                                                                                                                                                                               |
| `family-mcp` (issuer + verifier) | `POST /credential/offer`, `POST /credential/issue`, `GET /verify/guardian/request`, `POST /verify/guardian/check`                                                                                                                                                                                                                   |
| `geo-mcp` (issuer)               | `POST /credential/offer` and `POST /credential/issue` for `GeoLocationCredential` — single steward across every `GeoFeature`. Holder authorisation is implicit: minting the on-chain `GeoClaim` is the consent signal, so no per-feature approval queue.                                                                                |
| `verifier-mcp` (third-party)     | `POST /verify/<credentialType>/request` and `/check` for `OrgMembershipCredential`, `GuardianOfMinorCredential`, `GeoLocationCredential`. Read-only against the on-chain registry; consumed-nonce sqlite enforces single-use presentations. Drives the dashboard's "Test verification" button. |


---

## 3. Authority and signing model

The holder's signing key is a **WebAuthn passkey** bound to their
`AgentAccount`. The browser runs the WebAuthn ceremony; the resulting
P-256 assertion is validated on-chain via ERC-1271. EOA signing exists only
as a fallback for demo / SIWE users who happen to already control a server-
or wallet-held secp256k1 key.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      Smart Agent SSI authority graph                     │
└──────────────────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────┐                   ┌──────────────┐
  │  Holder signer (one-of)            │                   │              │
  │                                    │                   │              │
  │  ▶ Passkey (primary)               │                   │              │
  │    P-256 / ES256 / RP-bound        │                   │              │
  │    navigator.credentials.get(      │                   │              │
  │      challenge = EIP-712 hash)     │                   │              │
  │    → 0x01 ‖ abi.encode(Assertion)  │                   │              │
  │                                    │ EIP-712 typed     │ WalletAction │
  │  · EOA fallback (demo / SIWE only) │ data signed ────► │ envelope     │
  │    secp256k1 65-byte ECDSA         │                   │              │
  │    privateKeyToAccount             │                   │              │
  │      .signTypedData()              │                   │              │
  └────────────────────────────────────┘                   └──────┬───────┘
                                                                  │
                                       submitted via              │
                                       person-mcp tools           │
                                                                  ▼
              ┌──────────────────────┐               ┌──────────────────────┐
              │ AgentAccount.sol     │               │ person-mcp           │
              │  isValidSignature?   │◄──────────────┤  SSI tools + vault   │
              │  ─ 0x00 ‖ ecdsa →    │  readContract │  verifyWalletAction  │
              │     owner check      │               │   ▸ shape-routes:    │
              │  ─ 0x01 ‖ Assertion →│               │     65 bytes  → ECDSA│
              │    _verifyWebAuthn → │               │     0x01 ‖ … → 1271  │
              │    WebAuthnLib       │               │     0x00 ‖ … → 1271  │
              │    → P256Verifier    │               │  runs anoncreds-rs   │
              └──────────────────────┘               └──────────┬───────────┘
                                                                │
                                                                │ unwraps DEK,
                                                                │ runs anoncreds-rs
                                                                ▼
                                                  ┌───────────────────────────┐
                                                  │ Askar vault (per profile) │
                                                  │  - link_secret/<id>       │
                                                  │  - credential/<id>        │
                                                  │  - credential_request/    │
                                                  └───────────────────────────┘
```

Three invariants live in this picture:

1. **Passkey signing is a client-side ceremony.** `apps/web` only computes
   the EIP-712 hash via `prepareWalletActionForPasskey` (in
   `apps/web/src/lib/ssi/signer.ts`); the browser runs
   `navigator.credentials.get({ challenge: hashToWebAuthnChallenge(hash) })`
   and `packWebAuthnSignature` packages the assertion as
   `0x01 ‖ abi.encode(WebAuthnLib.Assertion)`. The passkey private key
   never reaches Node — it lives in the platform authenticator
   (Secure Enclave / TPM / hybrid phone). Server-side flows that *require*
   a signature for an OAuth / passkey-only user always do a
   server → browser → server round trip.
2. **Link secrets never leave the vault module.** `person-mcp` has no tool
   for "give me the link secret" — it only exposes operations performed *with*
   the link secret.
3. **The same envelope, two signature shapes.** `person-mcp` does not
   care which signer produced the `WalletAction`; `verifyWalletAction`
   first asks `AgentAccount.isValidSignature` (covering both passkey and
   ECDSA owner shapes via the on-chain router) and falls back to
   `recoverTypedDataAddress` for the legacy demo/SIWE EOA-direct path.

> **EOA fallback in passing.** Demo users have a server-stored
> `users.privateKey` (only used for scripted seeds and tests). SIWE users
> hold their secp256k1 key in MetaMask. Both paths produce a plain 65-byte
> ECDSA signature against `users.walletAddress`. They exist because they
> existed before passkey was wired in; the production sign-in flow on
> Google / Passkey / OAuth does **not** use them.

### 3.1 The `WalletAction` envelope

EIP-712 typed data, defined in
`packages/privacy-creds/src/wallet-actions/types.ts`. Every privileged route
on `person-mcp`'s SSI tools requires a fresh, signed action with:


| Field                                                    | Purpose                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `type`                                                   | One of `ProvisionHolderWallet`, `AcceptCredentialOffer`, `CreatePresentation`, `RevokeCredential`, `RotateLinkSecret` |
| `personPrincipal`                                        | Bound to `holder_wallets.person_principal`; mismatched principal = 400                                                |
| `walletContext`                                          | `default                                                                                                              |
| `holderWalletId`                                         | Bound to `holder_wallets.id` (or `pending` for provision)                                                             |
| `counterpartyId`                                         | DID of issuer or verifier, or `self` for provision                                                                    |
| `purpose`                                                | Free-text label rendered in audit                                                                                     |
| `proofRequestHash`                                       | `keccak256(canonicalJson(presentationRequest))`; tamper-evidence                                                      |
| `allowedReveal` / `allowedPredicates` / `forbiddenAttrs` | Outer policy declared by the signer                                                                                   |
| `nonce`                                                  | 32-byte random; consumed once in `action_nonces`                                                                      |
| `expiresAt`                                              | uint64 seconds; outer TTL                                                                                             |


`DEFAULT_FORBIDDEN_ATTRS` (also in `types.ts`) is a hard server-side block
list — `legalName`, `email`, `phone`, `dob`, `dateOfBirth`, `address`, `ssn`,
`globalPersonId`, `privyWalletAddress` — that `person-mcp` refuses to
disclose **even if the signed action allows them**.

### 3.2 Signature shapes and on-chain validator

The same `WalletAction` digest is signed by exactly one of two shapes,
both exposed to `person-mcp` as an opaque `bytes signature`:

| Shape (first byte) | Body                                                                                                                                          | Produced by                                                                                            | Verified by                                                          |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| **`0x01` ‖ enc**   | `abi.encode(WebAuthnLib.Assertion { authenticatorData, clientDataJSON, challengeIndex, typeIndex, r, s, x, y })` — produced from a P-256 passkey assertion | Browser passkey ceremony, packaged in `packWebAuthnSignature` (`packages/sdk/src/passkey.ts`)         | `AgentAccount._verifyWebAuthn` → `WebAuthnLib.verify` → `P256Verifier.verifySignature` (RIP-7212 precompile when present, else pure-Solidity) |
| **`0x00` ‖ ecdsa** | 65-byte secp256k1 signature, recipient is an `_owners` member                                                                                 | `AgentAccount` owner key (rare in production; mostly tests)                                            | `AgentAccount._verifyEcdsa` (`ECDSA.recover` against `_owners`)      |
| **65-byte ecdsa**  | Plain `r ‖ s ‖ v` — *not* prefixed                                                                                                            | `users.privateKey` (demo) or MetaMask (SIWE), via `signWalletAction` direct path (`signer.ts`)         | `verifyWalletAction` calls `recoverTypedDataAddress` and matches against `users.walletAddress` |

The first two shapes are validated through the smart account; the third
exists only for legacy-EOA holders. The on-chain router lives at the
top of `AgentAccount.isValidSignature`:

```
if signature.length >= 1 && signature[0] == 0x01:
    return _verifyWebAuthn(hash, signature[1:])  // passkey path
if signature.length >= 1 && signature[0] == 0x00:
    return _verifyEcdsa(hash, signature[1:])     // owner-EOA over wrapper
return _verifyEcdsa(hash, signature)             // legacy 65-byte ECDSA
```

`WebAuthnLib.verify` reconstructs the WebAuthn `signedHash` =
`sha256(authenticatorData ‖ sha256(clientDataJSON))`, asserts the embedded
`challenge` (base64url) equals
`hashToWebAuthnChallenge(WalletAction digest)`, then delegates to
`P256Verifier.verifySignature`. That function dispatches to the
RIP-7212 precompile at `0x100` when available (Anvil with the right flag,
mainnet post-Pectra) and otherwise runs a pure-Solidity `ecrecover`-style
P-256 check.

The SDK helpers that drive this end-to-end:

| Helper                       | File                                | Role                                                                          |
| ---------------------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| `prepareWalletActionForPasskey` | `apps/web/src/lib/ssi/signer.ts` | Builds the EIP-712 hash on the server, returns `{ digest, challenge }`        |
| `hashToWebAuthnChallenge`    | `packages/sdk/src/passkey.ts`       | EIP-712 hash → base64url challenge accepted by `navigator.credentials.get`    |
| `buildPasskeyAssertion`      | `packages/sdk/src/passkey.ts`       | Browser-side: parse `AuthenticatorAssertionResponse` into the struct shape    |
| `parseDerSignature` / `normaliseLowS` | `packages/sdk/src/passkey.ts` | Convert WebAuthn DER signature to `(r,s)` and enforce low-S                    |
| `packWebAuthnSignature`      | `packages/sdk/src/passkey.ts`       | Produces `0x01 ‖ abi.encode(Assertion)` to hand back to server                 |
| `signWalletAction`           | `apps/web/src/lib/ssi/signer.ts`    | Demo / SIWE EOA fallback only — direct EIP-712 sign with secp256k1            |

---

## 4. Storage layout

### 4.1 `person-mcp` SSI vault — operational SQLite + Askar vault

Operational SQLite inside `apps/person-mcp`:

```
holder_wallets
  id              TEXT PK
  person_principal TEXT   -- e.g. "person_<userId>" or smart-account address
  wallet_context  TEXT   -- 'default' | 'professional' | 'personal' | …
  signer_eoa      TEXT   -- address that signed the provision action
  askar_profile   TEXT   -- name of the Askar profile holding this wallet's secrets
  link_secret_id  TEXT   -- pointer into Askar
  status          TEXT   -- active | rotating | revoked
  created_at      TEXT
  UNIQUE (person_principal, wallet_context)

action_nonces                     -- replay protection for WalletActions
  nonce            TEXT PK
  action_type      TEXT
  holder_wallet_id TEXT
  expires_at       INTEGER
  used_at          TEXT

credential_metadata               -- public, no attribute values, no blobs
  id              TEXT PK
  holder_wallet_id TEXT
  issuer_id        TEXT
  schema_id        TEXT
  cred_def_id      TEXT
  credential_type  TEXT
  received_at      TEXT
  status           TEXT
  link_secret_id   TEXT             -- which secret this cred is bound to
```

Askar-style vault inside `apps/person-mcp` — pure-JS,
SQLite-backed, AES-256-GCM at the library layer:

```
profiles                          -- one per (principal, walletContext) pair
  name           TEXT PK            -- e.g. "wallet:<sha256(principal|context)>"
  wrapped_dek    BLOB              -- DEK encrypted under KEK = scrypt(SSI_ASKAR_KEY)
  dek_iv, dek_tag BLOB
  created_at     TEXT

vault_kv                          -- generic (profile, category, name) → ciphertext
  profile, category, name PK
  iv, ciphertext, tag    BLOB     -- AES-256-GCM under that profile's DEK; AAD = profile|category|name
  tags                   JSON
```

Categories used:


| Category             | Name pattern     | Value                                                                 |
| -------------------- | ---------------- | --------------------------------------------------------------------- |
| `link_secret`        | `<linkSecretId>` | random 32-byte AnonCreds link secret                                  |
| `credential`         | `<credentialId>` | full processed AnonCreds credential JSON — one blob per held credential, regardless of type |
| `credential_request` | `<requestId>`    | one-shot blinding metadata + offer (consumed by `/credentials/store`) |


Per-profile DEKs mean compromise of one profile doesn't leak others; each
encryption commits to its own AAD so a row can't be silently moved between
profiles or categories.

#### What a credential blob looks like in the vault

Every issued credential — `OrgMembershipCredential` from `org-mcp`,
`GuardianOfMinorCredential` from `family-mcp`, `GeoLocationCredential`
from `geo-mcp` — lands in the same `credential/<credentialId>` slot. The
Askar value is the AnonCreds-rs processed credential JSON, holding the
issuer signature, link secret commitment, schema/credDef ids, and the
encoded attribute values. The presentation engine reads this blob, the
holder's link secret from `link_secret/<linkSecretId>`, and the verified
schema + credDef from chain to build a proof.

For each credential type the attribute slots stored inside the blob are:

| Credential type             | Attribute names (stringified per AnonCreds rules)                                                                                                  | Issuer        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `OrgMembershipCredential`   | `membershipStatus`, `role`, `joinedYear`, `circleId`                                                                                               | `org-mcp`     |
| `GuardianOfMinorCredential` | `relationship`, `minorBirthYear`, `issuedYear`                                                                                                     | `family-mcp`  |
| `GeoLocationCredential`  | `featureId`, `featureName`, `city`, `region`, `country`, `relation`, `confidence`, `validFrom`, `validUntil`, `attestedAt`                          | `geo-mcp`     |

The companion `credential_metadata` row in `person-mcp`'s SQLite carries
only the public surface — id, type, issuer DID, schema/credDef ids,
target-org pointer (when applicable), receipt timestamp, status. Attribute
values never leave the vault blob; presentation revealing reads them out
in-process and never persists them.

### 4.2 `person-mcp` audit, metadata, identities, profile

`apps/person-mcp/src/db/schema.ts` — the SSI-relevant tables:

```
ssi_holder_wallets        -- local holder-wallet index
  principal, walletContext, walletContext, privyEoa,
  holderWalletRef → holder_wallets.id
  linkSecretRef   → Askar link_secret id
  status, createdAt

ssi_credential_metadata   -- mirror of credential_metadata (no values, no blobs)
  principal, walletContext, holderWalletRef,
  issuerId, schemaId, credDefId, credentialType,
  receivedAt, status

ssi_proof_audit           -- one row per /proofs/present attempt
  principal, walletContext, holderWalletRef,
  verifierId, purpose, revealedAttrs (JSON),
  predicates (JSON), actionNonce, pairwiseHandle,
  holderBindingIncluded, result ('ok' | 'denied' | 'error'),
  createdAt
```

Note the profile / address / chat tables already documented elsewhere are
**not** SSI tables — they're delegation-gated PII unrelated to AnonCreds.

### 4.3 On-chain — `CredentialRegistry`

```
Issuer registration: registerIssuer(did, addr)
  → IssuerRegistered event
  → resolver.resolveIssuer(addr) returns { did, address, registeredAt }

Schema publication:   publishSchema(schemaId, hexJson)
  → SchemaPublished event  (canonical JSON in event data)
  → on-chain: schemaJsonHash[schemaId] = keccak256(canonicalJson)

CredDef publication:  publishCredDef(credDefId, schemaId, hexJson)
  → CredDefPublished event
  → on-chain: credDefJsonHash[credDefId] = keccak256(canonicalJson)
```

`packages/credential-registry/src/types.ts` carries the typed views; the
on-chain hash is the only authority — `loadVerifiedSchema` /
`loadVerifiedCredDef` rebuild the JSON from event data and re-hash it before
returning.

Issuer-private material (`CredentialDefinitionPrivate`,
`KeyCorrectnessProof`) lives **only** in the issuer's local SQLite
(`packages/privacy-creds/src/issuer/index.ts`). It's never on chain and is
not recoverable from the public record — wipe-and-re-publish if lost.

### 4.4 On-chain — `.geo`, feature records, and claim anchors

Location credentials do not put exact location evidence on chain. The public
chain stores only feature provenance and optional claim anchors:

```
AgentNameRegistry
  root "geo" → namehash(".geo")
  erie.colorado.us.geo → nameNode

GeoFeatureRegistry
  featureId
  version
  stewardAccount
  featureKind
  geometryHash       -- hash of canonical GeoJSON/WKT payload
  h3CoverageRoot     -- Merkle root over public H3 coverage cells
  sourceSetRoot      -- provenance dataset commitment
  metadataURI        -- full public feature document
  centroid / bbox    -- map and pre-filter only, not spatial truth

GeoClaimRegistry
  claimId
  subjectAgent
  issuer
  featureId / featureVersion
  relation
  visibility         -- Public | PublicCoarse | PrivateCommitment | PrivateZk | OffchainOnly
  evidenceCommit     -- hash of verifier receipt / proof transcript / evidence bundle
  edgeId / assertionId
  confidence
  policyId
  validAfter / validUntil
```

`geometryHash` and `h3CoverageRoot` are public commitments. They make a
third-party verifier's work reproducible, but they do not verify a private
location by themselves. A verifier still checks the holder's AnonCreds proof
and any H3 inclusion proof off-chain, then signs or publishes a receipt.

---

## 5. Component model

```
                                           ┌────────────────────────────┐
                                           │ packages/privacy-creds     │
                                           │  - WalletAction types      │
                                           │  - hash / verify helpers   │
                                           │  - evaluateProofPolicy     │
                                           │  - AnonCreds.* (anoncreds-rs│
                                           │    facade; node binding   ) │
                                           │  - IssuerAgent class       │
                                           └────────────┬───────────────┘
                                                        │
                                                        │ imported by
                                                        ▼
       ┌─────────────────────────────────────────────────────────────────┐
       │                                                                 │
       │  apps/web/src/lib/ssi/*  (signer, clients, config)              │
       │  apps/web/src/lib/actions/ssi/*  (provision, accept, present,   │
       │                                   rotate, oid4vci-redeem)       │
       │                                                                 │
       └─┬──────────────────────────────────────────────┬────────────────┘
         │                                              │
        │  HTTP /tools/<name>                          │ HTTP /credential/* /verify/*
         ▼                                              ▼
  ┌──────────────────────────┐                 ┌──────────────────────────┐
  │ apps/person-mcp          │                 │ apps/{org,family}-mcp    │
  │ src/tools/ssi-wallet.ts  │                 │ src/issuers/*            │
  │  - ssi_create_wallet_act │                 │ src/api/credential.ts    │
  │  - ssi_provision_wallet  │                 │ src/api/oid4vci.ts       │
  │  - ssi_start_…/finish_…  │                 │ src/registry/mock-*      │
  │  - ssi_create_presentat. │                 │  uses IssuerAgent +      │
  │  - ssi_list_…            │                 │  CredentialRegistry      │
  │  - ssi_rotate_link_secret│                 └──────────────────────────┘
  │ src/auth/verify-deleg.ts │                              │
  │ src/db/schema.ts         │                              │ writeContract
  │   ssi_holder_wallets,    │                              ▼
  │   ssi_credential_metadata│                     ┌─────────────────────┐
  │   ssi_proof_audit        │                     │ CredentialRegistry  │
  │ src/auth/verify-wallet-action.ts           │   .sol (on-chain)   │
  │ src/auth/verifier-registry.ts              └─────────────────────┘
  │ src/storage/askar.ts
  │ src/storage/wallets.ts
  │ src/storage/cred-metadata.ts
  │ src/storage/nonces.ts
  └──────────────────────────┘
```

---

## 6. Object-interaction diagrams (sequence)

The diagrams below use these participants consistently:

- `B`  = Browser (also runs the WebAuthn passkey ceremony)
- `Web` = `apps/web` server actions
- `MCP` = `apps/person-mcp` (combined consent gateway, SSI vault, and PII gateway)
- `Issuer` = `apps/org-mcp` or `apps/family-mcp`
- `Reg` = `CredentialRegistry.sol` on-chain
- `AA` = `AgentAccount.sol` (the smart account; ERC-1271 verifier for passkeys)

### 6.0 The standard "sign a `WalletAction`" sub-flow

Every privileged sequence below ends up in the same three-step pattern:

```mermaid
sequenceDiagram
    autonumber
    participant Web as apps/web
    participant Browser as Browser / authenticator
    participant MCP as person-mcp
    participant AA as AgentAccount

    Web->>MCP: Build unsigned WalletAction
    MCP-->>Web: WalletAction
    Web->>Web: digest = hashWalletAction(action)
    Web->>Web: challenge = hashToWebAuthnChallenge(digest)
    Web->>Browser: navigator.credentials.get(challenge)
    Browser->>Browser: Build WebAuthn assertion<br/>parse DER signature, normalize low-S
    Browser-->>Web: signature = 0x01 || abi.encode(Assertion)
    Web->>MCP: Submit action, signature, signerAddress=AgentAccount
    MCP->>AA: isValidSignature(digest, signature)
    AA-->>MCP: ERC-1271 magic value

    alt Legacy demo / SIWE EOA
        Web->>Web: signTypedData(action)
        Web->>MCP: 65-byte ECDSA signature
        MCP->>MCP: recoverTypedDataAddress
    end
```

The legacy EOA fallback collapses the middle step — `signer.ts`'s
`signWalletAction` calls `account.signTypedData(...)` directly — but every
production-shaped flow assumes the passkey round-trip above.

### 6.1 Provision a holder wallet (first time per `(principal, context)`)

`provisionHolderWalletAction` (`apps/web/src/lib/actions/ssi/provision.action.ts`).

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant Web as apps/web
    participant MCP as person-mcp
    participant Vault as Askar vault

    B->>Web: Click "create wallet"
    Web->>Web: loadSignerForCurrentUser
    Web->>MCP: /tools/ssi_create_wallet_action<br/>type=ProvisionHolder
    MCP-->>Web: Unsigned WalletAction
    Web->>B: Passkey ceremony with challenge
    B-->>Web: 0x01 || abi.encode(Assertion)
    Web->>MCP: /tools/ssi_provision_wallet<br/>action, signature, AgentAccount
    MCP->>MCP: verifyWalletAction
    MCP->>MCP: consumeNonce
    MCP->>MCP: getHolderByContext for idempotency
    MCP->>Vault: createProfile
    MCP->>MCP: createLinkSecretValue
    MCP->>Vault: putLinkSecret(profile, id)
    MCP->>MCP: insertHolderWallet + audit
    MCP-->>Web: holderWalletId
    Web-->>B: holderWalletId
```

Idempotency: a second provision for the same `(principal, walletContext)`
short-circuits with the existing wallet without consuming a new nonce.

### 6.2 Issue a credential (org membership)

Driven by the generic `prepareCredentialIssuance` +
`completeCredentialIssuance` pair
(`apps/web/src/lib/actions/ssi/request-credential.action.ts`) when the
holder picks `OrgMembershipCredential` from the dropdown menu. The
legacy server-EOA path lives in `accept.action.ts` for demo seeds and
admin tools, but every interactive web flow (passkey, SIWE, EOA)
goes through the generic prepare/complete pair.

The shape below is identical for **any** credential kind — only the
issuer client (org / family / geo) and the form-collected attributes
change. Adding a new kind doesn't add a new sequence; it adds a
descriptor to `CREDENTIAL_KINDS`.

```mermaid
sequenceDiagram
    autonumber
    participant Web as apps/web
    participant MCP as person-mcp
    participant Issuer as org-mcp issuer
    participant Vault as Askar vault
    participant Reg as CredentialRegistry

    Web->>Issuer: POST /credential/offer
    Issuer->>Reg: loadVerifiedCredDef(credDefId)
    Reg-->>Issuer: Verified credDef
    Issuer->>Issuer: Load KeyCorrectnessProof from local DB
    Issuer-->>Web: offer, credDefId, schemaId

    Web->>MCP: /tools/ssi_create_wallet_action<br/>type=AcceptCredentialOffer
    MCP-->>Web: Unsigned WalletAction
    Web->>Web: Passkey ceremony via section 6.0

    Web->>MCP: /tools/ssi_start_credential_exchange<br/>action, signature, offer, credDefId
    MCP->>MCP: verifyWalletAction + consumeNonce
    MCP->>Reg: loadVerifiedCredDef(credDefId)
    Reg-->>MCP: Verified credDef
    MCP->>Vault: getLinkSecret(profile)
    Vault-->>MCP: link secret
    MCP->>MCP: AnonCreds.holderCreateCredentialRequest
    MCP->>Vault: putCredentialRequestMeta(requestId)
    MCP-->>Web: requestId, requestJson

    Web->>Issuer: POST /credential/issue<br/>offer, request, attributes
    Issuer->>Issuer: IssuerAgent.issue(...)
    Issuer-->>Web: credentialJson

    Web->>MCP: /tools/ssi_finish_credential_exchange<br/>credentialJson, holder ref
    MCP->>Vault: takeCredentialRequestMeta(requestId)
    MCP->>Reg: loadVerifiedCredDef(credDefId)
    Reg-->>MCP: Verified credDef
    MCP->>Vault: getLinkSecret(profile)
    Vault-->>MCP: link secret
    MCP->>MCP: AnonCreds.holderProcessCredential
    MCP->>Vault: putCredential(profile, id, blob, tags)
    MCP->>MCP: insertCredentialMetadata + audit
    MCP-->>Web: credentialId, metadata
```

Note the **two-leg** request/store split. The blinding metadata generated
during `holderCreateCredentialRequest` must survive the round-trip to the
issuer; it lives in Askar under `category=credential_request, name=requestId`
and is consumed once when the issued credential comes back. That category is
the only place Askar stores something time-bounded — every other secret is
long-lived.

### 6.3 Present a credential (guardian-of-minor → coach)

`presentGuardianToCoachAction`
(`apps/web/src/lib/actions/ssi/present.action.ts`).

```mermaid
sequenceDiagram
    autonumber
    participant Web as apps/web
    participant MCP as person-mcp
    participant Verifier as family-mcp verifier

    Web->>MCP: /tools/ssi_list_my_credentials
    MCP->>MCP: Select credential metadata
    MCP-->>Web: credentials

    Web->>Verifier: GET /verify/guardian/request
    Verifier->>Verifier: Build presentationRequest<br/>and EIP-191 verifier signature
    Verifier-->>Web: presentationRequest, verifierId,<br/>verifierAddress, signature

    Web->>MCP: /tools/ssi_create_wallet_action<br/>type=CreatePresentation, policy limits
    MCP->>MCP: proofRequestHash = keccak256(canonical(request))
    MCP-->>Web: Unsigned WalletAction
    Web->>Web: Passkey ceremony via section 6.0

    Web->>MCP: /tools/ssi_create_presentation<br/>action, signature, selections, verifier signature
    MCP->>MCP: verifyWalletAction + consumeNonce
    MCP->>MCP: check proofRequestHash
    MCP->>MCP: checkVerifierSignature when configured
    MCP->>MCP: loadVerifiedSchema/CredDef
    MCP->>MCP: getCredential(profile, credId) from vault
    MCP->>MCP: evaluateProofPolicy
    MCP->>MCP: pairwiseHandle(holderWalletId, verifierId)
    MCP->>MCP: AnonCreds.holderCreatePresentation
    MCP->>MCP: insert ssi_proof_audit(result=ok)
    MCP-->>Web: presentation, auditSummary

    Web->>Verifier: POST /verify/guardian/check<br/>presentation, presentationRequest
    Verifier->>Verifier: anoncreds-rs verify
    Verifier-->>Web: verified, reason
```

Three independent layers reject a bad presentation request:

1. **Outer signed policy**: the user's `WalletAction` declared the universe
  of allowed reveals/predicates. Anything not listed is rejected.
2. **Inner default forbidden list**: `person-mcp`'s
  `evaluateProofPolicy` always layers `DEFAULT_FORBIDDEN_ATTRS` on top.
3. `**proofRequestHash` tamper-evidence**: the full request body must hash to
  exactly the value the user signed. A man-in-the-middle changing
   `requested_attributes` between sign and submit invalidates the action.

If `SSI_KNOWN_VERIFIERS` is set, a fourth layer rejects requests whose
verifier-signed envelope doesn't match the registry.

### 6.4 Cross-principal PII access (delegation chain)

This is the path person-mcp's `get_delegated_profile` uses (referenced from
`apps/web/src/app/(authenticated)/catalyst/me/ProfileClient.tsx` and the A2A
agent). It is **not** an AnonCreds flow — it's how PII (email, DOB, address)
is shared between two principals — but the diagram completes the picture
because person-mcp is the gateway to *both* SSI tools and PII tools.

```mermaid
sequenceDiagram
    autonumber
    participant ReaderWeb as Reader web app
    participant A2A as Reader A2A agent
    participant OwnerMCP as Owner person-mcp
    participant Chain as EVM chain

    ReaderWeb->>A2A: Ask for delegation token
    A2A-->>ReaderWeb: Session JWT<br/>delegation, sessionKey, jti, exp

    ReaderWeb->>OwnerMCP: GET /tools/get_delegated_profile<br/>token, targetPrincipal, crossDelegation
    OwnerMCP->>OwnerMCP: requirePrincipal(token)
    OwnerMCP->>OwnerMCP: HMAC check
    OwnerMCP->>OwnerMCP: Recover sessionKey
    OwnerMCP->>OwnerMCP: Check delegation hash and caveats
    OwnerMCP->>Chain: DelegationManager.isRevoked
    Chain-->>OwnerMCP: Revocation status
    OwnerMCP->>Chain: ERC-1271 on delegator AgentAccount
    Chain-->>OwnerMCP: Signature valid
    OwnerMCP->>OwnerMCP: Enforce timestamp, tool scope, and JTI usage
    OwnerMCP->>OwnerMCP: verifyCrossDelegation
    OwnerMCP->>Chain: Check Owner AgentAccount ERC-1271 and revocation
    Chain-->>OwnerMCP: Cross-delegation valid
    OwnerMCP->>OwnerMCP: Decode DataScopeEnforcer terms
    OwnerMCP->>OwnerMCP: Select Owner profile and project granted fields
    OwnerMCP-->>ReaderWeb: profile subset, allowedFields
```

The two delegations (session and cross) are independent. The session proves
*the caller is who they say they are*; the cross-delegation proves *the
owner authorised the caller to read these specific fields*. Person-mcp
verifies both.

### 6.4a Issue a `GeoLocationCredential` (geo-mcp direct issuance, vault-only)

`prepareCredentialIssuance` + `completeCredentialIssuance`
(`apps/web/src/lib/actions/ssi/request-credential.action.ts`). Triggered by
the "Get credential" button in `AddGeoClaimPanel` and by the
"+ Get geo credential" entry in the dropdown header menu (which opens
`IssueCredentialDialog`).

This is the privacy-preserving path for binding a holder to a `.geo`
feature. **Nothing is written to `GeoClaimRegistry`.** Verifiers learn
the binding only when the holder voluntarily produces an AnonCreds
presentation — selective-disclosure and predicate proofs ride for free
on the standard wallet path.

Two properties hold:

1. **Authorisation is implicit.** `geo-mcp` is a single steward across
   every `.geo` feature
   (`did:ethr:<chainId>:<addr(0xeee…e)>`); it has no per-feature
   approval queue and trusts the holder's request. Future evidence
   hooks (verifier-receipt, H3-inclusion ZK witness) plug into the
   `attestedAt`/`confidence` slots without changing the wire shape.
2. **Inputs are feature + relation + confidence.** The web action reads
   `GeoFeatureRegistry.getFeature(featureId, version)` for the public
   `metadataURI`, parses it into `city`/`region`/`country`, and
   combines that with the holder's chosen `relation` and `confidence`.
   `validFrom`/`validUntil` default to `0` (open-ended); `attestedAt`
   is the issuance unix-seconds. No `GeoClaim` lookup, no chain trace
   of the holder ↔ feature binding.

```mermaid
sequenceDiagram
    autonumber
    participant Web as apps/web
    participant Chain as GeoFeatureRegistry
    participant MCP as person-mcp
    participant Geo as geo-mcp issuer
    participant Vault as Askar vault

    Web->>Chain: getFeature(featureId, featureVersion)
    Chain-->>Web: FeatureRecord (metadataURI, active)
    Web->>Web: parseMetadataURI → city/region/country<br/>combine with holder's relation + confidence
    Web->>Geo: POST /credential/offer<br/>credentialType=GeoLocationCredential
    Geo->>Geo: ensureSchemaAndCredDef (idempotent)
    Geo-->>Web: offer, credDefId, schemaId, issuerId

    Web->>MCP: ssi_create_wallet_action<br/>type=AcceptCredentialOffer
    MCP-->>Web: Unsigned WalletAction
    Web->>Web: Passkey ceremony via section 6.0

    Web->>MCP: ssi_start_credential_exchange<br/>action, signature, offer
    MCP->>Vault: get link secret
    MCP->>MCP: holderCreateCredentialRequest
    MCP-->>Web: requestId, requestJson

    Web->>Geo: POST /credential/issue<br/>offer, request, attributes
    Note over Web,Geo: attributes = {<br/>  featureId, featureName, city, region, country,<br/>  relation, confidence, validFrom, validUntil,<br/>  attestedAt<br/>}
    Geo-->>Web: credentialJson

    Web->>MCP: ssi_finish_credential_exchange<br/>credentialJson, holder ref
    MCP->>Vault: putCredential(profile, id)
    MCP-->>Web: credentialId
```

The credential lands in the holder's Askar vault and is invisible to
anyone but the holder until they choose to present it. The optional
`mintPublicGeoClaimAction` path (the "Mint" button on the same form)
remains available when the holder *wants* a public on-chain anchor
— but the AnonCreds-vault path no longer depends on it.

> **Tradeoff today:** geo-mcp does not verify evidence. The credential
> attests "this holder claims this relationship to this feature" with
> the same trust weight as a self-asserted email. Verifier-mcp's
> default spec mitigates by requiring `confidence ≥ 50` predicates and
> by binding to geo-mcp's specific `credDefId`, but until the
> evidence hook is wired (Phase 6 ZK / verifier-receipt path), policy
> consumers should treat assurance as low.

### 6.4b Test verification through `verifier-mcp`

`prepareVerifyHeldCredential` + `completeVerifyHeldCredential`
(`apps/web/src/lib/actions/ssi/verify-held.action.ts`). Triggered by the
"Test verification" button on each row of `HeldCredentialsPanel`.

`verifier-mcp` is a single third-party "Trusted Auditor" service. It
publishes nothing on chain; its only state is a sqlite of consumed
presentation nonces. The verifier resolves schemas/credDefs through the
same `OnChainResolver` issuers use, so it always speaks against the
canonical on-chain definitions.

```mermaid
sequenceDiagram
    autonumber
    participant Browser as Browser
    participant Web as apps/web
    participant MCP as person-mcp
    participant Verifier as verifier-mcp
    participant Chain as CredentialRegistry

    Browser->>Web: Click "Test verification" on credential row
    Web->>MCP: ssi_list_my_credentials → resolve credentialType,<br/>holderWalletRef, walletContext
    Web->>Verifier: POST /verify/<credentialType>/request
    Verifier->>Verifier: buildRequest(spec) — picks reveals + predicates<br/>(e.g. attr_country / pred_confidence ≥ 50 for geo)
    Verifier->>Verifier: signPresentationRequest(verifierKey, body)
    Verifier-->>Web: presentationRequest, selection,<br/>verifierId, verifierAddress, verifierSignature, label

    Web->>MCP: ssi_create_wallet_action<br/>type=CreatePresentation, allowed reveals + predicates
    MCP-->>Web: Unsigned WalletAction
    Web->>Browser: Passkey ceremony with EIP-712 challenge
    Browser-->>Web: 0x01 || abi.encode(Assertion)

    Web->>MCP: ssi_create_presentation<br/>action, signature, expectedSigner,<br/>presentationRequest, verifier identity, selections
    MCP->>MCP: verifyWalletAction + consumeNonce
    MCP->>MCP: enforce proofRequestHash
    MCP->>MCP: checkVerifierSignature
    MCP->>Chain: load schema + credDef
    MCP->>MCP: get credential + link secret from vault
    MCP->>MCP: evaluateProofPolicy
    MCP->>MCP: holderCreatePresentation
    MCP->>MCP: insert ssi_proof_audit(result=ok)
    MCP-->>Web: presentation, auditSummary

    Web->>Verifier: POST /verify/<credentialType>/check<br/>presentation, presentationRequest
    Verifier->>Verifier: consumeNonce(presentationRequest.nonce)
    Verifier->>Chain: loadVerifiedSchema + loadVerifiedCredDef
    Chain-->>Verifier: canonical-hash-checked schema/credDef
    Verifier->>Verifier: AnonCreds.verifierVerifyPresentation
    Verifier-->>Web: { verified, revealedAttrs, replay? }

    Web-->>Browser: render "verified ✓ by Trusted Auditor"<br/>+ revealed attrs (e.g. country=us, region=co)
```

The verifier-mcp's `specs.ts` has one `VerifierSpec` per supported
credential type. Each spec defines (a) the schema/credDef ids it pins, (b)
which referents to reveal vs. predicate-prove, (c) the `buildRequest`
function that mints a fresh `requested_attributes` / `requested_predicates`
body. The web action passes the spec's `selection` straight through to
`ssi_create_presentation` so the wallet's `evaluateProofPolicy` knows
exactly what the holder authorised.

Replay protection is layered:

- **person-mcp** rejects re-use of any signed `WalletAction` via
  `action_nonces`.
- **verifier-mcp** rejects re-use of any presentation-request nonce via
  its own `consumed_nonces` table — preventing the same successful
  presentation from being submitted twice as evidence.

The verifier-mcp DID is `did:ethr:<chainId>:<addr(0xaaa…a)>` (the
"Trusted Auditor" key in `apps/verifier-mcp/.env`). It is a dev-time
constant; production deployments would substitute a real verifier
identity.

### 6.5 Rotate a link secret

`rotateLinkSecretAction` (`apps/web/src/lib/actions/ssi/rotate.action.ts`).

```mermaid
sequenceDiagram
    autonumber
    participant Web as apps/web
    participant MCP as person-mcp
    participant Vault as Askar vault / DB

    Web->>MCP: Resolve holderWalletId<br/>principal, context
    MCP-->>Web: holderWalletId
    Web->>MCP: /tools/ssi_create_wallet_action<br/>type=RotateLinkSecret
    MCP-->>Web: Unsigned WalletAction
    Web->>Web: Passkey ceremony via section 6.0
    Web->>MCP: /tools/ssi_rotate_link_secret<br/>action, signature
    MCP->>MCP: verifyWalletAction + consumeNonce
    MCP->>MCP: AnonCreds.createLinkSecretValue
    MCP->>Vault: putLinkSecret(profile, newId)
    MCP->>MCP: updateHolderLinkSecret(hw.id, newId)
    MCP->>MCP: markCredentialsStaleForLinkSecret(oldId)
    MCP-->>Web: old, new, credentialsMarkedStale
```

Rotation invalidates every credential previously bound to the old link
secret — those rows are flagged `stale` in `credential_metadata` and the
holder must re-issue. The **old link secret stays in Askar** so a forensic
operator can reproduce historical proofs if needed; new presentations cannot
be created against it because the live `holder_wallets.link_secret_id` no
longer points at it.

---

## 7. Anti-correlation and policy properties


| Property                     | Mechanism                                                                                                                                                                                                    | Where it lives                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Per-context unlinkability    | One Askar profile + one link secret per `(principal, walletContext)`. Two contexts can never produce a "same-holder" proof across each other.                                                                | `apps/person-mcp` SSI vault provision flow                                                       |
| Pairwise verifier handle     | `pairwiseHandle(holderWalletId, verifierId)` deterministically produces a per-verifier opaque ID; presented as self-attested `holder` slot. Different verifiers cannot collude to correlate the same holder. | `packages/privacy-creds` (`pairwiseHandle`); `apps/person-mcp` presentation flow                 |
| Hard-forbidden attrs         | `DEFAULT_FORBIDDEN_ATTRS` enforced at the `evaluateProofPolicy` layer regardless of signed action.                                                                                                           | `packages/privacy-creds/src/wallet-actions/types.ts`, `policy/proof-policy.ts`                   |
| Presentation minimisation    | Reveals dominated by predicates on the same attribute are dropped before calling anoncreds-rs.                                                                                                               | `evaluateProofPolicy` step 4                                                                     |
| Replay protection            | `action_nonces` table is INSERT-only; double-use is `409 Conflict`. Nonces have explicit expiry.                                                                                                             | `apps/person-mcp` nonce storage                                                                  |
| Tamper evidence              | `proofRequestHash = keccak256(canonical(body))` is part of the signed envelope. Any change to the request body invalidates the signature.                                                                    | `hashProofRequest` in `packages/privacy-creds`; check in `apps/person-mcp` presentation flow     |
| Verifier registry (optional) | When `SSI_KNOWN_VERIFIERS` is set, `person-mcp` requires verifier to sign their request, registry maps DID→address, presentation refused otherwise.                                                          | `apps/person-mcp` verifier registry logic                                                        |
| Schema/credDef provenance    | All resolutions go through `loadVerifiedSchema` / `loadVerifiedCredDef`, which check `keccak256(canonicalJson)` against the on-chain hash before returning.                                                  | `packages/credential-registry`                                                                   |
| Issuer-private isolation     | `CredentialDefinitionPrivate` and `KeyCorrectnessProof` never leave the issuer's local SQLite. The on-chain record contains only public material.                                                            | `packages/privacy-creds/src/issuer/index.ts`                                                     |
| Location minimisation        | `AgentLocationCredential` stores feature-level claims and commitments, not exact addresses, raw coordinates, private H3 cells, Merkle paths, or evidence documents.                                           | Credential schema, verifier policy, `GeoFeatureRegistry`, `GeoClaimRegistry`                     |
| Off-chain verifier receipts  | Third-party verifiers check AnonCreds and H3 inclusion off-chain, then return a signed receipt / `evidenceCommit`; on-chain anchoring is optional and commitment-only.                                       | Third-party verifier agent / MCP, optional `GeoClaimRegistry`                                    |
| Vault-at-rest                | Per-profile DEK wrapped by KEK = `scrypt(SSI_ASKAR_KEY)`. AES-256-GCM with per-row AAD bound to profile, category, and row name.                                                                              | `apps/person-mcp` Askar-style vault storage                                                      |


---

## 8. Operational notes

- **Bring-up order**: Anvil → deploy contracts → issuer/verifier MCPs
(`org-mcp` 3400, `family-mcp` 3500, `geo-mcp` 3600, `verifier-mcp` 3700)
→ `person-mcp` (3200) → `apps/web` (3000). The web app's `ssiConfig`
reads ports from env; defaults in `apps/web/src/lib/ssi/config.ts`.
`scripts/fresh-start.sh` brings the whole stack up in this order.
- **Native binding**: `@hyperledger/anoncreds-nodejs` is registered exactly
once in the MCP process. Re-registering in another process (e.g. an issuer
MCP) is fine; re-registering twice in the same process throws.
- **KEK rotation** is a destructive global action — see
`docs/ops/ssi-wallet-kek-rotation.md`. Do not change `SSI_ASKAR_KEY`
without running the rotation procedure or every profile becomes
undecryptable.
- **Demo seeds**: `scripts/seed-*.sh` calls `apps/web` server actions to
walk new users through provision + accept + present without manual UI
interaction. Inspect `apps/web/src/lib/demo-seed/*` for the canonical
end-to-end shape.
- **Phase markers** (`Phase 4` etc. in code comments) are historical: in
the current code path *every* WalletAction is verified via the gate; the
Phase-4 phrasing in `apps/person-mcp/src/tools/ssi-wallet.ts` refers to
the eventual move to delegation-token gating for SSI tools (today they
take an explicit `principal` arg).

---

## 9. File reference index

### Web app (`apps/web`)


| File                                           | Role                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/lib/ssi/config.ts`                        | Service URLs, chain config                                                            |
| `src/lib/ssi/clients.ts`                       | HTTP clients for `person`, `org`, `family`, `geo`, `verifier` MCPs                    |
| `src/lib/ssi/signer.ts`                        | `prepareWalletActionForPasskey` (primary); `signWalletAction` direct EOA fallback     |
| `src/lib/actions/ssi/provision.action.ts`      | First-time wallet creation (server-EOA path)                                          |
| `src/lib/actions/ssi/wallet-provision.action.ts` | Shared passkey-capable wallet provisioning primitives                              |
| `src/lib/actions/ssi/accept.action.ts`         | Server-EOA credential issuance (legacy demo / admin path)                             |
| `src/lib/actions/ssi/request-credential.action.ts` | Generic passkey-capable issuance — `prepareCredentialIssuance` / `completeCredentialIssuance`. Drives every kind via `CREDENTIAL_KINDS` lookup. |
| `src/lib/credentials/IssueCredentialDialog.tsx` | Generic React dialog used by every "+ Get {noun} credential" entry                   |
| `src/lib/credentials/registry.tsx`             | Web-side registry pairing each `CredentialKindDescriptor` with its issuance form     |
| `src/lib/credentials/forms/`                   | Per-kind issuance form components (`OrgMembershipForm`, `GeoLocationForm`, …)         |
| `src/lib/actions/ssi/oid4vci-redeem.action.ts` | OID4VCI variant of `accept`                                                           |
| `src/lib/actions/ssi/present.action.ts`        | Build + submit a presentation                                                         |
| `src/lib/actions/ssi/rotate.action.ts`         | Rotate the link secret                                                                |
| `src/lib/actions/ssi/verify-held.action.ts`    | `prepareVerifyHeldCredential` + `completeVerifyHeldCredential` — drive the "Test verification" button against verifier-mcp |
| `src/lib/actions/geo-claim.action.ts`          | Publish public `GeoClaimRegistry` rows and list `GeoFeatureRegistry` records          |
| `src/components/profile/AddGeoClaimPanel.tsx`  | "Publish claim" + "Get credential" buttons on the geo claim form                      |
| `src/components/org/HeldCredentialsPanel.tsx`  | List held credentials (display name from `findCredentialKind`) + per-row "Test verification" |
| `src/lib/actions/trust-search.action.ts`       | Combines org-overlap and geo-overlap inputs for discovery/trust search                |
| `src/app/(authenticated)/settings/passkeys/PasskeysClient.tsx` | Browser-side passkey enrolment / ceremony entry point                  |


### `packages/privacy-creds`


| File                                | Role                                                   |
| ----------------------------------- | ------------------------------------------------------ |
| `src/wallet-actions/types.ts`       | EIP-712 `WalletAction` type, `DEFAULT_FORBIDDEN_ATTRS` |
| `src/wallet-actions/hash.ts`        | `hashProofRequest`, canonical JSON                     |
| `src/wallet-actions/verify.ts`      | `verifyWalletAction` (ECDSA + ERC-1271)                |
| `src/policy/proof-policy.ts`        | `evaluateProofPolicy`                                  |
| `src/policy/anti-correlation.ts`    | `pairwiseHandle`                                       |
| `src/formats/anoncreds-v1/index.ts` | `AnonCreds.*` facade over `anoncreds-rs`               |
| `src/issuer/index.ts`               | `IssuerAgent` (publish, offer, issue)                  |
| `src/verifier-signing.ts`           | EIP-191 verifier-request signature helpers             |
| `src/geo-overlap.ts`                | Versioned geo-overlap scoring helpers and evidence commitments |


### `packages/sdk` (passkey helpers)

| File                       | Role                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `src/passkey.ts`           | `buildPasskeyAssertion`, `parseDerSignature`, `normaliseLowS`, `packWebAuthnSignature`, `hashToWebAuthnChallenge` |
| `src/cose-parse.ts`        | Parse COSE public keys out of WebAuthn attestation objects (registration time)                |

### `packages/contracts` (on-chain validator chain)

| File                                  | Role                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/AgentAccount.sol`                | `isValidSignature` shape-router; passkey storage; `_verifyWebAuthn` / `_verifyEcdsa`  |
| `src/libraries/WebAuthnLib.sol`       | Parse `clientDataJSON` + `authenticatorData`, recompute signed hash, call P-256 verifier |
| `src/libraries/P256Verifier.sol`      | RIP-7212 precompile dispatch with pure-Solidity fallback                              |
| `src/AgentNameRegistry.sol`           | Multi-root naming substrate for `.agent`, `.geo`, `.pg`                               |
| `src/GeoFeatureRegistry.sol`          | Versioned `.geo` feature records: geometry hash, H3 coverage root, source root        |
| `src/GeoClaimRegistry.sol`            | Geo claim anchors: relation, visibility, confidence, evidence commitment              |

### `packages/discovery` / GraphDB

| File                | Role                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| `src/geo-sparql.ts` | GeoSPARQL queries for feature containment, intersections, and claims |
| `src/sparql.ts`     | General KB query builders                                            |

### `circuits`

| File                         | Role                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| `src/h3-membership.circom`   | Current H3 inclusion circuit scaffold; used as an off-chain verifier/prover path, not required for on-chain AnonCreds verification |

### `apps/person-mcp`


| File                            | Role                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `src/index.ts`                  | MCP stdio + Hono `/tools/<name>` HTTP; native binding registration             |
| `src/tools/ssi-wallet.ts`       | `ssi_*` tools — consent gateway for SSI wallet actions                         |
| `src/tools/profile.ts`          | PII tools (delegation-gated)                                                   |
| `src/tools/identities.ts`       | OAuth/social link tools                                                        |
| `src/auth/verify-delegation.ts` | Full chain verifier (HMAC + ECDSA + ERC-1271 + caveats + JTI)                  |
| `src/auth/principal-context.ts` | `requirePrincipal` helper                                                      |
| `src/db/schema.ts`              | PII, audit, holder-wallet, credential metadata, proof audit, and mirror tables  |
| SSI vault module                | Holder wallets, credentials, proofs, verifier registry, nonces, and Askar vault |


### Issuer / verifier (examples)


| File                                              | Role                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/org-mcp/src/issuers/membership.ts`          | `OrgMembershipCredential` issuer wiring                            |
| `apps/org-mcp/src/api/credential.ts`              | `/credential/offer`, `/credential/issue`                           |
| `apps/org-mcp/src/api/oid4vci.ts`                 | OID4VCI pre-authorised flow                                        |
| `apps/family-mcp/...`                             | `GuardianOfMinorCredential` issuer + `/verify/guardian/*` verifier |
| `apps/geo-mcp/src/issuers/location.ts`         | `GeoLocationCredential` schema + credDef + `IssuerAgent` wiring |
| `apps/geo-mcp/src/api/credential.ts`              | `/credential/offer`, `/credential/issue` for geo                   |
| `apps/verifier-mcp/src/verifiers/specs.ts`        | One `VerifierSpec` per credential type (org / guardian / geo) — request body + selection |
| `apps/verifier-mcp/src/api/verify.ts`             | `/verify/<credentialType>/{request,check}` + `/verify/specs`       |
| `apps/verifier-mcp/src/verifiers/nonce-store.ts`  | Consumed-nonce sqlite — single-use presentation enforcement        |


---

## 10. TL;DR

- **Two-runtime split** keeps the browser/web signer separate from the MCP
  holder vault. `apps/person-mcp` now owns consent tools, PII tools, and SSI
  vault operations in one service.
- **`WalletAction` is the single capability token.** The holder signs it
  in the **browser via a WebAuthn passkey** (`navigator.credentials.get`
  with the EIP-712 hash as the WebAuthn challenge); the resulting
  P-256 assertion is wrapped as `0x01 ‖ abi.encode(Assertion)` and
  validated on-chain by `AgentAccount` → `WebAuthnLib` → `P256Verifier`
  via ERC-1271. Demo / SIWE EOA signing exists only as a legacy fallback.
- **AnonCreds operations** (link secret, credential request, processing,
  presentation) all happen inside `person-mcp` using the native
  `anoncreds-rs` binding. Link secrets are per-`(principal, context)` and
  never leave the vault module.
- **CredentialRegistry** on-chain is the source of truth for
  schema/credDef. Resolvers re-hash the canonical JSON before trusting it.
- **`GeoLocationCredential`** mirrors a holder's on-chain `GeoClaim`
  into a replayable AnonCreds blob. The single `geo-mcp` issuer covers
  every `.geo` feature; minting the claim is the consent signal so there
  is no per-feature approval queue. Attribute set is feature-level
  (`featureId`/`featureName`/`city`/`region`/`country`/`relation`/
  `confidence`/`validFrom`/`validUntil`/`attestedAt`), never
  address-level — exact addresses, coordinates, private H3 cells, and
  evidence documents stay out of SQL and out of chain state.
- **Third-party verifiers run proofs off-chain.** `verifier-mcp` is a
  single "Trusted Auditor" service that exercises every credential type
  (`OrgMembership`, `GuardianOfMinor`, `GeoLocation`) through one
  `/verify/<credentialType>/{request,check}` shape. It signs presentation
  requests, verifies AnonCreds proofs through `OnChainResolver`, and
  rejects replayed nonces. The dashboard surfaces "Test verification"
  buttons next to each held credential that drive this verifier
  end-to-end. Use on-chain verifier contracts only when another contract
  must consume the proof directly.
- **Person-mcp** is both the SSI consent/vault gateway and the PII gateway
  (delegation-chain-verified profile reads). SSI actions still require signed
  `WalletAction`s before the vault is used.
- **Anti-correlation** is enforced in three layers: per-context link
  secrets, pairwise handles per verifier, and the hard-forbidden attribute
  list inside `evaluateProofPolicy`.

