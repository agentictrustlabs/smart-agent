# AWS KMS Asymmetric Signer — Operator Runbook (K4)

Operator-facing runbook for provisioning the AWS KMS asymmetric signing key that
replaces `A2A_MASTER_PRIVATE_KEY` (formerly `A2A_MASTER_EOA_PRIVATE_KEY`) in
production. Companion to the K2 envelope-encryption setup; covers initial
provisioning, deployment, rotation, rollback, and audit.

Reference specs:

- `output/K4-IMPLEMENTATION-PLAN.md` — full K4 design (§8 operator UX, §9
  rotation, §12 IAM).
- `output/KMS-IMPLEMENTATION-PLAN.md` §8.1 — K2 IAM template (the envelope key);
  this runbook extends it with a sibling signing-key policy.
- `docs/architecture/01-web-a2a-mcp-flows.md` § KMS Substrate Allowlist — the
  invariant that only one SDK file per backend may import a KMS-class SDK.

---

## Overview

The AWS KMS asymmetric signer is the production substrate for the **master EOA**
— the on-chain account that pays gas for `EntryPoint.handleOps` and signs
master-account userOps. Before K4, the private key was an env var
(`A2A_MASTER_EOA_PRIVATE_KEY`) baked into the Vercel deployment. After K4, the
private key lives in an AWS KMS `ECC_SECG_P256K1` Customer Managed Key (CMK)
and **never leaves AWS**. The a2a-agent calls `kms:Sign` against the digest
viem hands it; AWS returns a DER-encoded signature; the SDK decodes, low-s
normalizes, derives the recovery id, and packs the EVM-shaped `r || s || v`.

Security properties this gives us:

| Property | Mechanism |
|---|---|
| **Key isolation** | KMS HSM holds the private key. No process — including the running a2a-agent — can read it. Compromising the agent gets `kms:Sign` access for the lifetime of the IAM session (15 min), not the key. |
| **Audit** | Every `kms:Sign` / `kms:GetPublicKey` call is logged to CloudTrail with timestamp, IAM principal, key ARN, and session metadata. Cross-referenceable with the a2a-agent's `executionAudit` table by `sessionId` / `txHash`. |
| **IAM-scoped access** | The runtime IAM role is OIDC-federated from Vercel; the trust policy pins `aud` + `sub` claims to a single Vercel project + environment. A leaked role ARN is useless without a Vercel-signed JWT whose claims match. |
| **Algorithm pinning** | The IAM policy pins `SigningAlgorithm = ECDSA_SHA_256` and `MessageType = DIGEST`. An attacker who pops the agent process cannot ask KMS to hash arbitrary input or sign with a non-secp256k1 algorithm. |
| **Defense in depth** | The signer CMK's key policy explicitly **denies** `kms:Encrypt`, `kms:Decrypt`, and `kms:GenerateDataKey` on the signing key. The K2 encryption key sits behind a separate CMK with its own policy. Cross-misuse is blocked at both the role policy and the key policy. |

---

## Prerequisites

- **An AWS account** with permission to create KMS CMKs and IAM roles. Recommend
  the same account that holds the K2 encryption key.
- **An IAM admin user/role** for this one-time setup. The runtime role should NOT
  have any of the admin permissions used here.
- **K2 setup either complete or done in parallel.** The K2 runbook (in
  `output/KMS-IMPLEMENTATION-PLAN.md` §8.1) creates the Vercel OIDC identity
  provider and the runtime IAM role with permissions on the K2 envelope key.
  K4 adds a sibling signing key and extends the same role's permissions. If K2
  is not done, follow §8.1 of the KMS plan up to and including the OIDC
  provider creation before continuing here.
- **A Vercel project with OIDC federation enabled.** Project Settings → General
  → OIDC Federation → Enable. Required for both K2 and K4.
- **The a2a-agent on the K4 PR-2 build.** PR-1 (local-secp256k1 layering) and
  PR-2 (AWS KMS signer implementation) must be merged before this runbook can
  be executed end-to-end. Until then, the `A2A_KMS_BACKEND=aws-kms` branch of
  `buildSignerBackend` throws "not yet implemented".

---

## Step 1 — Create the asymmetric KMS key

AWS Console path: **KMS → Customer managed keys → Create key**.

Wizard answers:

| Field | Value |
|---|---|
| Key type | **Asymmetric** |
| Key usage | **Sign and verify** |
| Key spec | **ECC_SECG_P256K1** — this is the secp256k1 curve EVM uses. **Do not** pick `ECC_NIST_P256` or `ECC_SECG_P256R1`; both are the wrong curve and the signer will fail at startup. |
| Regionality | **Single-region** (multi-region is operationally heavier and gives no integrity gain for this threat model — see K4 plan §14). |
| Alias | `alias/smart-agent-master-eoa-signer` (recommended). Aliases let you swap the underlying key id during rotation without touching every consumer; we still set `AWS_KMS_SIGNER_KEY_ID` to the **ARN** rather than the alias so a misconfigured alias can't silently redirect signing to a different key. |
| Description | "Master EOA signing key for smart-agent a2a-agent. Rotation procedure: docs/operations/kms-signer-setup.md." |
| Key administrators | The human admin (you). **Do not** add the runtime role here — administrators can disable/delete the key; the runtime must not. |
| Key users | Leave empty in the wizard — we set this via the key policy in the next step. Or pre-select the runtime role from K2; the wizard adds it as a key user (effectively giving it `kms:Sign`, `kms:Verify`, `kms:GetPublicKey`, `kms:DescribeKey`). Either path works; the explicit key policy below is the source of truth. |

After the wizard finishes, click **Edit** on the key policy and replace the
generated policy with this complete document. Substitute `111122223333` with
your AWS account id and the full ARN of the runtime IAM role created in Step 3
(or the placeholder until Step 3 is done — you can come back and tighten this).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnableRootAccountForKeyAdmin",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:root" },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "AllowAdminToManageKey",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:user/<YOUR_ADMIN_USER>" },
      "Action": [
        "kms:Describe*",
        "kms:Get*",
        "kms:List*",
        "kms:TagResource",
        "kms:UntagResource",
        "kms:EnableKey",
        "kms:DisableKey",
        "kms:ScheduleKeyDeletion",
        "kms:CancelKeyDeletion",
        "kms:PutKeyPolicy",
        "kms:UpdateAlias"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowA2AAgentRuntimeToSign",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:role/SmartAgentA2A" },
      "Action": [
        "kms:Sign",
        "kms:GetPublicKey",
        "kms:DescribeKey"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:SigningAlgorithm": "ECDSA_SHA_256",
          "kms:MessageType": "DIGEST"
        }
      }
    },
    {
      "Sid": "DenyEncryptionUseOnSignerKey",
      "Effect": "Deny",
      "Principal": "*",
      "Action": [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:ReEncrypt*",
        "kms:GenerateDataKey",
        "kms:GenerateDataKeyWithoutPlaintext",
        "kms:GenerateDataKeyPair",
        "kms:GenerateDataKeyPairWithoutPlaintext"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DenyAllOtherPrincipals",
      "Effect": "Deny",
      "NotPrincipal": {
        "AWS": [
          "arn:aws:iam::111122223333:role/SmartAgentA2A",
          "arn:aws:iam::111122223333:user/<YOUR_ADMIN_USER>",
          "arn:aws:iam::111122223333:root"
        ]
      },
      "Action": [
        "kms:Sign",
        "kms:GetPublicKey"
      ],
      "Resource": "*"
    }
  ]
}
```

The three `Deny` statements are defense-in-depth:

- **`DenyEncryptionUseOnSignerKey`** — even if a future operator accidentally
  adds `kms:Decrypt` to the runtime policy, the key policy refuses to evaluate
  it. The signer key is signing-only by both `KeyUsage=SIGN_VERIFY` (enforced
  at KMS layer) **and** explicit deny on every encryption verb. Belt and
  suspenders.
- **`DenyAllOtherPrincipals`** — only the runtime role + the admin user + the
  account root may call `kms:Sign` or `kms:GetPublicKey`. Without this, any
  role in the AWS account with a sufficiently permissive identity policy
  could call `kms:Sign` against this key.
- The `Condition` on `AllowA2AAgentRuntimeToSign` pins `SigningAlgorithm` and
  `MessageType`. The signer SDK only ever calls with `ECDSA_SHA_256` +
  `DIGEST`; pinning here means a compromised agent process cannot fall back
  to a different algorithm or ask KMS to hash arbitrary input.

After saving the policy, copy the key ARN from the key-details page. It looks
like:

```
arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-1234-5678-90ab-cdef01234567
```

You will set this as `AWS_KMS_SIGNER_KEY_ID` in Step 5. Record it alongside the
K2 encryption-key ARN in your secrets-of-record document.

---

## Step 2 — Create / extend the IAM trust policy (Vercel OIDC)

If K2 setup already completed, the OIDC identity provider already exists in
your account. Skip to Step 3.

If not, AWS Console path: **IAM → Identity providers → Add provider → OpenID
Connect**.

| Field | Value |
|---|---|
| Provider URL | `https://oidc.vercel.com/<your-vercel-team-slug>` |
| Audience | `https://vercel.com/<your-vercel-team-slug>` |
| Thumbprint | AWS auto-fetches from Vercel's JWKS URL — do not hand-edit. |

Click **Add provider**. The provider ARN looks like
`arn:aws:iam::111122223333:oidc-provider/oidc.vercel.com/<team-slug>` — note it
for the trust policy in Step 3.

---

## Step 3 — Extend the IAM role permissions

The recommended pattern is **one runtime role that holds permissions for both
the K2 encryption key and the K4 signing key**. Operationally simpler than two
roles; each key's policy still scopes access to that single role; AWS evaluates
identity policy AND key policy on every KMS operation so a single role with
broad identity permissions cannot escape per-key constraints.

AWS Console path: **IAM → Roles → SmartAgentA2A** (or whatever you named it in
K2) → **Permissions** tab → **Add permissions → Create inline policy**.

If you don't have a K2 role yet, create one first: **IAM → Roles → Create role
→ Web identity → Identity provider = the Vercel OIDC provider from Step 2 →
Audience = `https://vercel.com/<team-slug>`**. Name it `SmartAgentA2A`. Set
`MaxSessionDuration` to **900** seconds (15 min — the AWS minimum for
`AssumeRoleWithWebIdentity` and the floor we adopt across providers).

### Trust policy

Identical to K2 (no change). For reference:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VercelOidcFederation",
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::111122223333:oidc-provider/oidc.vercel.com/<TEAM_SLUG>"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.vercel.com/<TEAM_SLUG>:aud": "https://vercel.com/<TEAM_SLUG>",
          "oidc.vercel.com/<TEAM_SLUG>:sub": "owner:<TEAM_SLUG>:project:<PROJECT_ID>:environment:production"
        }
      }
    }
  ]
}
```

The `sub` claim binding is load-bearing: a token from a different Vercel
project or a non-production environment cannot assume this role.
`MaxSessionDuration: 900` (set on the role itself, not the trust policy) caps
credential lifetime.

### Permission policy

Replace the existing K2 identity policy with this complete document.
Substitute the two `<...UUID>` placeholders with your K2 encryption key UUID
and your K4 signing key UUID respectively (or use the full ARNs you recorded
in Step 1 and K2).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EncryptionKey",
      "Effect": "Allow",
      "Action": [
        "kms:GenerateDataKey",
        "kms:Decrypt",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:us-east-1:111122223333:key/<ENCRYPTION_KEY_UUID>",
      "Condition": {
        "ForAnyValue:StringEquals": {
          "kms:EncryptionContextKeys": [
            "sessionId",
            "accountAddress",
            "chainId",
            "expiresAt",
            "keyVersion"
          ]
        },
        "Null": {
          "kms:EncryptionContext:sessionId": "false",
          "kms:EncryptionContext:accountAddress": "false",
          "kms:EncryptionContext:chainId": "false",
          "kms:EncryptionContext:expiresAt": "false",
          "kms:EncryptionContext:keyVersion": "false"
        }
      }
    },
    {
      "Sid": "SignerKey",
      "Effect": "Allow",
      "Action": [
        "kms:Sign",
        "kms:GetPublicKey",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:us-east-1:111122223333:key/<SIGNER_KEY_UUID>",
      "Condition": {
        "StringEquals": {
          "kms:SigningAlgorithm": "ECDSA_SHA_256",
          "kms:MessageType": "DIGEST"
        }
      }
    },
    {
      "Sid": "DenyKeyMaterialExfiltration",
      "Effect": "Deny",
      "Action": [
        "kms:GetParametersForImport",
        "kms:ImportKeyMaterial",
        "kms:DeleteImportedKeyMaterial",
        "kms:ScheduleKeyDeletion",
        "kms:DisableKey",
        "kms:PutKeyPolicy",
        "kms:CreateGrant"
      ],
      "Resource": "*"
    }
  ]
}
```

Two things to note:

- **The `SignerKey` statement has NO encryption-context condition.** Asymmetric
  signing does not use `EncryptionContext` — that's a symmetric-encryption
  feature. The binding-tuple integrity for signing comes from the digest
  itself (the canonical `sa:sign:v1` digest, or the viem-computed
  EIP-191/EIP-712/EIP-1559 hash). CloudTrail still records the call; the
  `executionAudit` table cross-references with sessionId/txHash for forensics.
- **`DenyKeyMaterialExfiltration`** is `Resource: "*"`, applying to BOTH keys.
  The runtime role can never `DisableKey`, `ScheduleKeyDeletion`, or
  `CreateGrant` on any KMS key in the account — those are admin operations
  performed by the human operator during rotation (Step 9 of the rotation
  procedure below).

Save the policy. The role is now ready to do both K2 envelope ops and K4
signing ops.

---

## Step 4 — Derive the EVM address for this key

This is the binding step. **The KMS public key determines the on-chain EVM
address; nothing else.** The address is `keccak256(uncompressedPubKey).slice(-20)`
where the uncompressed pubkey is the 64-byte `X || Y` from the SEC1 point
returned by `kms:GetPublicKey` (with the leading `0x04` prefix dropped).

Use the new CLI:

```bash
# From the repo root, with AWS credentials available in the default chain
# (env vars, ~/.aws/credentials, SSO session, ...). The CLI does NOT use
# Vercel OIDC — you run it interactively from your workstation.
pnpm exec tsx scripts/kms-signer-address.ts \
  --region us-east-1 \
  --key-id arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-1234-5678-90ab-cdef01234567
```

If you have multiple AWS profiles:

```bash
pnpm exec tsx scripts/kms-signer-address.ts \
  --region us-east-1 \
  --profile smart-agent-prod \
  --key-id arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-1234-5678-90ab-cdef01234567
```

Output (success case):

```
[kms-signer-address] keyId   : arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-1234-5678-90ab-cdef01234567
[kms-signer-address] keySpec : ECC_SECG_P256K1
[kms-signer-address] address : 0xDEADBEEF12345678901234567890ABCDEF000001
```

**Record the address in your runbook log.** This is the master EOA. Pre-fund
it with gas before any production traffic — the master EOA pays for
`EntryPoint.handleOps`.

The CLI prints `usage` and exits 0 when called with `--help`. It also asserts
`KeySpec === 'ECC_SECG_P256K1'` and exits non-zero if the key was created with
the wrong spec (e.g. `ECC_NIST_P256`).

Required IAM permissions on the AWS principal you're calling the CLI as:

- `kms:GetPublicKey` on the signer key ARN.
- `kms:DescribeKey` on the signer key ARN (optional but recommended — the CLI
  uses it to surface the key spec assertion).

---

## Step 5 — Provision Vercel env vars

In the Vercel project dashboard: **Settings → Environment Variables**. Set the
following for the **Production** environment (and **Preview** if you want
preview deployments to exercise the prod path — recommended for catching
config drift early).

| Variable | Value |
|---|---|
| `A2A_KMS_BACKEND` | `aws-kms` |
| `AWS_REGION` | `us-east-1` (or wherever your KMS keys live; both keys must be in the same region) |
| `AWS_ROLE_ARN` | `arn:aws:iam::111122223333:role/SmartAgentA2A` |
| `AWS_KMS_KEY_ID` | `arn:aws:kms:us-east-1:111122223333:key/<ENCRYPTION_KEY_UUID>` (K2 envelope key) |
| `AWS_KMS_SIGNER_KEY_ID` | `arn:aws:kms:us-east-1:111122223333:key/<SIGNER_KEY_UUID>` (K4 signing key, from Step 1) |

**Do NOT set these:**

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `A2A_MASTER_PRIVATE_KEY` / `A2A_MASTER_EOA_PRIVATE_KEY`
- `A2A_SESSION_SECRET` (Sprint 1 W2.2 S1.3 — config.ts REFUSES to start production with both `A2A_KMS_BACKEND=aws-kms` and this env var present. The secret is HKDF input keying material for the dev `local-aes` provider; AWS KMS does not need it, and an unused master secret in a production env is a forensics liability with no operational value.)

The OIDC + IAM trust handles credentials (the `@vercel/oidc-aws-credentials-provider`
exchanges the per-invocation Vercel OIDC token for short-lived AWS STS creds).
The KMS handles keys. Any long-lived AWS access key or in-env private key in
the production environment is a regression — the CI guard
(`scripts/check-no-bypass.sh`, extended in K4 PR-5) refuses to land a deploy
with either present.

**Session action-counter defaults (Sprint 2 S2.1).** Person-mcp's WalletAction verifier enforces both `SessionGrant.v1.scope.maxActions` and `scope.maxActionsPerMinute`. Per-grant values always win when present; when the minted grant omits either field, the verifier applies defense-in-depth defaults from `apps/person-mcp/src/config.ts`. Operators who want a tighter posture per environment can override:

| Variable | Default | Effect |
|---|---|---|
| `SESSION_DEFAULT_MAX_ACTIONS` | `1000` | Total action ceiling per session when the grant omits `scope.maxActions`. |
| `SESSION_DEFAULT_MAX_ACTIONS_PER_MINUTE` | `60` | Sliding 60-second window cap when the grant omits `scope.maxActionsPerMinute`. |

Both are integers >= 0. Garbage values throw at startup rather than silently defaulting. No secrets — these are budget knobs, safe to set in plain env. Multi-instance rate sharing is out of scope until Sprint 3 (SQLite → Postgres); within a single person-mcp process the check-and-increment is atomic (`better-sqlite3` synchronous transaction).

**Legacy session fallback (Sprint 1 W2.2 S1.6).** `apps/a2a-agent/src/middleware/require-session.ts` has a dev-era fallback (Path B) that accepted bearers tied to rows in the legacy `sessions` table — including demo-login rows. In production this path is closed by default. The env var:

| Variable | Production value | Effect |
|---|---|---|
| `ALLOW_LEGACY_A2A_SESSIONS` | unset (recommended) | `false` by default in `NODE_ENV=production`. Path B short-circuits with 401 + audit-deny row tagged `legacy-session-fallback-disabled`. |
| `ALLOW_LEGACY_A2A_SESSIONS=true` | explicit opt-in | Restores Path B as a temporary escape hatch (incident response, staged migration). Every legacy reach still emits an audit-deny row so the override is always visible. |

Garbage values (`maybe`, `0.5`) throw at startup rather than silently defaulting.

The startup posture is summarized in a single boot-log line so an operator can confirm both invariants at a glance:

```
  startup posture: NODE_ENV=production A2A_KMS_BACKEND=aws-kms ALLOW_LEGACY_A2A_SESSIONS=false
```

---

## Step 6 — Boot-time verification

After saving the env vars and triggering a redeploy, watch the a2a-agent boot
log for this single line (emitted on the first call to `getMasterSigner()`,
which the running deployment makes lazily at first userOp):

```
[kms-signer] address=0xDEADBEEF... keyId=arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-...
```

Verification:

- **The address MUST match what `kms-signer-address.ts` printed in Step 4.** If
  they differ, the env var points at the wrong key. Stop traffic, fix the
  env var, redeploy.
- **The keyId MUST match the ARN you set in `AWS_KMS_SIGNER_KEY_ID`.** Same
  failure mode if they differ; same remediation.

If you want to make the mismatch a hard failure rather than a manual check,
set the optional `EXPECTED_KMS_SIGNER_ADDRESS` env var (K4 plan §8.2). When
set, the a2a-agent asserts the derived address equals the expected value at
first signer use and `process.exit(1)`s on mismatch. Use this in production
once the expected address is stable; do NOT use it in preview environments
where the signer key may legitimately differ.

After the address is verified, run a single canary userOp through any
master-EOA-paid path (e.g. a userOp redemption that triggers
`handleOps`). Confirm:

1. The userOp lands on-chain.
2. CloudTrail records the matching `kms:Sign` call (same minute, principal =
   `SmartAgentA2A`).
3. No `kms:Sign` errors in CloudWatch metrics.

---

## Rotation procedure

Per K4 plan §9. KMS asymmetric keys are **immutable** — the public key (and
therefore the derived EVM address) for a given CMK can never change. AWS KMS's
automatic rotation only applies to symmetric keys. Rotation of the K4 signing
key is therefore an **on-chain** operation: every smart account that lists the
master EOA as an owner must be told about the new address via
`AgentAccount.addOwner(newAddress)` (an `onlySelf` call requiring a userOp
signed by the **old** key — only the live signer can authorize rotation).

There are two flavours:

- **Planned rotation** (annual, policy change, post-incident hygiene):
  procedure below; zero downtime if executed correctly.
- **Emergency rotation** (suspected compromise of the old key): same procedure
  but step 7's soak collapses to "as soon as the new key works"; step 9's
  `DisableKey` is immediate (in-flight signatures fail with
  `KMSInvalidStateException`, surfaced as "kms key unavailable").

### Step-by-step

| Step | Operator action | What happens on-chain | What happens in a2a-agent |
|---|---|---|---|
| 1 | Create a NEW asymmetric KMS key (same spec: `ECC_SECG_P256K1`, `SIGN_VERIFY`). Follow Step 1 of this runbook. **Do NOT disable the old key yet.** | — | — |
| 2 | `pnpm exec tsx scripts/kms-signer-address.ts --region us-east-1 --key-id <NEW_ARN>` → record `0xNEW...` | — | — |
| 3 | Pre-fund `0xNEW...` with gas (master EOA pays for `handleOps`). | — | — |
| 4 | From the running a2a-agent (still signing with the OLD key), submit a userOp per smart account that calls `agentAccount.execute(agentAccount, 0, abi.encodeWithSelector(IAgentAccount.addOwner, 0xNEW))`. See "Helper script" below. | Every account now has BOTH old + new as owners. | a2a-agent uses OLD key to sign. |
| 5 | Verify on-chain: `agentAccount.isOwner(0xNEW) == true` for every account. (`scripts/check-owners.ts` — see helper note below.) | — | — |
| 6 | In Vercel: update `AWS_KMS_SIGNER_KEY_ID = <NEW_ARN>`. Trigger redeploy. | — | a2a-agent reads NEW pubkey on startup; logs `[kms-signer] address=0xNEW...`; signs with NEW key. |
| 7 | Observe **24 hours** of clean operation. Watch for: signing failures in CloudWatch, userOp reverts attributable to signature mismatch, anomalous `kms:Sign` volume on the OLD key (should drop to zero). For emergency rotation skip to step 8 immediately. | — | — |
| 8 | From the now-NEW-keyed a2a-agent, submit a userOp per account: `agentAccount.execute(agentAccount, 0, abi.encodeWithSelector(IAgentAccount.removeOwner, 0xOLD))`. | Old address is removed; only the new address remains as owner. | a2a-agent uses NEW key. |
| 9 | `aws kms disable-key --key-id <OLD_ARN>`. Keep disabled for ≥30 days as an audit-trail anchor, then `aws kms schedule-key-deletion --key-id <OLD_ARN> --pending-window-in-days 30` if desired. | — | OLD key now refuses any Sign call. |

### Helper scripts (in scope for the operator, recommended)

Two operations in the table above require iterating over every smart account
owned by the master EOA. The recommended pattern is a single-purpose Foundry
script or TypeScript helper, run from the operator workstation against the
production RPC. Suggested files (NOT shipped in this PR — write per rotation
event):

- `scripts/rotation/add-owner-all.ts` — iterate the on-chain account list from
  `AgentAccountFactory` (or your account registry of record), submit
  `addOwner(newAddr)` userOps signed by the old KMS-backed master EOA. Use
  the existing `apps/a2a-agent` redemption path for signing; do NOT
  open a separate `kms:Sign` connection from the operator workstation.
- `scripts/rotation/check-owners.ts` — read-only verification that
  `agentAccount.isOwner(newAddr) == true` for every account. Run before step 6
  and again before step 8.
- `scripts/rotation/remove-owner-all.ts` — mirror of `add-owner-all.ts` for
  step 8.

A Foundry-flavoured alternative (`script/RotateKmsSigner.s.sol`) is equally
fine; pick whichever your team operates more comfortably.

### Critical invariants

- **No "atomic switch" exists.** Between step 4 and step 8, every account has
  both old and new owners — this is the only safe transition. Trying to swap
  owners atomically in step 4 (e.g. `removeOwner(old) + addOwner(new)` in one
  `executeBatch`) would brick the account if step 6 fails or the new key's
  pubkey was extracted incorrectly. The two-key window is mandatory.
- **`addOwner` and `removeOwner` are `onlySelf`-callable** (confirmed in
  `packages/contracts/src/AgentAccount.sol:548-552`). The only way to reach
  them is via the account's own `execute(...)` path, which itself requires an
  owner-signed userOp. The OLD key is therefore the only entity that can
  authorize step 4 — and that's correct: rotation must require the live
  signer.
- **`removeOwner` enforces "at least one signer remains"**
  (`AgentAccount.sol:560-575`). Don't try to remove the last owner.
- **Wrong-new-key catastrophe**: if step 2 prints the wrong address (operator
  pasted the wrong KeyId), step 4 adds a useless owner. Detection: step 6's
  startup log shows the runtime address — if it doesn't match the runbook
  record, abort. Recovery: don't do step 8. The mistaken owner is dormant
  (its KMS key is fine but no one is using it) and can be removed later from
  the OLD key.
- **The OLD key is the only thing that can authorize step 4.** If the OLD key
  is already lost (which is what triggered the rotation), there is no clean
  rotation — only a recovery procedure via a guardian/passkey path (out of
  scope for K4; see Hardening §3 on guardian rules).

---

## Rollback

If anything goes wrong post-cutover and you need to revert signing authority,
options in order of preference:

1. **Best — pre-provisioned emergency signer (recommended).** BEFORE the
   cutover, generate a SECOND KMS asymmetric key as an "emergency signer" and
   add ITS address as an owner of every smart account during normal
   operation. Then a single env-var change recovers from a primary-key
   failure: set `AWS_KMS_SIGNER_KEY_ID` to the emergency-signer ARN and
   redeploy. No on-chain operations needed at recovery time. Maintenance
   burden: the emergency signer must be kept current with every new smart
   account created (add it as an owner at account creation). This is the
   cleanest answer and the one the K4 plan §9 recommends adopting at
   production cutover.
2. **Backup KMS key + on-chain `addOwner`.** If you didn't pre-provision an
   emergency signer, you can still recover by creating a new KMS key, running
   `kms-signer-address.ts`, then submitting `addOwner(newAddr)` from any
   remaining live signer. This is the rotation procedure (above), just under
   pressure.
3. **Worst — local-aes fallback.** Setting `A2A_KMS_BACKEND=local-aes` in
   production would revert to env-resident signing — but the production guard
   in `buildSignerBackend` (`apps/a2a-agent/src/auth/key-provider.ts:130-135`)
   explicitly refuses `local-aes` when `NODE_ENV === 'production'`. This
   guard exists for a reason: env-resident keys are the threat model K4 is
   designed to eliminate. **Do not disable the production guard.** If the
   only path forward is local-aes, you've hit a scenario the design
   explicitly does not support; escalate.

Open question for the operator at cutover time: pick option (1) or (2) and
document the choice. The plan recommends (1); the runbook supports either.

---

## Audit trail

- **AWS CloudTrail** captures every `kms:Sign` and `kms:GetPublicKey` call on
  the signer key, with timestamp, IAM principal (the assumed-role session
  ARN, which includes the Vercel deployment id in the session name), key
  ARN, request parameters (`MessageType`, `SigningAlgorithm`), and outcome.
  Response payloads are NOT logged (KMS strips signatures from CloudTrail by
  design).
- **a2a-agent `executionAudit` table** records, per signed userOp:
  `sessionId`, `accountAddress`, `chainId`, `actionId`, `txHash`, and the
  derived signer address. Cross-reference with CloudTrail by timestamp +
  principal + key ARN to reconstruct any specific transaction's full chain
  of custody.
- **CloudWatch alarms** (recommended; not provisioned by this PR):
  - `kms:Sign` rate ≥ 10× normal baseline over a 5-minute window — possible
    abuse of compromised process.
  - `kms:Sign` errors ≥ 1% over a 5-minute window — KMS unhealthy or IAM
    misconfigured.
  - Any `kms:DisableKey`, `kms:ScheduleKeyDeletion`, or `kms:PutKeyPolicy`
    on the signer key ARN — these are admin operations and should never
    happen except during planned rotations; alarm on them.

---

## Open questions for the operator

These are decisions the team has not finalised. Pick at provisioning time and
document the choice in your team's secrets-of-record document.

1. **Alias name.** The runbook recommends `alias/smart-agent-master-eoa-signer`.
   If you operate multiple smart-agent environments (staging + production +
   dev-fleet) in the same AWS account, suffix the alias:
   `alias/smart-agent-master-eoa-signer-prod`, etc. The env var always points
   at the full ARN, so aliases are operator UX only.
2. **Emergency signer policy.** Per the Rollback section above, the
   recommended pattern is a pre-provisioned secondary KMS key whose address
   is added as a secondary owner of every smart account at account creation.
   Decide before cutover: who holds the emergency-signer key id? Where is
   that recorded? What process triggers its use? Out of scope for this
   runbook; record the decision in your incident-response playbook.
3. **Region.** All KMS keys must be in the same region as your a2a-agent
   Vercel deployment region for latency. Cross-region `kms:Sign` adds 20–80
   ms per signature. If the deployment is multi-region, see K4 plan §14
   (multi-region replication is out of scope for K4 but architecturally
   possible).

---

## Inter-service MAC keys (K3-extension)

K3-extension migrates the eight static env-resident HMAC secrets
(`WEB_TO_A2A_HMAC_KEY`, `A2A_INTERSERVICE_HMAC_KEY_<MCP>` for
person/org/family/people-group/verifier/skill/geo) to AWS KMS HMAC keys.
Each MAC key is a SEPARATE Customer Managed Key — eight keys total — so a
compromise of one MAC key cannot pivot to another, and per-key IAM scoping
limits which principal can call `kms:GenerateMac` / `kms:VerifyMac` on
each key.

The canonical-message format is UNCHANGED: every binding (timestamp,
nonce, audience, route, sha256(body)) lives inside the signed message
because KMS HMAC keys do NOT support `EncryptionContext` (see
`KMS-IMPLEMENTATION-PLAN.md` §13). The wire format and middleware
behaviour are identical to pre-K3-ext; only the primitive that produces
the MAC swaps from `crypto.createHmac` to `kms:GenerateMac`.

### Key inventory

| MAC key id | env var (legacy / dev) | env var (AWS KMS / prod) | Who SIGNS | Who VERIFIES |
|---|---|---|---|---|
| `web-to-a2a` | `WEB_TO_A2A_HMAC_KEY` | `AWS_KMS_MAC_KEY_ID_WEB_TO_A2A` | web role | a2a-agent role |
| `a2a-to-person` | `A2A_INTERSERVICE_HMAC_KEY_PERSON` | `AWS_KMS_MAC_KEY_ID_A2A_TO_PERSON` | person-mcp role | a2a-agent role |
| `a2a-to-org` | `A2A_INTERSERVICE_HMAC_KEY_ORG` | `AWS_KMS_MAC_KEY_ID_A2A_TO_ORG` | org-mcp role | a2a-agent role |
| `a2a-to-family` | `A2A_INTERSERVICE_HMAC_KEY_FAMILY` | `AWS_KMS_MAC_KEY_ID_A2A_TO_FAMILY` | family-mcp role | a2a-agent role |
| `a2a-to-people-group` | `A2A_INTERSERVICE_HMAC_KEY_PEOPLE_GROUP` | `AWS_KMS_MAC_KEY_ID_A2A_TO_PEOPLE_GROUP` | people-group-mcp role | a2a-agent role |
| `a2a-to-verifier` | `A2A_INTERSERVICE_HMAC_KEY_VERIFIER` | `AWS_KMS_MAC_KEY_ID_A2A_TO_VERIFIER` | verifier-mcp role | a2a-agent role |
| `a2a-to-skill` | `A2A_INTERSERVICE_HMAC_KEY_SKILL` | `AWS_KMS_MAC_KEY_ID_A2A_TO_SKILL` | skill-mcp role | a2a-agent role |
| `a2a-to-geo` | `A2A_INTERSERVICE_HMAC_KEY_GEO` | `AWS_KMS_MAC_KEY_ID_A2A_TO_GEO` | geo-mcp role | a2a-agent role |

### Step 1 — Create the KMS HMAC keys

For EACH of the eight MAC keys, AWS Console path: **KMS → Customer
managed keys → Create key**.

| Field | Value |
|---|---|
| Key type | **Symmetric** |
| Key usage | **Generate and verify MAC** |
| Key spec | **HMAC_256** |
| MAC algorithms | **HMAC_SHA_256** |
| Regionality | **Single-region** (same region as the K2/K4 keys) |
| Alias | `alias/smart-agent-mac-<MAC_KEY_ID>` — e.g. `alias/smart-agent-mac-web-to-a2a`, `alias/smart-agent-mac-a2a-to-person`, ... |
| Description | "Inter-service HMAC for `<MAC_KEY_ID>` route. K3-extension." |
| Key administrators | The human admin (you) — same as K4. |
| Key users | None at the wizard layer; the per-key policy below pins them. |

Record each key's ARN as you create it. You'll set eight
`AWS_KMS_MAC_KEY_ID_<MAC_KEY_ID>` env vars on the a2a-agent Vercel
deployment plus one each on the web and MCP deployments.

### Step 2 — Per-key policies

a2a-agent's runtime role needs `kms:VerifyMac` on ALL eight keys (it
terminates every inbound HMAC envelope). The web role needs
`kms:GenerateMac` on `web-to-a2a` ONLY. Each MCP role needs
`kms:GenerateMac` on `a2a-to-<mcp>` ONLY.

Per-key policy template (replicate for each of the eight keys; substitute
`<MAC_KEY_ID>` and the principal ARNs for each):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnableRootAccountForKeyAdmin",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:root" },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "AllowAdminToManageKey",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:user/<YOUR_ADMIN_USER>" },
      "Action": [
        "kms:Describe*", "kms:Get*", "kms:List*",
        "kms:EnableKey", "kms:DisableKey",
        "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion",
        "kms:PutKeyPolicy", "kms:UpdateAlias"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowA2AAgentToVerify",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:role/SmartAgentA2A" },
      "Action": ["kms:VerifyMac", "kms:DescribeKey"],
      "Resource": "*",
      "Condition": {
        "StringEquals": { "kms:MacAlgorithm": "HMAC_SHA_256" }
      }
    },
    {
      "Sid": "AllowOriginatorToGenerate",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111122223333:role/SmartAgentWeb"
      },
      "Action": ["kms:GenerateMac", "kms:DescribeKey"],
      "Resource": "*",
      "Condition": {
        "StringEquals": { "kms:MacAlgorithm": "HMAC_SHA_256" }
      }
    },
    {
      "Sid": "DenyAllOtherPrincipals",
      "Effect": "Deny",
      "NotPrincipal": {
        "AWS": [
          "arn:aws:iam::111122223333:role/SmartAgentA2A",
          "arn:aws:iam::111122223333:role/SmartAgentWeb",
          "arn:aws:iam::111122223333:user/<YOUR_ADMIN_USER>",
          "arn:aws:iam::111122223333:root"
        ]
      },
      "Action": ["kms:GenerateMac", "kms:VerifyMac"],
      "Resource": "*"
    }
  ]
}
```

For the `a2a-to-<mcp>` keys, replace `SmartAgentWeb` with the corresponding
MCP role (e.g. `SmartAgentPersonMcp`, `SmartAgentOrgMcp`, ...). The pattern
is one role per service; each role can call `kms:GenerateMac` on ONLY its
own MAC key.

### Step 3 — Extend IAM identity policies

a2a-agent's `SmartAgentA2A` role identity policy (extend the existing K2/K4
policy with these statements):

```json
{
  "Sid": "InterServiceMACVerify",
  "Effect": "Allow",
  "Action": ["kms:VerifyMac", "kms:DescribeKey"],
  "Resource": [
    "arn:aws:kms:us-east-1:111122223333:key/<WEB_TO_A2A_UUID>",
    "arn:aws:kms:us-east-1:111122223333:key/<A2A_TO_PERSON_UUID>",
    "arn:aws:kms:us-east-1:111122223333:key/<A2A_TO_ORG_UUID>",
    "arn:aws:kms:us-east-1:111122223333:key/<A2A_TO_FAMILY_UUID>",
    "arn:aws:kms:us-east-1:111122223333:key/<A2A_TO_PEOPLE_GROUP_UUID>",
    "arn:aws:kms:us-east-1:111122223333:key/<A2A_TO_VERIFIER_UUID>",
    "arn:aws:kms:us-east-1:111122223333:key/<A2A_TO_SKILL_UUID>",
    "arn:aws:kms:us-east-1:111122223333:key/<A2A_TO_GEO_UUID>"
  ],
  "Condition": {
    "StringEquals": { "kms:MacAlgorithm": "HMAC_SHA_256" }
  }
}
```

Web's `SmartAgentWeb` role identity policy adds ONE statement:

```json
{
  "Sid": "InterServiceMACGenerate",
  "Effect": "Allow",
  "Action": ["kms:GenerateMac", "kms:DescribeKey"],
  "Resource": "arn:aws:kms:us-east-1:111122223333:key/<WEB_TO_A2A_UUID>",
  "Condition": {
    "StringEquals": { "kms:MacAlgorithm": "HMAC_SHA_256" }
  }
}
```

Each MCP role gets ONE corresponding statement scoped to its own key
ARN. This is the per-key blast-radius reduction: a leaked person-mcp role
can only call `kms:GenerateMac` on `a2a-to-person`; it cannot mint MACs
for any other route.

### Step 4 — Vercel env vars

| App | Variables (additions to the K2/K4 set) |
|---|---|
| a2a-agent | `AWS_KMS_MAC_KEY_ID_WEB_TO_A2A`, `AWS_KMS_MAC_KEY_ID_A2A_TO_PERSON`, `AWS_KMS_MAC_KEY_ID_A2A_TO_ORG`, `AWS_KMS_MAC_KEY_ID_A2A_TO_FAMILY`, `AWS_KMS_MAC_KEY_ID_A2A_TO_PEOPLE_GROUP`, `AWS_KMS_MAC_KEY_ID_A2A_TO_VERIFIER`, `AWS_KMS_MAC_KEY_ID_A2A_TO_SKILL`, `AWS_KMS_MAC_KEY_ID_A2A_TO_GEO` |
| web | `AWS_KMS_MAC_KEY_ID_WEB_TO_A2A` only |
| person-mcp | `AWS_KMS_MAC_KEY_ID_A2A_TO_PERSON` only |
| org-mcp | `AWS_KMS_MAC_KEY_ID_A2A_TO_ORG` only |
| family-mcp | `AWS_KMS_MAC_KEY_ID_A2A_TO_FAMILY` only |
| people-group-mcp | `AWS_KMS_MAC_KEY_ID_A2A_TO_PEOPLE_GROUP` only |
| verifier-mcp | `AWS_KMS_MAC_KEY_ID_A2A_TO_VERIFIER` only |
| skill-mcp | `AWS_KMS_MAC_KEY_ID_A2A_TO_SKILL` only |
| geo-mcp | `AWS_KMS_MAC_KEY_ID_A2A_TO_GEO` only |

Set `A2A_KMS_BACKEND=aws-kms` and `AWS_REGION`/`AWS_ROLE_ARN` on every
deployment (same values used for K2/K4 on a2a-agent; each MCP and web
has its OWN `AWS_ROLE_ARN` per the per-key IAM scoping above).

**Do NOT set** the legacy `WEB_TO_A2A_HMAC_KEY` or
`A2A_INTERSERVICE_HMAC_KEY_*` env vars in production. They are kept in
the codebase as the local-aes dev fallback only.

### Audit + rotation

- **CloudTrail** captures every `kms:GenerateMac` and `kms:VerifyMac`
  call with timestamp, IAM principal (the assumed-role session ARN
  including the Vercel deployment id), key ARN, and `kms:MacAlgorithm`.
  Cross-reference with a2a-agent's `interServiceNonce` table by
  timestamp for full request lineage.
- **Rotation**: AWS KMS does NOT support automatic rotation of HMAC
  keys (per AWS docs — only symmetric encryption keys auto-rotate).
  Manual rotation procedure: create a NEW MAC key, set both ARNs in env
  vars (extend the provider to consult a secondary key during the soak —
  not implemented in this PR; future work), drain traffic to the new
  key, retire the old key with `kms:DisableKey`. For an emergency
  rotation, replace the env var atomically; in-flight signatures fail
  with `kms key unavailable` and are retried.
- **CloudWatch alarms** (recommended):
  - `kms:GenerateMac` rate ≥ 10× normal baseline — possible abuse of a
    compromised originator.
  - `kms:VerifyMac` `MacValid=false` rate ≥ 1% over a 5-minute window —
    possible signature forgery attempt or env-var drift.

---

## OAuth salt MAC key (S2.6)

Sprint 2 item S2.6 migrates the legacy `SERVER_PEPPER` symmetric env
secret — used to deterministically salt `google-oauth email →
smart-account` derivation — to the K3-extension MAC family. The new
key id is `oauth-salt`, the canonical-message format is
`oauth-salt:v1:${lower(email)}:${rotation}`, and the primitive is
`kms:GenerateMac` over an `HMAC_SHA_256` KMS HMAC key — identical to
the eight inter-service MAC keys above. Total MAC key count after S2.6:
**9** (8 K3-ext inter-service + 1 web-internal).

### Why a separate key

`oauth-salt` is **web-internal**: the MAC bytes never traverse the
wire. They're consumed inside `/api/auth/google-callback` to compute a
CREATE2 salt for `AgentAccountFactory.createAccount(serverEOA, salt)`.
Conceptually closer to "key wrap" than to "service auth", but the same
KMS primitive applies: a 32-byte deterministic output that cannot be
predicted without the CMK, with CloudTrail visibility on every
derivation.

Keeping it in its **own** CMK matches the per-key blast-radius posture
of the K3-ext family: a compromise of the `oauth-salt` key lets an
attacker enumerate user smart-account addresses (which they could
already do given the public KMS API call audit, but not predict new
ones), but DOES NOT pivot to MAC keys protecting service auth.

| MAC key id | env var (legacy / dev) | env var (AWS KMS / prod) | Who SIGNS | Who VERIFIES |
|---|---|---|---|---|
| `oauth-salt` | `OAUTH_SALT_HMAC_KEY` | `AWS_KMS_MAC_KEY_ID_OAUTH_SALT` | web role | n/a — never verified (output is consumed as a CREATE2 salt) |

### Step 1 — Create the KMS HMAC key

AWS Console path: **KMS → Customer managed keys → Create key**. Use the
same wizard fields as the K3-ext inter-service keys:

| Field | Value |
|---|---|
| Key type | **Symmetric** |
| Key usage | **Generate and verify MAC** |
| Key spec | **HMAC_256** |
| MAC algorithms | **HMAC_SHA_256** |
| Regionality | **Single-region** (same region as the K2/K3-ext/K4 keys) |
| Alias | `alias/smart-agent-mac-oauth-salt` |
| Description | "OAuth deterministic-salt HMAC for google-oauth email → smart-account. Sprint S2.6." |
| Key administrators | The human admin (you) — same as K3-ext / K4. |
| Key users | None at the wizard layer; the per-key policy below pins them. |

Record the new CMK's ARN.

### Step 2 — Per-key policy

Only the web role calls `kms:GenerateMac` on this key. No other principal
needs `kms:VerifyMac` — the output is consumed locally.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnableRootAccountForKeyAdmin",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:root" },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "AllowAdminToManageKey",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:user/<YOUR_ADMIN_USER>" },
      "Action": [
        "kms:Describe*", "kms:Get*", "kms:List*",
        "kms:EnableKey", "kms:DisableKey",
        "kms:ScheduleKeyDeletion", "kms:CancelKeyDeletion",
        "kms:PutKeyPolicy", "kms:UpdateAlias"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowWebToGenerateOauthSaltMac",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:role/SmartAgentWeb" },
      "Action": ["kms:GenerateMac", "kms:DescribeKey"],
      "Resource": "*",
      "Condition": {
        "StringEquals": { "kms:MacAlgorithm": "HMAC_SHA_256" }
      }
    },
    {
      "Sid": "DenyAllOtherPrincipals",
      "Effect": "Deny",
      "NotPrincipal": {
        "AWS": [
          "arn:aws:iam::111122223333:role/SmartAgentWeb",
          "arn:aws:iam::111122223333:user/<YOUR_ADMIN_USER>",
          "arn:aws:iam::111122223333:root"
        ]
      },
      "Action": ["kms:GenerateMac", "kms:VerifyMac"],
      "Resource": "*"
    }
  ]
}
```

Note the deny statement intentionally lists `kms:VerifyMac` too — even
though no principal needs it, the explicit deny tightens audit posture
(any future caller asking for VerifyMac on this key is denied at the
policy boundary, not just by absent allow).

### Step 3 — Extend the web role's identity policy

Append ONE statement to the `SmartAgentWeb` role's permission policy
(alongside the `WebSessionSignerKey` from S1.1 and the
`InterServiceMACGenerate` from K3-ext):

```json
{
  "Sid": "OauthSaltMACGenerate",
  "Effect": "Allow",
  "Action": ["kms:GenerateMac", "kms:DescribeKey"],
  "Resource": "arn:aws:kms:us-east-1:111122223333:key/<OAUTH_SALT_UUID>",
  "Condition": {
    "StringEquals": { "kms:MacAlgorithm": "HMAC_SHA_256" }
  }
}
```

a2a-agent's role does NOT need `kms:VerifyMac` on this key — the salt
output is never verified.

### Step 4 — Vercel env vars

| App | Variables (additions to the K3-ext set) |
|---|---|
| web | `AWS_KMS_MAC_KEY_ID_OAUTH_SALT` |
| a2a-agent | (none — never reads this key) |
| any MCP | (none — never reads this key) |

Set `A2A_KMS_BACKEND=aws-kms` on the web deployment (already required by
K3-ext + S1.1).

**Do NOT set** the legacy `SERVER_PEPPER` env var on the web Vercel
project for the oauth-salt purpose. The variable is still consumed by
the dev-only `dev-pepper` session-signer custody backend
(`apps/web/src/lib/key-custody/dev-pepper.ts`) in local dev, which is
unrelated to oauth — `SESSION_SIGNER_BACKEND=aws-kms` is required in
production, at which point `SERVER_PEPPER` is never read.

### Migration compatibility decision

The user has explicitly stated that there is nothing in production yet
and no need for a deprecated-mode fallback. The new derivation produces
a DIFFERENT 32-byte salt than the legacy
`sha256(SERVER_PEPPER ‖ email ‖ rotation)` for the same inputs.
Consequence:

- **Local dev / demo**: every existing google-derived smart account
  shifts to a NEW counterfactual address on the next login. `./scripts/
  fresh-start.sh` re-deploys onboarding state from scratch; existing
  per-account artifacts (delegations, AnonCreds rows) at the old address
  become unreferenced. `localUserAccounts` rows survive but their
  `smartAccountAddress` will be re-written by the callback's deploy
  step on next login.
- **Production**: not applicable (no production users).

If a future deployment ever needs to preserve existing google-derived
addresses across a `SERVER_PEPPER` → KMS migration, the operator can
seed the new `oauth-salt` KMS HMAC key's bytes with the legacy
`SERVER_PEPPER` material and accept the (small) precondition that the
canonical-message wire format differs from the legacy sha256 layout —
which would require keeping the old derivation as a v0 fallback. Not
implemented in this PR.

### Audit + rotation

- **CloudTrail** captures every `kms:GenerateMac` call with timestamp,
  IAM principal, key ARN, and `kms:MacAlgorithm`. A google-login
  derivation is exactly one `GenerateMac` call per `/api/auth/google-
  callback` hit.
- **Rotation**: rotating the KMS HMAC key changes every google user's
  smart-account address. Treat as immutable. For an emergency rotation
  (key compromise), the per-user `accountSaltRotation` field on
  `localUserAccounts` lets an operator force individual users to a new
  address without rotating the global key — same escape hatch the
  "Start fresh" button already drives.
- **CloudWatch alarms** (recommended):
  - `kms:GenerateMac` rate spike on `oauth-salt` ≥ 10× normal baseline
    — possible attempt to enumerate user addresses by sweeping emails.

---

## Tool-executor signer keys (K5)

K5 extends the K4 pattern to the per-tool executor identities that sign
sub-delegated MCP-tool redeems. Before K5, each tool family's private key
was an env var (`TOOL_EXECUTOR_<FAMILY>_PRIVATE_KEY`) baked into the
Vercel deployment alongside the master EOA. After K5, each family has its
**own** AWS KMS asymmetric `ECC_SECG_P256K1` CMK — a SEPARATE key per
family, so a compromised tool key cannot sign for any other family.

### Tool families

Canonical list lives in `@smart-agent/sdk/key-custody` →
`TOOL_EXECUTOR_IDS`. Today (PR landed):

| Tool id          | Tools it signs                                                | Local env var (dev)                          | Prod env var (KMS key id)                          |
|------------------|---------------------------------------------------------------|----------------------------------------------|----------------------------------------------------|
| `round-awards`   | `round:close`, `round:cancel`, `round:set_awards_root`        | `TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY`     | `AWS_KMS_TOOL_EXECUTOR_ROUND_AWARDS_KEY_ID`        |
| `disbursement`   | `disbursement:claim`                                          | `TOOL_EXECUTOR_DISBURSEMENT_PRIVATE_KEY`     | `AWS_KMS_TOOL_EXECUTOR_DISBURSEMENT_KEY_ID`        |
| `pool-lifecycle` | `pool:close`                                                  | `TOOL_EXECUTOR_POOL_LIFECYCLE_PRIVATE_KEY`   | `AWS_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_KEY_ID`      |
| `grant-awards`   | `grant_proposal:award`, `grant_proposal:revoke_award`         | `TOOL_EXECUTOR_GRANT_AWARDS_PRIVATE_KEY`     | `AWS_KMS_TOOL_EXECUTOR_GRANT_AWARDS_KEY_ID`        |
| `auth-bootstrap` | Web bootstrap-auth handlers (`/api/auth/siwe-verify`, `/api/auth/passkey-signup`, `/api/auth/google-callback`): smart-account deploy, `.agent` name register, resolver bootstrap, deterministic account derivation. Signs operations the user can't perform themselves — they have no wallet yet at first sign-in. | `TOOL_EXECUTOR_AUTH_BOOTSTRAP_PRIVATE_KEY` | `AWS_KMS_TOOL_EXECUTOR_AUTH_BOOTSTRAP_KEY_ID`     |

Note: `auth-bootstrap` is the only tool-executor signer currently
consumed by the **web tier** (the other four run inside a2a-agent).
Web reads it via the lazy singleton in
`apps/web/src/lib/key-custody/tool-executor.ts` →
`getAuthBootstrapSigner()`, which calls
`createToolExecutorSigner('auth-bootstrap', process.env)` from the SDK
and wraps it with `createKmsAccount()`. The one-shot boot banner is

```
[auth-bootstrap-signer] address=<addr> backend=<aws-kms|local-aes>
```

emitted on first use (not at process start). Operators verify the
address matches the runbook record before flipping production traffic
to the new signer.

This signer ALSO owns the `.agent` root in the on-chain
`AgentNameRegistry` so it can `register` new `<label>.agent` names
during passkey signup. `scripts/deploy-local.sh` transfers ownership
from the deployer to this address post-deploy; in production the
transfer happens as a one-shot operator action with the
auth-bootstrap KMS-derived address (no deployer key needed in
deployments after that point — the `.agent` root is owned by a key
whose private material lives only in KMS).

Provisioning follows the same Step 1 / Step 4 sequence as the other
tool families above — create a per-tool KMS CMK with alias
`alias/smart-agent-tool-executor-auth-bootstrap`, derive the EVM
address via `scripts/kms-signer-address.ts`, then run the on-chain
`AgentNameRegistry.setOwner(.agent_root, <addr>)` transfer.

Adding a new sensitive tool family requires updating `TOOL_EXECUTOR_IDS`,
`TOOL_TO_FAMILY` in `apps/a2a-agent/src/lib/tool-executors.ts`, the dev
seed in `scripts/deploy-local.sh`, AND provisioning a new KMS CMK per
this section.

### Provisioning

For **each tool family**, repeat Step 1 through Step 4 of the master
signer setup above, with:

1. **Step 1 — Create the asymmetric KMS key.** Use a per-tool alias to
   keep the AWS Console scannable:

   | Tool id          | Recommended alias                                       |
   |------------------|---------------------------------------------------------|
   | `round-awards`   | `alias/smart-agent-tool-executor-round-awards`          |
   | `disbursement`   | `alias/smart-agent-tool-executor-disbursement`          |
   | `pool-lifecycle` | `alias/smart-agent-tool-executor-pool-lifecycle`        |
   | `grant-awards`   | `alias/smart-agent-tool-executor-grant-awards`          |

   Same KeySpec/KeyUsage as the master signer (`ECC_SECG_P256K1`,
   `SIGN_VERIFY`). Same key policy template; substitute the per-tool
   admin / runtime ARNs as appropriate. The `DenyEncryptionUseOnSignerKey`
   and `DenyAllOtherPrincipals` clauses apply identically.

2. **Step 4 — Derive the EVM address** using
   `scripts/kms-signer-address.ts` (same CLI as the master signer).
   Record the address in your runbook log per tool id. Pre-fund each
   address with gas — every sub-delegated redeem submits a transaction
   AS the executor EOA, so each tool's address pays its own gas.

### IAM policy extension

The recommended pattern remains a single runtime IAM role for the
a2a-agent (`SmartAgentA2A`). Extend the role's identity policy with one
`Statement` per tool key. The `Resource` field on each statement MUST be
pinned to that single tool's ARN — this is the load-bearing
defense-in-depth invariant: a compromised agent process can sign for
whichever tool family its current request handler invokes, but cannot
escalate to a sibling family.

Template (substitute `<...UUID>` placeholders with your real key UUIDs):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EncryptionKey",
      "Effect": "Allow",
      "Action": ["kms:GenerateDataKey", "kms:Decrypt", "kms:DescribeKey"],
      "Resource": "arn:aws:kms:us-east-1:111122223333:key/<ENCRYPTION_KEY_UUID>",
      "Condition": { "ForAnyValue:StringEquals": { "kms:EncryptionContextKeys": ["sessionId", "accountAddress", "chainId", "expiresAt", "keyVersion"] } }
    },
    {
      "Sid": "MasterSignerKey",
      "Effect": "Allow",
      "Action": ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"],
      "Resource": "arn:aws:kms:us-east-1:111122223333:key/<MASTER_SIGNER_KEY_UUID>",
      "Condition": { "StringEquals": { "kms:SigningAlgorithm": "ECDSA_SHA_256", "kms:MessageType": "DIGEST" } }
    },
    {
      "Sid": "ToolExecutorRoundAwardsKey",
      "Effect": "Allow",
      "Action": ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"],
      "Resource": "arn:aws:kms:us-east-1:111122223333:key/<ROUND_AWARDS_KEY_UUID>",
      "Condition": { "StringEquals": { "kms:SigningAlgorithm": "ECDSA_SHA_256", "kms:MessageType": "DIGEST" } }
    },
    {
      "Sid": "ToolExecutorDisbursementKey",
      "Effect": "Allow",
      "Action": ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"],
      "Resource": "arn:aws:kms:us-east-1:111122223333:key/<DISBURSEMENT_KEY_UUID>",
      "Condition": { "StringEquals": { "kms:SigningAlgorithm": "ECDSA_SHA_256", "kms:MessageType": "DIGEST" } }
    },
    {
      "Sid": "ToolExecutorPoolLifecycleKey",
      "Effect": "Allow",
      "Action": ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"],
      "Resource": "arn:aws:kms:us-east-1:111122223333:key/<POOL_LIFECYCLE_KEY_UUID>",
      "Condition": { "StringEquals": { "kms:SigningAlgorithm": "ECDSA_SHA_256", "kms:MessageType": "DIGEST" } }
    },
    {
      "Sid": "ToolExecutorGrantAwardsKey",
      "Effect": "Allow",
      "Action": ["kms:Sign", "kms:GetPublicKey", "kms:DescribeKey"],
      "Resource": "arn:aws:kms:us-east-1:111122223333:key/<GRANT_AWARDS_KEY_UUID>",
      "Condition": { "StringEquals": { "kms:SigningAlgorithm": "ECDSA_SHA_256", "kms:MessageType": "DIGEST" } }
    },
    {
      "Sid": "DenyKeyMaterialExfiltration",
      "Effect": "Deny",
      "Action": ["kms:GetParametersForImport", "kms:ImportKeyMaterial", "kms:DeleteImportedKeyMaterial", "kms:ScheduleKeyDeletion", "kms:DisableKey", "kms:PutKeyPolicy", "kms:CreateGrant"],
      "Resource": "*"
    }
  ]
}
```

Critical: **never collapse the four `ToolExecutor*` statements into one
with multiple resources.** The whole point of K5 is one IAM `Resource`
per tool family, scoped by `Sid` so audit logs (and CloudTrail
queries) can pin a `kms:Sign` call to a single tool family
trivially.

### Vercel env vars

In addition to the K4 vars (`AWS_KMS_SIGNER_KEY_ID`), set in **Production**:

| Variable                                     | Value                                                                                |
|----------------------------------------------|--------------------------------------------------------------------------------------|
| `AWS_KMS_TOOL_EXECUTOR_ROUND_AWARDS_KEY_ID`  | `arn:aws:kms:us-east-1:111122223333:key/<ROUND_AWARDS_KEY_UUID>`                     |
| `AWS_KMS_TOOL_EXECUTOR_DISBURSEMENT_KEY_ID`  | `arn:aws:kms:us-east-1:111122223333:key/<DISBURSEMENT_KEY_UUID>`                     |
| `AWS_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_KEY_ID`| `arn:aws:kms:us-east-1:111122223333:key/<POOL_LIFECYCLE_KEY_UUID>`                   |
| `AWS_KMS_TOOL_EXECUTOR_GRANT_AWARDS_KEY_ID`  | `arn:aws:kms:us-east-1:111122223333:key/<GRANT_AWARDS_KEY_UUID>`                     |

`config.ts` fails fast at boot if any of these is missing or malformed
when `A2A_KMS_BACKEND='aws-kms'`. Do NOT set the legacy
`TOOL_EXECUTOR_*_PRIVATE_KEY` vars in prod — they are dev-only.

### Boot-time verification

On first use of each tool family the a2a-agent emits a one-shot log line
per tool id (mirrors the K4 master signer banner):

```
[tool-executor-signer] toolId=round-awards    address=0x... keyId=arn:aws:kms:us-east-1:111122223333:key/...
[tool-executor-signer] toolId=disbursement    address=0x... keyId=arn:aws:kms:us-east-1:111122223333:key/...
[tool-executor-signer] toolId=pool-lifecycle  address=0x... keyId=arn:aws:kms:us-east-1:111122223333:key/...
[tool-executor-signer] toolId=grant-awards    address=0x... keyId=arn:aws:kms:us-east-1:111122223333:key/...
```

Verify each `address` matches what `scripts/kms-signer-address.ts`
printed during Step 4 for the corresponding key.

### Rotation

The on-chain owner-migration rotation procedure from the master signer
section applies **per tool family**. Each tool family is a separate
identity; rotating one family's key does not affect the others.

In particular:

- The OLD tool-family key is the only entity that can authorize
  `addOwner(newAddr)` for accounts where it is currently an owner.
  Where a tool-family executor needs to act as a signer on user
  AgentAccounts (rare today; this matters if the executor identity is
  ever added as a guardian or co-owner), follow the same nine-step
  table from § "Rotation procedure" of this runbook.
- For the common case — the tool executor is just the LEAF delegate of
  D_sub and never an account owner — rotation reduces to: create the
  new CMK; update the env var; redeploy; observe `[tool-executor-signer]
  toolId=... address=0xNEW...`; disable the old key. No on-chain
  operation required.

Decide before cutover which case applies to your deployment and
document it alongside the master-signer rotation playbook.

---

## Deployer key (K6 — CI/CD only)

The **deployer private key** is the EOA that runs
`forge script Deploy.s.sol` to deploy every Smart Agent contract
(`AgentAccount`, `AgentAccountFactory`, `DelegationManager`, every
enforcer, `AgentNameRegistry`, `ClassAssertion`, `ToolExecutor*`, ...).
It is the on-chain root-of-trust for contract ownership and the
"deployer-as-initial-owner" of every AgentAccount minted via the
factory's `serverSigner` mode.

After K6 the deployer key is **CI/CD-only**: it is NEVER present in
the runtime environment of any production service (web, a2a-agent,
person-mcp, org-mcp, etc.). The only authorised callers are:

| Caller | Where | When |
|---|---|---|
| `forge script Deploy.s.sol` | `packages/contracts/script/` | Contract deploy ceremony |
| `scripts/deploy-local.sh` | repo root | Local dev fresh-start |
| `scripts/seed-*.sh` / `scripts/seed-*.ts` | repo root | Demo data seeding |
| `apps/web/src/lib/demo-seed/**` | invoked by `boot-seed.ts` | First-run demo community provisioning |
| `apps/web/src/lib/boot-seed.ts` | dev-only `/api/boot-seed` route | Same |

All of these run from a script context or are gated behind `requireDev()`
— none execute on production request traffic.

### Local dev

`scripts/deploy-local.sh` runs `forge script Deploy.s.sol` using
**anvil account #0** (a well-known test key
`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`,
address `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`). The deploy
script then writes `DEPLOYER_PRIVATE_KEY` AND `DEPLOYER_ADDRESS` into
`apps/web/.env` so the local dev relayer paths (bootstrap-auth, demo
seed) continue to work without operator intervention. **The key in
`.env` is for dev convenience only.** Local dev does not have a KMS
substrate or a CI/CD pipeline; the dev fallback IS the design.

### Production deploy ceremony — recommended pattern

GitHub Actions OIDC → AWS STS → AWS Secrets Manager. Same OIDC trust
pattern as K2's runtime envelope key + K4's master signer, but
**conditioned on the deploy workflow's `sub` claim** so a runtime
breach cannot also reach the deployer key.

#### Setup (one-time, by an IAM admin)

1. Provision an AWS Secrets Manager secret holding the deployer key
   as a JSON blob:

   ```json
   { "privateKey": "0x..." }
   ```

   Recommended Secret name:
   `smart-agent/prod/deployer-private-key`. Encryption: a dedicated
   KMS CMK (not the K2 envelope key, not the K4 signer key).

2. Provision a SECOND IAM role, distinct from the runtime role used
   by K2/K4/K5. Recommended name: `SmartAgentDeploy`.

3. The role's **trust policy** binds the `sub` claim to the deploy
   workflow's GitHub ref/path so a runtime token can never assume
   this role:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "GitHubActionsDeployOidc",
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
             "token.actions.githubusercontent.com:sub": "repo:<org>/<repo>:environment:deploy-prod"
           }
         }
       }
     ]
   }
   ```

   The `sub` binding pins the role to a specific GitHub Environment
   (`deploy-prod`) that the deploy workflow gates on; manual approval
   for that environment is the human-in-the-loop step.

4. The role's **identity policy** grants `secretsmanager:GetSecretValue`
   on the deployer-key secret ARN ONLY, plus `kms:Decrypt` on the
   secret's encryption key:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "ReadDeployerKey",
         "Effect": "Allow",
         "Action": ["secretsmanager:GetSecretValue"],
         "Resource": "arn:aws:secretsmanager:us-east-1:111122223333:secret:smart-agent/prod/deployer-private-key-*"
       },
       {
         "Sid": "DecryptSecretKms",
         "Effect": "Allow",
         "Action": ["kms:Decrypt"],
         "Resource": "arn:aws:kms:us-east-1:111122223333:key/<DEPLOYER_SECRET_KMS_UUID>"
       }
     ]
   }
   ```

5. Set `MaxSessionDuration: 900` (15 min) on the role. The deploy
   ceremony completes in under 5 minutes; a 15-minute cap minimises
   credential lifetime if anything goes sideways.

#### Sample workflow

Add `.github/workflows/deploy-contracts.yml`:

```yaml
name: Deploy contracts
on:
  workflow_dispatch:
    inputs:
      chain:
        description: "Target chain (sepolia | mainnet)"
        required: true
        default: sepolia

permissions:
  id-token: write   # required for OIDC
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: deploy-prod   # gates on manual approval
    steps:
      - uses: actions/checkout@v4
      - uses: foundry-rs/foundry-toolchain@v1

      - name: Configure AWS credentials (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::111122223333:role/SmartAgentDeploy
          role-session-name: github-deploy-${{ github.run_id }}
          aws-region: us-east-1

      - name: Fetch deployer key
        id: fetch-key
        run: |
          KEY=$(aws secretsmanager get-secret-value \
            --secret-id smart-agent/prod/deployer-private-key \
            --query 'SecretString' --output text \
            | jq -r .privateKey)
          # Mask the value so it never appears in logs.
          echo "::add-mask::$KEY"
          echo "DEPLOYER_PRIVATE_KEY=$KEY" >> "$GITHUB_OUTPUT"

      - name: Deploy contracts
        env:
          DEPLOYER_PRIVATE_KEY: ${{ steps.fetch-key.outputs.DEPLOYER_PRIVATE_KEY }}
          RPC_URL: ${{ vars.RPC_URL }}
        run: |
          cd packages/contracts
          forge script script/Deploy.s.sol \
            --rpc-url "$RPC_URL" \
            --broadcast \
            --slow

      - name: Record deployed addresses
        run: |
          # Publish broadcast/<chain>/<run>/run-latest.json as an artifact
          # so the runtime config update PR can pick up the new addresses.
          ...
```

Critical properties:

- The key is loaded into the runner's process env via `add-mask`, then
  is implicitly scrubbed from logs by GitHub Actions.
- The runner is ephemeral; credentials disappear with the job.
- The `environment: deploy-prod` gate means a human must explicitly
  approve every contract deploy.
- The runtime IAM role (`SmartAgentA2A`) has **no permission** on the
  deployer-key Secret — only `SmartAgentDeploy` does. A runtime
  compromise cannot pivot to a deploy.

#### Alternative: hardware wallet ceremony

For teams that prefer human-mediated deploys (no CI/CD secret
exfiltration risk surface): use a Ledger / Trezor / similar via
Foundry's `--ledger` / `--trezor` flags. The deploy operator triggers
the broadcast from their workstation; the key never leaves the
hardware wallet. This is the highest-assurance option but requires a
present operator.

```bash
cd packages/contracts
forge script script/Deploy.s.sol \
  --rpc-url "$RPC_URL" \
  --ledger \
  --hd-paths "m/44'/60'/0'/0/0" \
  --broadcast \
  --slow
```

### What this rules out (intentionally)

- **Long-lived AWS access key in CI** — credentials disappear after
  the 15-min IAM session window; no static AWS_ACCESS_KEY_ID needed.
- **Deployer key in Vercel env** — the runtime env (web + a2a-agent)
  has NO `DEPLOYER_PRIVATE_KEY`. The K6 startup warning in both apps
  logs loudly if it does, and `scripts/check-no-bypass.sh` fails CI
  if a new code path tries to read it.
- **Cross-role pivot** — `SmartAgentA2A` (runtime) and
  `SmartAgentDeploy` (CI/CD) are distinct roles with distinct trust
  policies pinned to distinct `sub` claims. Compromising either does
  not let the attacker assume the other.

### Audit trail

- **CloudTrail** records every `secretsmanager:GetSecretValue` call on
  the deployer-key secret with timestamp, IAM principal (the assumed
  `SmartAgentDeploy` role session ARN, including the GitHub run id in
  the session name), and the secret ARN.
- **GitHub Actions audit log** records every `workflow_dispatch`
  trigger including the human approver of the `deploy-prod`
  environment.
- Cross-reference both by timestamp + session name to reconstruct the
  full chain of custody for any contract deployment.

### Open questions for the operator

1. **Who holds approval on the `deploy-prod` GitHub Environment?**
   Recommend at least two reviewers, one of whom is the on-call
   security officer.
2. **Rotation cadence.** Recommend rotating the deployer key annually
   even absent a known compromise. Rotation is straightforward: deploy
   future contracts from the new key, leave existing deployments owned
   by the old key (if the old key is also a contract-owner of any
   deployed Smart Agent contract, run the K4-style on-chain
   owner-migration to the new key on those specific contracts).
3. **Per-chain keys.** Some teams want separate deployer keys per
   chain (one for sepolia, one for mainnet, ...). The Secrets Manager
   secret + IAM role pattern scales trivially — duplicate per chain
   with distinct names and `Environment` bindings.

### Migration debt (audit references)

K6 documents but does not fully eliminate the runtime deployer-key
usage. The current K6 PR adds:

- Startup warning in `apps/web` (via `instrumentation.ts`) and
  `apps/a2a-agent` (via `src/index.ts`) when
  `NODE_ENV=production` AND `DEPLOYER_PRIVATE_KEY` is present.
- CI invariant in `scripts/check-no-bypass.sh` that fails on any new
  `DEPLOYER_PRIVATE_KEY` reference under `apps/web/src/app/api/**` or
  `apps/a2a-agent/src/routes/**`, with an explicit allowlist for
  known-debt sites.
- Migration of `/api/auth/check-agent-name` from private-key to
  `DEPLOYER_ADDRESS` (Category C-trivial — read-only counterfactual
  preview).

K6-D1 RESOLVED in Sprint 1 item S1.5 — the three bootstrap-auth route
handlers (`/api/auth/siwe-verify`, `/api/auth/passkey-signup`,
`/api/auth/google-callback`) now sign via the dedicated `auth-bootstrap`
tool-executor signer (Category D); the deployer key is no longer
referenced in any of them. They have been removed from
`K6_ROUTE_HANDLER_ALLOWLIST` in `scripts/check-no-bypass.sh` so any
future regression is caught at CI.

Remaining route-handler debt (allowlisted in the bypass script):

| Site | Category | Migration target |
|---|---|---|
| `apps/web/src/app/api/auth/check-agent-name/route.ts` | C | Read-only counterfactual preview; migrate to `DEPLOYER_ADDRESS` env var only (no key needed). |

Remaining action-layer / library debt (NOT allowlisted because they
are not under `apps/*/src/{app/api,routes}/**`, but documented here
for completeness — they read `DEPLOYER_PRIVATE_KEY` transitively via
`getWalletClient()` in `apps/web/src/lib/contracts.ts`):

| Site | Category | Notes |
|---|---|---|
| `apps/web/src/lib/contracts.ts` `getWalletClient()` | C | Cross-cutting; entire action layer uses this as the chain relayer. Migrate to per-action user-session signing as part of A2A+MCP Phase 6 consolidation. |
| `apps/web/src/lib/actions/{passkey,onboarding,recovery,a2a-session,...}/*.action.ts` | C/D | Deployer-as-relayer for bootstrap and demo-fallback flows. Sessionless passkey + SIWE design (memory `project_sessionless_passkey_siwe`) currently requires this. |
| `apps/web/src/lib/onchain/{matchInitiation,poolPledge,disbursement,poolPledgedTotal}Assertion.ts` | C | Public-tier `sa:*Assertion` mint via `emitClassAssertion`. v1 relayer model documented in `packages/sdk/src/class-assertion-emit.ts`; migrate to per-user session signing when WalletAction dispatch lands the redeem signature side. |
| `apps/web/src/lib/ssi/signer.ts` | C | Stateless passkey/SIWE signing fallback. Same architectural blocker as the bootstrap auth routes. |
| `apps/web/src/lib/actions/update-group.action.ts` | C | Direct on-chain write via getWallet(); should route through org-mcp `agent_resolver:*` tools per the same pattern as `agent-metadata.action.ts`. |
| `apps/person-mcp/src/tools/intents.ts` | C | Intent assertion emit. Same relayer model rationale; v2 should use the person's own session signer via WalletAction. |
| `apps/org-mcp/src/tools/intents.ts` | C | Mirror of person-mcp/intents — org-tenanted. |

Treat these as Phase 1B/1C follow-up work; each individual migration
is in scope but the cross-cutting `getWalletClient()` refactor is the
long pole and should land alongside the A2A+MCP consolidation Phase 6
work (memory `project_a2a_mcp_consolidation_phase7`).

---

## Web session-grant signer key (S1.1)

The **web app** (`apps/web`) mints a session-EOA on every passkey/SIWE
login. The EOA is the delegate inside the `SessionGrantV1` (design doc
§3.4) and signs every subsequent `WalletAction` payload routed through
`/api/wallet-action/*`. Prior to Sprint S1.1 the dev path
(`SESSION_SIGNER_BACKEND=dev-pepper`) was the only working backend —
session keys were derived from `SERVER_PEPPER` via HKDF and signed in
process. S1.1 replaces that with an AWS KMS asymmetric key for
production.

### Architectural model — one KMS key, all sessions

KMS asymmetric keys are immutable; the address is fixed per CMK. The
web app uses **one shared KMS asymmetric key** as the session signer
for every browser session. Per-session uniqueness is enforced by the
protocol — not by the key:

- `sessionId` (random UUID) salts the passkey assertion + SessionGrant
  hash chain.
- `SessionGrantV1` carries its own nonce + issued-at + expires-at so
  two sessions with the same delegate are still distinct grants.
- `WalletAction` payloads carry their own binding tuple (account,
  chainId, sessionId, actionId) so replay across sessions is rejected.

This matches the pattern used by the a2a-agent's master EOA (one KMS
key, many sub-delegations / sessions; see Step 1 of this runbook).

### Same KMS spec as the master signer

The web session-grant key is provisioned with the SAME shape as the
a2a-agent master signer (Step 1 of this runbook):

```bash
aws kms create-key \
  --key-spec ECC_SECG_P256K1 \
  --key-usage SIGN_VERIFY \
  --description "Smart Agent web session-grant signer"
```

It is a **SEPARATE CMK** from `AWS_KMS_SIGNER_KEY_ID` (the a2a-agent's
master EOA signer). The two keys MUST be distinct so:

- Each runtime (web vs a2a-agent) has its own IAM scope and can be
  audited independently in CloudTrail.
- The web key and a2a master key rotate on independent cadences.
- A compromise of one runtime cannot move funds owned by the other
  runtime's signer.

Record the new CMK's ARN; we'll need it for Step 2 below.

### IAM additions

Extend the existing `SmartAgentA2A` runtime role's permission policy
(Step 3 of this runbook) with a third statement scoped to the web
session-grant key. The web app uses the SAME role — the runtime IAM
boundary already pins `sub` to the production Vercel deployment.

Append to the permission policy:

```json
{
  "Sid": "WebSessionSignerKey",
  "Effect": "Allow",
  "Action": [
    "kms:Sign",
    "kms:GetPublicKey",
    "kms:DescribeKey"
  ],
  "Resource": "arn:aws:kms:us-east-1:111122223333:key/<WEB_SESSION_SIGNER_KEY_UUID>",
  "Condition": {
    "StringEquals": {
      "kms:SigningAlgorithm": "ECDSA_SHA_256",
      "kms:MessageType": "DIGEST"
    }
  }
}
```

The existing `DenyKeyMaterialExfiltration` statement (Step 3) is
already `Resource: "*"` and therefore covers this new key too — the
runtime role cannot disable / delete / re-policy it.

If you prefer to scope the web app to its OWN IAM role (recommended
for stricter blast-radius bounds at the cost of an extra trust policy
to maintain), provision a `SmartAgentWeb` role with the trust policy
from Step 3 (substituting the web project's Vercel `sub` claim) and
attach ONLY the `WebSessionSignerKey` statement above. The web app
does NOT need K2 envelope-key access (only the a2a-agent encrypts
session packages).

### Env vars

In the **web** Vercel project: **Settings → Environment Variables**.
Set for Production (and Preview if you want preview deployments to
exercise the prod path):

| Variable | Value |
|---|---|
| `SESSION_SIGNER_BACKEND` | `aws-kms` |
| `AWS_REGION` | `us-east-1` (or wherever the web session signer key lives) |
| `AWS_ROLE_ARN` | `arn:aws:iam::111122223333:role/SmartAgentA2A` (or `SmartAgentWeb` if you provisioned a dedicated role) |
| `AWS_WEB_SESSION_SIGNER_KEY_ID` | `arn:aws:kms:us-east-1:111122223333:key/<WEB_SESSION_SIGNER_KEY_UUID>` |

**Do NOT set these in the web Vercel project:**

- `SERVER_PEPPER` (S2.6 removed the OAuth-salt consumer; the only
  remaining reader is the dev-only `dev-pepper` session-signer custody
  backend, which the S1.4 production guard refuses to boot in
  production anyway).
- `AWS_KMS_SIGNER_KEY_ID` (that's the a2a-agent's master signer,
  unrelated to web session-grant signing).

### S1.4 production guard

`apps/web/src/lib/key-custody/index.ts` enforces a hard fail when
`NODE_ENV=production` AND the selected backend is `dev-pepper`. The
factory throws at first use rather than at module load so the error
surface lives at the request boundary where Next.js will log it to
Vercel runtime logs. The error message includes the URL of this
runbook section so an on-call engineer can land here directly.

### Rotation

KMS asymmetric keys are immutable, so rotation is an **on-chain**
operation — same shape as the master EOA rotation (Step "Rotation
procedure" earlier in this runbook):

1. Create a NEW asymmetric KMS key with the same spec.
2. Pre-fund the new derived address if the web session signer is set
   as an owner on any contract (it is NOT today; the session EOA is a
   delegate, not an owner, on user smart accounts). If you've added
   it as an owner anywhere in the future, the rotation needs the
   `addOwner(newAddress)` → grace → `removeOwner(oldAddress)`
   ceremony from Step 4–8 above.
3. Update `AWS_WEB_SESSION_SIGNER_KEY_ID` in the web Vercel project.
   Trigger redeploy.
4. Observe ≥ 24h of clean operation; for emergency rotation, collapse
   the soak to "as soon as new key works".
5. `aws kms disable-key --key-id <OLD_ARN>`. Hold ≥ 30 days for audit
   trail, then schedule deletion if desired.

The web session signer is a **session delegate**, not a smart-account
owner. The user's actual on-chain ownership comes from their passkey
(verified by `AgentAccount.isValidSignature` against the WebAuthn
credential). Rotating the web session signer therefore does NOT
require any user-visible step — existing sessions remain valid until
they hit their `expiresAt` and the browser re-runs the passkey + grant
ceremony.

### Local dev

`scripts/deploy-local.sh` writes `SESSION_SIGNER_BACKEND=dev-pepper`
into `apps/web/.env` so every fresh-start runs against the in-process
HKDF path. No AWS credentials are needed locally.

---

## Session JWT signing key (Sprint 2 S2.4)

The `smart-agent-session` cookie is an HS256 JWT signed with a
symmetric secret. Before S2.4, that secret was a single
`SESSION_JWT_SECRET` env var with no key-id and no rotation hook: if
the secret leaked, every issued token was forgeable for the full TTL
window (which was 30 days, also reduced as part of this work).

S2.4 introduces **multi-key signing** at the env-var layer — same
shape as the K3-ext KMS rotation pattern, but for HS256 secrets the
runtime owns directly. One key is active for signing; multiple are
valid for verification; rotation is a re-deploy with a new env value.

### Env-var format

```
SESSION_JWT_SECRETS=<kid_1>:<secret_hex_1>,<kid_2>:<secret_hex_2>,...
```

- Comma-separated `kid:secret_hex` pairs.
- `kid` is an arbitrary opaque label; a date-stamped scheme like
  `2026-05-v1` works well so on-call engineers can read the rotation
  history off the env var.
- `secret_hex` is a 32-byte (64-char) hex string. Generate with
  `openssl rand -hex 32`.
- The **first entry is the ACTIVE signing key**. `signJwt()` uses it
  exclusively. All entries — first and beyond — are valid for
  verification.
- Whitespace around entries is tolerated. Duplicate kids are rejected
  at parse time (operator error that would silently lose a key).

The verifier reads the `kid` header off the incoming token and looks
up the matching secret. A token whose `kid` is **not** in the list is
rejected — that's how a rotated-out key becomes immediately useless
even before its TTL would have elapsed.

### Rotation procedure

1. **Generate** a new 32-byte secret and a new kid label:
   ```
   NEW_SECRET=$(openssl rand -hex 32)
   NEW_KID=2026-05-v2
   ```
2. **Prepend** to `SESSION_JWT_SECRETS` in the Vercel project env
   (Production + Preview):
   ```
   SESSION_JWT_SECRETS=2026-05-v2:<new_secret>,2026-05-v1:<old_secret>
   ```
   Save → redeploy. As soon as the new build is live, every new
   session JWT is signed with `2026-05-v2`. In-flight cookies signed
   with `2026-05-v1` continue to verify because that kid is still in
   the list.
3. **Wait** at least the cookie TTL (currently 24h, see
   `SESSION_TTL_SECONDS` in
   `apps/web/src/lib/auth/native-session.ts`). Past that point, no
   live token can still carry the old kid.
4. **Drop** the old entry from `SESSION_JWT_SECRETS`:
   ```
   SESSION_JWT_SECRETS=2026-05-v2:<new_secret>
   ```
   Save → redeploy. Any leaked copy of `<old_secret>` is now inert —
   tokens forged under it will fail verification (their kid is no
   longer in the registry).

Emergency rotation (suspected leak): skip the 24h wait. Drop the old
kid immediately; every legitimate live session is invalidated, every
forged token is also invalidated, users re-authenticate. This is the
"break glass" path and is the reason we cut the TTL from 30 days to
24h — a 30-day forced re-auth event would be operationally painful;
24h is acceptable.

### Production guards

`apps/web/src/lib/auth/jwt.ts → loadJwtKeys()` throws at first use
when:

- `NODE_ENV=production` AND **no** `SESSION_JWT_SECRETS` (or legacy
  `SESSION_JWT_SECRET`) is configured. The error message points back
  to this section.
- `NODE_ENV=production` AND the active (first) kid is the well-known
  dev fallback label `dev-fallback`. Catches the failure mode where
  an operator copies the dev `.env` shape into production unchanged.

Both fire at the request boundary (where Next.js surfaces them as
Vercel runtime errors), not at module-load time — by design, so the
error surface lives where on-call engineers will see it in logs.

### Backward compat: legacy `SESSION_JWT_SECRET`

If `SESSION_JWT_SECRETS` is **unset** and the legacy singular
`SESSION_JWT_SECRET` IS set, the verifier accepts header-less (no
`kid`) tokens signed under the pre-S2.4 scheme. **Signing under this
mode is refused** — `signJwt()` throws, forcing operators to opt into
multi-key by switching to the plural env var.

This compat path exists so a deploy that introduces S2.4 doesn't
immediately invalidate every in-flight cookie on the system. Plan to
remove the singular env from the deployment within one cookie-TTL
window after switching to `SESSION_JWT_SECRETS`; the codebase will
keep honoring it on read until the next sweep removes the fallback
branch from `loadJwtKeys()`.

### Cookie TTL reduction (S2.4)

The session cookie TTL was reduced from **30 days → 24 hours**
(`SESSION_TTL_SECONDS` in `apps/web/src/lib/auth/native-session.ts`).
The previous 30-day TTL was a blast-radius amplifier: a leaked secret
could forge tokens for a month before the rotation forced
re-authentication.

**Open follow-up** (Sprint 3 territory): build a session-refresh
endpoint so a 24h TTL doesn't translate to "user re-runs the passkey
+ grant ceremony every day". The shape is straightforward — a token
whose `iat` is within some sliding-window threshold can be exchanged
for a fresh token without a full ceremony — but it's out of scope for
S2.4 since the security gain (bounded blast radius) lands without it.
Track as a TODO in the issue/Linear board, linked from
`apps/web/src/lib/auth/native-session.ts`.

### Local dev

`scripts/deploy-local.sh` writes a single freshly-generated
`SESSION_JWT_SECRETS=2026-05-v1:<random-hex>` into `apps/web/.env` on
every fresh-start. No rotation is exercised in local dev; rotation is
purely an operator concern in prod.

### Future work — KMS-backed JWT signing (Sprint 3 territory)

Today S2.4 keeps the HMAC secret as a runtime env var. The natural
next step is to move it behind AWS KMS HMAC keys (`kms:GenerateMac`
/ `kms:VerifyMac` with `MacAlgorithm=HMAC_SHA_256`), same posture as
the K3-ext family. That eliminates the "secret is in process memory"
risk class entirely — a compromised Vercel runtime would only get
`kms:VerifyMac` access for the duration of the IAM session, not the
key material. Tracking ideas:

- One KMS HMAC key per kid; rotation is provisioning a new key and
  prepending to a `SESSION_JWT_KMS_KEY_IDS` env (same multi-key
  pattern, KMS arn-valued instead of hex-valued).
- `signJwt` calls `kms:GenerateMac`; `verifyJwt` calls `kms:VerifyMac`
  against the kid-matched key.
- IAM policy pins `MacAlgorithm=HMAC_SHA_256` and denies
  `kms:Encrypt` / `kms:Decrypt` on the MAC keys (defense-in-depth
  mirror of the K4 signer policy).

Defer until S2.4 has bake-in time and we've decided whether server-
side opaque session ids (with a DB lookup) are a better long-term
direction than stateless JWTs altogether.

## Audit checkpoint sink (S3.1 + Sprint 4 A.3)

Sprint 3 introduces an **external anchor** for the a2a-agent's `execution_audit` hash chain (`docs/architecture/01-web-a2a-mcp-flows.md` § "Audit completeness + external anchor"). Sprint 4 A.3 extends the same pattern to **person-mcp**'s `audit_log` hash chain. Both services run the same cadence (15 min prod / 1 min dev), sign payloads with the **same master signer** (a2a-agent's KMS key; person-mcp posts its digest to a2a-agent's `POST /auth/sign-checkpoint`), write to their own local `audit_checkpoint` table, and (when `AUDIT_CHECKPOINT_SINK_URL` is set) POST to the configured sink.

The payload shape is `{ latestEntryId, latestEntryHash, timestamp, chainId, signature, signerAddress }`. The person-mcp variant adds a `service: 'person-mcp'` field; a2a-agent emits no `service` field (rows in its local table imply `service: 'a2a-agent'` by table-owner). Operators who consume both streams via a single sink URL can join the streams by timestamp and identify the producer either from the body's `service` field or from the `x-sa-checkpoint-service` HTTP header person-mcp adds to every sink POST.

| Service     | Local table                    | Source module                                  |
|-------------|--------------------------------|------------------------------------------------|
| a2a-agent   | `apps/a2a-agent/local.db`      | `apps/a2a-agent/src/lib/audit-checkpoint.ts`   |
| person-mcp  | `apps/person-mcp/person-mcp.db`| `apps/person-mcp/src/lib/audit-checkpoint.ts`  |

Always: each service writes its checkpoint to its own local `audit_checkpoint` SQLite table (last 30 days, daily GC). The sink POST is best-effort with 3 attempts + exponential backoff; sink failures never roll back the local write. An attacker who mutates either local DB cannot also rewrite the sink's history — the next operator-run `scripts/verify-audit-chain.ts` walks the local chain, recomputes every hash, and compares to the last sink-anchored checkpoint. Any divergence is forensic evidence of tampering.

**Operator key inventory**: only ONE signing key (a2a-agent's master KMS key) — person-mcp does NOT hold a separate signing key. Person-mcp builds its own checkpoint digest, then makes an authenticated inter-service call to `a2a-agent POST /auth/sign-checkpoint` (allow-list of one service: `person-mcp`; reuses the existing `a2a-to-person` HMAC MAC key already provisioned for inter-service auth) to obtain the signature.

### Env vars

| Variable                       | Required | Default | Purpose                                                                 |
|--------------------------------|----------|---------|-------------------------------------------------------------------------|
| `AUDIT_CHECKPOINT_SINK_URL`    | optional | unset   | HTTP(S) URL the agent POSTs each checkpoint JSON to. **Same value on a2a-agent AND person-mcp** so a single sink receives both streams. |
| `AUDIT_CHECKPOINT_SINK_AUTH`   | optional | unset   | Value attached as the `Authorization` header on every sink POST. Empty → no auth header. Same value on both services. |

If `AUDIT_CHECKPOINT_SINK_URL` is unset on a service, that service only writes to its own local SQLite archive — there is NO external witness for that chain and integrity is only as strong as the local DB. Dev / smoke-test environments may leave it unset; **production deployments MUST configure a sink on both services**.

The sink receives interleaved POSTs from both services; each body carries everything needed to demultiplex:
- person-mcp bodies have a `"service": "person-mcp"` field.
- a2a-agent bodies have no `service` field (legacy shape; rows in a2a-agent's local table imply `service: 'a2a-agent'`).
- person-mcp POSTs also include the header `x-sa-checkpoint-service: person-mcp` for sink layers that do not parse the body before routing.

### Recipe — Azure Monitor Log Analytics (Data Collection Rule)

1. Create a Log Analytics workspace + a custom table (one column per checkpoint field, plus the standard `TimeGenerated`).
2. Create a Data Collection Rule (DCR) pointing at the workspace. The DCR provisions a Data Collection Endpoint (DCE) URL.
3. The DCE URL has the shape `https://<dce-name>.<region>.ingest.monitor.azure.com/dataCollectionRules/dcr-<id>/streams/Custom-<table-name>?api-version=2023-01-01`.
4. Set `AUDIT_CHECKPOINT_SINK_URL` to that URL.
5. Set `AUDIT_CHECKPOINT_SINK_AUTH=Bearer <oauth2-token>`. The token comes from an Entra ID app registration with `Monitoring Metrics Publisher` role on the DCR; refresh-token rotation is operator-owned (the agent does not refresh tokens).

### Recipe — S3 immutable blob (Object Lock)

1. Create an S3 bucket with **Object Lock** enabled in compliance mode, retention period ≥ your audit retention (e.g. 7 years).
2. Set the bucket policy to deny `s3:DeleteObject` + `s3:PutObjectRetention` from anyone but a designated audit role.
3. Use a small relay (Lambda + API Gateway, or operator-run container) that:
   - Accepts `POST /checkpoints` with a Bearer-token header.
   - Writes the body to `s3://<bucket>/<YYYY>/<MM>/<DD>/<timestamp>-<sha256(body)>.json` with `ObjectLockMode=COMPLIANCE` + `ObjectLockRetainUntilDate=<retention end>`.
4. Set `AUDIT_CHECKPOINT_SINK_URL=https://<api-gateway-url>/checkpoints` + `AUDIT_CHECKPOINT_SINK_AUTH=Bearer <relay-token>`.

### Recipe — generic JSON webhook (SIEM)

Any service that accepts `POST <url>` with `Content-Type: application/json` + an optional `Authorization` header works. Splunk HEC, Datadog, PagerDuty, Sentry, custom SIEM — same shape. The body is the checkpoint JSON exactly; no Smart-Agent-specific framing.

### Retry + failure handling

- Per attempt: 5 s timeout (HTTP + connect).
- Per checkpoint: 3 attempts, exponential backoff (500ms, 1.5s, 3.5s).
- After 3 failures: the local row's `sink_status` column reads `failed:<reason>`, the agent logs `[audit-checkpoint] sink POST failed after 3 attempts: <reason>`, and the NEXT checkpoint still attempts to POST (no permanent backoff or circuit breaker — checkpoints are independent units of work).
- The local INSERT always succeeds (or surfaces the SQLite error directly to the agent log). A failing sink does NOT roll back the local write.

### Verification

Run the verifier nightly against each service's DB and check the exit code. A `0` means the chain is intact AND every checkpoint signature verifies. A `1` is a hard alert — escalate to the on-call.

```bash
pnpm exec tsx scripts/verify-audit-chain.ts                              # default: --service a2a-agent
pnpm exec tsx scripts/verify-audit-chain.ts --service person-mcp         # person-mcp's audit_log + checkpoints
pnpm exec tsx scripts/verify-audit-chain.ts --service a2a-agent --signer 0xMASTER_SIGNER_ADDRESS
```

The CLI accepts:
- `--service a2a-agent|person-mcp` — which service's chain to verify (default `a2a-agent`).
- `--db <path>` — override the default DB path (defaults: `apps/a2a-agent/local.db` and `apps/person-mcp/person-mcp.db`).
- `--signer 0x...` — pin the expected signer address. Both services use the same master signer, so the same `--signer` value applies to both runs. Rotating the master signer (K4 rotation runbook above) requires updating the operator-pinned address on the next run.

For a nightly cron a two-line invocation gives full coverage:

```bash
pnpm exec tsx scripts/verify-audit-chain.ts --service a2a-agent  --signer "$EXPECTED_SIGNER" || alert
pnpm exec tsx scripts/verify-audit-chain.ts --service person-mcp --signer "$EXPECTED_SIGNER" || alert
```
