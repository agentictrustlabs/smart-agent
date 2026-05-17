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

The OIDC + IAM trust handles credentials (the `@vercel/oidc-aws-credentials-provider`
exchanges the per-invocation Vercel OIDC token for short-lived AWS STS creds).
The KMS handles keys. Any long-lived AWS access key or in-env private key in
the production environment is a regression — the CI guard
(`scripts/check-no-bypass.sh`, extended in K4 PR-5) refuses to land a deploy
with either present.

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

Remaining route-handler debt (allowlisted in the bypass script):

| Site | Category | Migration target |
|---|---|---|
| `apps/web/src/app/api/auth/siwe-verify/route.ts` | D | `auth-bootstrap` tool-executor signer |
| `apps/web/src/app/api/auth/passkey-signup/route.ts` | D | `auth-bootstrap` tool-executor signer |
| `apps/web/src/app/api/auth/google-callback/route.ts` | D | `auth-bootstrap` tool-executor signer |

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
