# K1 — Rotation Procedure

> **Status**: DRAFT. Procedure validated on LocalStack; AWS / GCP paths
> documented but not yet executed against a real prod account. See K2 for
> the dry-run evidence requirement before first prod use.
> **Companion**: this doc layers ROTATION on top of the PROVISIONING
> runbooks (`docs/operations/kms-signer-setup.md`,
> `docs/operator/gcp-kms-provisioning.md`). Read those first if the keys
> have not been provisioned yet.

## Scope

This runbook covers planned and unplanned rotation of the three
Phase-A-introduced KMS keys:

1. **master** — inter-service MAC + envelope encryption + bundler-relay
   tx signing. Effectively a service-identity key.
2. **bundlerSigner** — submits ERC-4337 userOps via
   `AgentAccount.executeFromBundler`.
3. **sessionIssuer** — co-signs Variant B `SessionAuthorization`
   envelopes.

All three are **secp256k1** (`ECC_SECG_P256K1` on AWS,
`EC_SIGN_SECP256K1_SHA256` on GCP). The master key has an additional
fan-out of HMAC sub-keys (per-edge MAC keys + session envelope KEK +
tool-executor signers); those have their own rotation cadence
(`HMAC_SHA_256` on AWS, `HMAC_SHA256` on GCP). They are part of the
"master domain" for accounting and IAM purposes but they rotate
independently — see § 4 below.

---

## 1. Rotation cadence

| Key | Recommended cadence | Rationale |
|---|---|---|
| **master** (signing) | **Annual** (calendar); **immediate** on suspected compromise, staff turnover (where the rotated-out staffer had admin access), or vendor advisory. | Master signs bundler-relay envelopes and inter-service MAC. Signature volume is high (every inbound MAC verification, every relay tx), so signature-class cryptanalysis exposure scales with calendar time. But because master is NOT an authority-bearing key post-Phase-A, the blast radius of compromise is limited to (a) MAC forgery (mitigated by inbound verification), (b) ability to submit relay tx without user inner sig (mitigated by `executeFromBundler` requiring inner owner sig). Annual is conservative-enough; quarterly would be operational toil with no measurable risk reduction. |
| **bundlerSigner** | **Quarterly** (calendar); **immediate** on suspected compromise. | Bundler key gets hit on every userOp. Higher volume than master. A compromised bundler can MEMPOOL-STUFF (DoS the bundler queue) and can submit relay envelopes for userOps it has the inner signature for — but cannot author user authority (inner sig must recover to an account owner). Blast radius: temporary DoS + ability to censor specific userOps. Quarterly aligns with infra-refresh cadence. |
| **sessionIssuer** | **Annual** (calendar); **immediate** on suspected compromise. | Session-issuer signs Variant B `SessionAuthorization` envelopes — but only ALONGSIDE a user owner sig (defense in depth). A compromised session-issuer alone CANNOT mint a session against any account (user authorization is independently required). Blast radius is therefore low even on compromise. Annual is appropriate. |
| **MAC sub-keys** (`web-to-a2a`, `a2a-to-*`, `oauth-salt`) | **Annual** per key; **staggered** so not all rotate the same week. | One per inter-service edge. Compromise of any one MAC key allows an attacker to forge that one edge's inbound MAC. Defense in depth: every MAC verification is paired with the receiver's principal check + the destination's tenant isolation, so a forged MAC alone is not sufficient for cross-tenant data access (Phase G property tests assert this). Stagger to avoid a global rotation event. |
| **Session envelope KEK** | **Every 90 days** (AWS-default automatic rotation enabled OR equivalent gcloud rotation-period setting). | Symmetric KEK that wraps per-session AES-GCM data keys. AWS KMS does automatic key rotation on symmetric keys; we enable it. Old versions decrypt forever (KMS retains all historical versions for symmetric keys), so this is zero-downtime. |
| **Tool executor signers** (per-tool) | **Quarterly**, staggered (don't rotate all five the same week). | Per-tool family signers — disbursement / round-awards / pool-lifecycle / grant-awards / auth-bootstrap. Compromise of one family's key compromises one family of tool actions. Per-tool isolation limits blast radius. |

### Trigger conditions (any of the below → rotate immediately)

- **Calendar trigger** (cadence above expired).
- **Suspected compromise**: anomaly detection from K6, unexplained
  signature volume spike, signing from an unexpected IAM principal, IAM
  policy change you did not authorise.
- **Vendor advisory**: AWS / GCP issues a CVE on the KMS service or on
  the OIDC federation path; CSV / NVD reference is documented in the
  rotation-log entry.
- **Staff turnover**: a person with KMS admin access leaves the
  organisation. The signing-class keys (master, bundler, session-issuer)
  must rotate within 48h; the envelope and MAC keys within 7d.
- **Cryptanalytic event**: a published weakness in secp256k1 / ECDSA /
  HMAC-SHA-256. Currently none is known.
- **HNDL trigger**: when CRQC is announced or the credible estimate
  drops below 5 years, the entire signing-key inventory rotates as part
  of the hybrid PQ migration (see `docs/security/cryptographic-posture/`
  C3).
- **Drill trigger**: quarterly dry-run in LocalStack (K2). Not a real
  rotation, but the procedure is exercised end-to-end.

---

## 2. Pre-rotation checklist

Before running ANY of the per-cloud procedures in § 3:

1. **Confirm the trigger.** Annotate the rotation-log entry with the
   trigger class (calendar / compromise / advisory / turnover / cryptanalytic / HNDL).
2. **Notify on-call.** Post in `#sre-oncall` with subject `[KMS-ROT]
   <key-name> rotation starting in 30m`. Include link to this runbook
   and the planned new key version path.
3. **Snapshot the audit-chain checkpoint.** Run
   `pnpm tsx scripts/audit-chain-checkpoint.ts --out tmp/checkpoints/<date>-pre-rotation.json`
   (the script writes the current head hash of every audit table). The
   checkpoint is the rollback marker; post-rotation verification proves
   the chain continued cleanly across the rotation point.
4. **Verify rollback path.** Old key version must remain ENABLED for at
   least the longest expected redemption window (see § 6.4). DO NOT
   schedule deletion of the old version in the same change window.
5. **Quiesce in-flight signatures.** For bundlerSigner and
   sessionIssuer: pause the affected route's accept queue for ≤60s while
   the env var flip is rolled out. `curl -XPOST
   $A2A_AGENT_URL/admin/pause-relays` (pre-Phase-A this endpoint does
   not exist; add it in Phase A § acceptance criteria addendum). For
   master MAC: no quiesce needed — old and new versions are both
   acceptable for verification.
6. **Check for ongoing incidents.** If `#sre-oncall` has an open P0 / P1
   incident, postpone unless the rotation IS the incident response.
7. **Two-operator rule for prod.** Compromise-triggered rotations
   require two-operator approval (the operator running the procedure and
   a Security agent reviewer). Calendar rotations can be single-operator
   but the rotation-log entry must be reviewed within 24h.

---

## 3. Per-cloud procedure

The three signing keys share an identical shape. The example below is
for `bundlerSigner`; substitute the key alias / env var for the other
two.

### 3.1 AWS KMS (production)

Provisioning sets the key alias and ARN per
`docs/operations/kms-signer-setup.md`. Rotation creates a NEW key
version under the SAME alias (or, optionally, an entirely new key with a
new ARN and alias swap; that path is documented in § 3.1.4 for
incident-response use).

#### 3.1.1 Create the new key version (asymmetric secp256k1)

> **Important**: AWS KMS does NOT support automatic rotation for
> asymmetric keys. You must explicitly create a new key (not a new
> "version" of the existing key). Source: AWS KMS docs § Automatic key
> rotation. The alias is what gives us a stable handle across rotations.

```bash
# Set context
KEY_ALIAS=alias/smart-agent-bundler-signer
NEW_KEY_DESC="Smart Agent bundlerSigner — rotation $(date -u +%Y-%m-%d)"

# Create the new asymmetric key
NEW_KEY_ARN=$(aws kms create-key \
  --description "$NEW_KEY_DESC" \
  --key-usage SIGN_VERIFY \
  --key-spec ECC_SECG_P256K1 \
  --query 'KeyMetadata.Arn' \
  --output text)
echo "$NEW_KEY_ARN"

# Apply the canonical key policy (same template as provisioning runbook)
aws kms put-key-policy \
  --key-id "$NEW_KEY_ARN" \
  --policy-name default \
  --policy file://infra/policies/aws-kms-signer-policy.json

# Derive the EVM address for the new key
NEW_EVM_ADDR=$(pnpm exec tsx scripts/master-signer-address.ts \
  --kms-key-id "$NEW_KEY_ARN")
echo "new bundlerSigner EVM address: $NEW_EVM_ADDR"
```

Record `$NEW_KEY_ARN` and `$NEW_EVM_ADDR` in the rotation-log entry.

#### 3.1.2 Re-point the alias atomically

```bash
# Atomic alias swap — old key remains ENABLED, alias now points to new
OLD_KEY_ARN=$(aws kms describe-key --key-id "$KEY_ALIAS" \
  --query 'KeyMetadata.Arn' --output text)

aws kms update-alias \
  --alias-name "$KEY_ALIAS" \
  --target-key-id "$NEW_KEY_ARN"

echo "old key (still enabled): $OLD_KEY_ARN"
echo "alias now points to: $NEW_KEY_ARN"
```

#### 3.1.3 Propagate the env var across services

The runtime reads the ARN (NOT the alias — alias resolution at runtime
allows silent redirect, which we explicitly forbid; see provisioning
runbook). Therefore the env var update is required even though the
alias-level swap is already complete.

Apps that depend on `AWS_KMS_BUNDLER_SIGNER_KEY_ID`:

- `apps/a2a-agent/` — relay path
- `scripts/deploy-local.sh` — re-derivation on next fresh-start

Production deployments (Vercel):

```bash
# Update the Vercel env var for Production
vercel env rm AWS_KMS_BUNDLER_SIGNER_KEY_ID production --yes
echo "$NEW_KEY_ARN" | vercel env add AWS_KMS_BUNDLER_SIGNER_KEY_ID production
vercel --prod  # triggers redeploy
```

Rolling restart order:

1. a2a-agent (single instance per region; depends on the new key).
2. web (web does not sign with bundlerSigner; restart is a no-op but
   confirms env propagation).

Verify in logs:

```bash
vercel logs --since=5m | grep -i 'bundler signer derived: '
# → bundler signer derived: 0x<NEW_EVM_ADDR>
```

#### 3.1.4 Special case: full key replacement (incident response)

If the trigger is suspected compromise of the OLD key, you do NOT want
the old key to remain available for ANY signing operation:

```bash
# Disable the old key (does NOT delete it)
aws kms disable-key --key-id "$OLD_KEY_ARN"

# Verify
aws kms describe-key --key-id "$OLD_KEY_ARN" \
  --query 'KeyMetadata.{KeyState:KeyState,Enabled:Enabled}'
# → { "KeyState": "Disabled", "Enabled": false }
```

Disabling is IMMEDIATE; any in-flight signing call returns
`KMSInvalidStateException`. Therefore disable only AFTER the alias swap
AND env propagation AND a fresh signature has been observed in audit
logs (§ 5.1).

DO NOT schedule deletion at this point — keep the disabled key for at
least the retention window (see § 6.4).

#### 3.1.5 If the bundlerSigner ADDRESS changed (which it will, because asymmetric rotation = new key = new public key)

`AgentAccount` stores `_bundlerSigner` immutable per Phase A spec. The
address is set in `initialize()`. **There is no on-chain rotation path
for `_bundlerSigner` on existing accounts** without a factory upgrade.

This is THE open question flagged in K1's introduction and not yet
resolved in Phase A. Three options:

| Option | Description | Trade-off |
|---|---|---|
| **(a)** Factory upgrade governance event | Deploy a new `AgentAccountFactory` whose `bundlerSigner_` immutable points to the new address. ALL new accounts use the new bundler. Existing accounts continue with the OLD bundler. The old bundler key must remain operable until all existing accounts are migrated OR until they all naturally rotate (i.e. forever). | High operational cost; means we cannot REMOVE the old key for many months. Does not work as an emergency response. |
| **(b)** Mutable bundler registry | Refactor `AgentAccount` to read `_bundlerSigner` from a `BundlerRegistry` contract (immutable address of the registry, NOT the bundler). The registry has an `updateBundler()` function gated by owner-multisig. | Requires a contract upgrade BEFORE the first prod rotation is needed. Adds one read per `executeFromBundler` call (small gas overhead). RECOMMENDED. |
| **(c)** Account-by-account upgrade | Every account user signs an `upgradeToWithAuthorization` to a new impl whose `_bundlerSigner` is the new address. | Does not scale; UX hostile; not feasible as the default rotation path. |

**RECOMMENDATION**: implement option (b) as a follow-on to Phase A
(call it "Phase A.1 — bundler registry"). Until A.1 lands, rotation of
the bundlerSigner ADDRESS (not just the underlying key material — see
below) is a major event requiring contract redeploy. Calendar-cadence
rotations should be deferred until A.1; only emergency (compromise)
rotations are executed before A.1, and the emergency path is "redeploy
the factory + accept the address change for new accounts; old accounts
remain on the compromised bundler key until they migrate".

> **Open question logged**: "K1-Q1 — bundlerSigner registry: ship as
> Phase A.1 before any production-cadence rotation". Tracking this in
> the rotation-log header.

The same analysis applies to `_sessionIssuer`. A unified `RoleRegistry`
contract resolving both `bundlerSigner()` and `sessionIssuer()` lookups
is the recommended shape — one registry, two slots, one upgrade event
covers both.

#### 3.1.6 If only the underlying key material is being rotated (in-place re-key)

`KeyId` stays the same; `KeyMaterial` changes. This is **NOT a thing
for asymmetric KMS keys** — there is no `kms:RotateKeyMaterial` API for
asymmetric keys. Symmetric keys CAN re-key in place (AWS KMS automatic
rotation), but signing keys must be fully replaced.

The implication: every signing-key rotation produces a NEW PUBLIC KEY
(and therefore a new EVM address). Option (b) above is the only
operationally sustainable path.

### 3.2 GCP Cloud KMS (production)

GCP CryptoKeyVersion supports zero-downtime rotation: create a new
version under the same CryptoKey, pin the env var to the new
`cryptoKeyVersions/N+1` path, then disable the old version.

#### 3.2.1 Create the new key version

```bash
KEY=bundler-signer
KEYRING=smart-agent
LOCATION=us-east1

# Create the new asymmetric key version
gcloud kms keys versions create \
  --key="$KEY" \
  --keyring="$KEYRING" \
  --location="$LOCATION"

# Get the new version number
NEW_VERSION=$(gcloud kms keys versions list \
  --key="$KEY" --keyring="$KEYRING" --location="$LOCATION" \
  --filter='state=ENABLED' --sort-by='~name' \
  --limit=1 --format='value(name)')
echo "new version path: $NEW_VERSION"

# Derive the EVM address
NEW_EVM_ADDR=$(pnpm exec tsx scripts/master-signer-address.ts \
  --gcp-version "$NEW_VERSION")
echo "new bundlerSigner EVM address: $NEW_EVM_ADDR"
```

#### 3.2.2 Update env vars + redeploy

The env var pins to the SPECIFIC version, not the parent key (see
provisioning runbook § Step 12):

```bash
vercel env rm GCP_KMS_BUNDLER_SIGNER_VERSION production --yes
echo "$NEW_VERSION" | vercel env add GCP_KMS_BUNDLER_SIGNER_VERSION production
vercel --prod
```

Old version remains in `ENABLED` state, so any in-flight signature
operation against the old version completes normally. Once all traffic
is observed on the new version (verify via Cloud Audit Logs, §
K6-monitoring), disable the old:

```bash
gcloud kms keys versions disable <OLD_VERSION_PATH> \
  --key="$KEY" --keyring="$KEYRING" --location="$LOCATION"
```

DO NOT destroy. Destroy is a separate action with a 24h delay; perform
only after retention window (§ 6.4).

#### 3.2.3 Same address-change problem as AWS

GCP CryptoKeyVersion rotation also produces a new public key. The same
"Phase A.1 — bundler registry" recommendation applies. Until A.1,
sustained cadence rotation is deferred.

### 3.3 LocalStack (dev parity)

```bash
# Re-run fresh-start with KMS — this re-provisions every key from scratch
./scripts/fresh-start.sh --with-kms

# Or, to rotate ONLY the bundler signer:
KEY_ALIAS=alias/smart-agent-bundler-signer

# Create a new key
NEW_KEY_ID=$(awslocal kms create-key \
  --key-usage SIGN_VERIFY \
  --key-spec ECC_SECG_P256K1 \
  --query 'KeyMetadata.KeyId' --output text)

# Re-point the alias
awslocal kms update-alias \
  --alias-name "$KEY_ALIAS" \
  --target-key-id "$NEW_KEY_ID"

# Re-derive address + update .env files
NEW_ADDR=$(set -a; . apps/a2a-agent/.env; set +a; \
  AWS_KMS_BUNDLER_SIGNER_KEY_ID="$NEW_KEY_ID" \
  pnpm exec tsx scripts/master-signer-address.ts)

# Update .env files (note: fresh-start is the canonical way; this is
# only used for manual mid-session rotation testing)
sed -i "s|^AWS_KMS_BUNDLER_SIGNER_KEY_ID=.*|AWS_KMS_BUNDLER_SIGNER_KEY_ID=$NEW_KEY_ID|" \
  apps/a2a-agent/.env

# Restart services
./scripts/restart-services.sh
```

LocalStack has no IAM / no audit / no two-phase commit. The dev script
exists for testing the procedure in shape and timing, not for testing
the IAM scoping.

---

## 4. Special considerations per key

### 4.1 master

The master key is BOTH a signing key (bundler-relay tx, MAC origination)
and the parent of the symmetric envelope KEK + per-edge HMAC keys
provisioned alongside it. "Rotating master" therefore has two
interpretations:

| Interpretation | Procedure |
|---|---|
| **Rotate the master signing key** (the secp256k1 key used for bundler-relay tx signing). | Follow § 3.1 / § 3.2 above. SAME caveat about address change. |
| **Rotate the master domain's child keys** (envelope KEK, MAC sub-keys, tool executor signers). | Per-child rotation; each is a separate rotation event. Cadence per § 1. |

The "master domain" naming is a documentation convenience; at the AWS
KMS layer each child is its own CMK with its own ARN and IAM policy.

#### Rolling restart order for the master signing key

Master signs the inter-service MAC inbound on EVERY MCP edge. If you
flip the env var without coordination, services holding the OLD master
public key will REJECT the new master's MAC (no public-key trust list
exists today — see open question K1-Q2 below). Therefore the rolling
restart must propagate the new public key as a TRUSTED VERIFIER on every
receiver BEFORE the new master starts signing.

Procedure:

1. **Add new key to verifier trust list** (NOT the same as making it
   the signer). Every MAC receiver must accept BOTH the old AND the
   new key's public key during the rotation window.
   - Implementation: `apps/a2a-agent/src/auth/mac-verifier.ts` and
     `apps/*-mcp/src/auth/mac-verifier.ts` consult a list of acceptable
     `kid` values, not a single one.
   - **Today: this is NOT implemented.** Phase A's MAC layer assumes a
     single active key per edge. Operational consequence: master
     rotation requires a brief outage window during which the old
     signer is up + the new is being deployed; once new is verified,
     old can be retired.
2. **Update master env var for senders** (a2a-agent first).
3. **Restart senders** — new MAC signatures use the new key.
4. **Drain old-key in-flight MACs** — wait at least the longest open
   inter-service request timeout (typically 30s).
5. **Remove old key from verifiers' trust list** (when the multi-kid
   pattern lands).

> **Open question**: "K1-Q2 — multi-kid MAC verifier trust list".
> Implementing this is a prerequisite for zero-downtime master rotation.
> Without it, master rotation is a brief planned-outage event. Phase G
> (CI guards) is the natural home; will be tracked as a follow-on to
> Phase D (MAC edge closure).

#### Envelope KEK rotation

AWS symmetric KMS keys with `Enabled = true` and
`KeyManager = CUSTOMER` rotate automatically at 365 days if
`aws kms enable-key-rotation --key-id <KEY>` was called once. Decrypt
operations transparently work against any historical key version. We
enable this by default in the provisioning runbook. **No operator
action is required for envelope KEK rotation** other than (a) verifying
the rotation status quarterly and (b) sampling a decrypt against a
known-historical-version ciphertext to confirm.

```bash
# Verify rotation is enabled
aws kms get-key-rotation-status \
  --key-id alias/smart-agent-session-envelope-kek
# → { "KeyRotationEnabled": true, "KeyId": "...", "RotationPeriodInDays": 365 }
```

GCP equivalent: `--rotation-period=90d` is set at provisioning time
(see provisioning runbook § Step 4); GCP rotates symmetric KEKs
on-schedule with no operator action.

### 4.2 bundlerSigner

See § 3.1.5 — the address-immutability problem.

**Operational reality today (pre-Phase A.1)**:

- Cadence rotation requires factory redeploy.
- Compromise response: disable the compromised key + immediately
  redeploy the factory; existing accounts continue with the compromised
  bundler (which is now disabled and therefore inoperable, so the
  existing accounts are bricked from userOp submission). This is
  acceptable for the demo seed since fresh-start re-seeds; it is NOT
  acceptable for production.
- **Therefore: Phase A.1 (bundler registry) MUST land before
  production deployment.** This is a HARD GATE.

### 4.3 sessionIssuer

Same as bundlerSigner — address immutability is a hard constraint and
Phase A.1 (role registry) is the prerequisite. Defense in depth: even
with a compromised sessionIssuer, an attacker cannot mint a session
without ALSO obtaining a user owner signature. Variant A sessions do
not use sessionIssuer at all (they redeem via DelegationManager). The
blast radius of sessionIssuer compromise is therefore limited to
"attacker can attempt session-mint flows but is blocked at the user-sig
check on each attempt".

### 4.4 Tool executor signers

Per-tool family; rotation in three of the five is feasible
independently. The address change is recorded via the tool-executor
delegation chain — each tool family's address is delegated AT to it by
the master at boot; rotating the family signer is therefore just a
re-derivation of the address + a new delegation issuance. No
contract-level immutability problem here because tool executors are
delegates, not constructor-arg slots.

```bash
# Per tool, e.g. disbursement
TOOL=disbursement
NEW_TOOL_KEY_ID=$(awslocal kms create-key \
  --key-usage SIGN_VERIFY --key-spec ECC_SECG_P256K1 \
  --query 'KeyMetadata.KeyId' --output text)
awslocal kms update-alias \
  --alias-name alias/smart-agent-tool-$TOOL \
  --target-key-id "$NEW_TOOL_KEY_ID"
# Update env, restart, re-issue delegations
```

### 4.5 MAC sub-keys

Per inter-service edge. The same multi-kid trust-list problem as the
master signing key (§ 4.1) applies. Today, MAC rotation requires the
planned-outage window. Phase A.1 will fix this.

---

## 5. Post-rotation verification

### 5.1 Signature sample (proves the new key is in use)

Within 60 seconds of the env propagation:

```bash
# A2A agent: verify the bundler signer in use
curl -s "$A2A_AGENT_URL/diag/key-state" | jq .
# Expected:
# {
#   "bundlerSigner": {
#     "kmsKeyId": "<NEW_KEY_ID>",
#     "evmAddress": "<NEW_EVM_ADDR>",
#     "rotatedAt": "<ISO>"
#   },
#   "sessionIssuer": { ... },
#   "master": { ... }
# }
```

> **Note**: `/diag/key-state` does NOT exist today. It is a recommended
> addition; tracked as "K1-Q3 — diagnostic endpoint for key state".
> Until it lands, verify via the log line emitted on boot
> (`bundler signer derived: 0x...`).

### 5.2 Audit row from a known operator action

Trigger an audit-producing action (e.g. an admin tool action) and
verify the audit row records the new signer:

```bash
# Trigger a known action
curl -s -XPOST "$A2A_AGENT_URL/admin/test-emit-audit" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"kind":"rotation-verification"}'

# Inspect the most recent audit row
psql "$A2A_PG_URL" -c "
  SELECT id, kind, signer_address, kms_key_id, created_at
  FROM execution_audit
  ORDER BY id DESC LIMIT 1;
"
# Verify signer_address matches $NEW_EVM_ADDR and kms_key_id matches $NEW_KEY_ID
```

### 5.3 Cast spot-check (proves on-chain acceptance — for any role bound to a contract address)

For bundlerSigner / sessionIssuer (NOT applicable to master signing
key today since master is not bound to a contract address):

```bash
# Pick a freshly-deployed account from the demo seed
DEMO_ACCT=$(psql "$WEB_PG_URL" -tA -c "
  SELECT smart_account_address FROM users WHERE email LIKE 'maria%' LIMIT 1;
")

# Read the bundlerSigner from the account
cast call "$DEMO_ACCT" "bundlerSigner()(address)" --rpc-url "$RPC_URL"
# Expected: $NEW_EVM_ADDR (only after Phase A.1 registry-based reads;
# pre-A.1, the account stores the OLD address immutably and the cast
# call returns the OLD address — which is the gap A.1 closes).
```

### 5.4 Audit-chain checkpoint comparison

```bash
# Generate post-rotation checkpoint
pnpm tsx scripts/audit-chain-checkpoint.ts \
  --out tmp/checkpoints/<date>-post-rotation.json

# Diff against pre-rotation
diff tmp/checkpoints/<date>-pre-rotation.json \
     tmp/checkpoints/<date>-post-rotation.json
# Expected: head hash advanced; chain continuous; no gaps in sequence.
```

---

## 6. Rollback procedure

Target rollback window: **≤1 hour** from start of rotation to fully
restored on the old key.

### 6.1 Decision: rollback or roll-forward?

If the verification (§ 5) succeeds, no rollback. If it fails:

| Failure mode | Decision |
|---|---|
| New key derives the wrong EVM address (curve mismatch). | ROLLBACK immediately — every userOp signed by the new key will fail on chain. |
| Audit row has no `signer_address` column populated. | ROLL FORWARD — fix the audit writer; the signature is correct. |
| Cast spot-check returns OLD address (expected pre-A.1). | ROLL FORWARD — this is the known gap. |
| New key rejects every signing request with `KMSInvalidStateException`. | ROLLBACK — IAM scoping is broken on the new key. |
| MAC verification fails across services. | ROLLBACK — multi-kid trust list not yet implemented. |

### 6.2 Rollback steps (AWS)

```bash
# Re-point the alias back to the old key
aws kms update-alias \
  --alias-name "$KEY_ALIAS" \
  --target-key-id "$OLD_KEY_ARN"

# If the new key was created (vs. just rotated), schedule deletion
# only AFTER you have confirmed nothing depends on it
# aws kms schedule-key-deletion --key-id "$NEW_KEY_ARN" --pending-window-in-days 30

# Re-update env var to old ARN
vercel env rm AWS_KMS_BUNDLER_SIGNER_KEY_ID production --yes
echo "$OLD_KEY_ARN" | vercel env add AWS_KMS_BUNDLER_SIGNER_KEY_ID production
vercel --prod
```

### 6.3 Rollback steps (GCP)

```bash
# Re-pin env var to old version
vercel env rm GCP_KMS_BUNDLER_SIGNER_VERSION production --yes
echo "$OLD_VERSION" | vercel env add GCP_KMS_BUNDLER_SIGNER_VERSION production
vercel --prod

# Re-enable the old version if it was disabled
gcloud kms keys versions enable "$OLD_VERSION" \
  --key="$KEY" --keyring="$KEYRING" --location="$LOCATION"

# Optionally disable the new (mistakenly-created) version
gcloud kms keys versions disable "$NEW_VERSION" \
  --key="$KEY" --keyring="$KEYRING" --location="$LOCATION"
```

### 6.4 Retention window (when can we destroy the old key?)

| Key | Retention before destroy | Rationale |
|---|---|---|
| **master** (signing) | **180 days** disabled, then destroy. | Longest expected signature redemption window: any bundler-relay tx that referenced the old master must have been mined long ago, but audit-chain verification may reference old MAC origin signatures for retroactive review. |
| **bundlerSigner** | **90 days** disabled, then destroy. | Once accounts using the old bundlerSigner have been migrated (via Phase A.1 registry update), no signing operation will reference the old key. |
| **sessionIssuer** | **90 days** disabled, then destroy. | Session lifetime upper bound is short; 90 days covers worst-case in-flight Variant B sessions. |
| **Envelope KEK** | NEVER destroy historical versions. | Any session row encrypted under an old version must remain decryptable forever, OR be re-encrypted under the new version (not currently in scope). |
| **MAC sub-keys** | **30 days** disabled, then destroy. | MAC verification is point-in-time; no historical replay requirement. |
| **Tool executor signers** | **180 days** disabled, then destroy. | Tool-executor delegations have finite lifetime; 180d covers the longest tool delegation TTL plus audit retention. |

After the retention window:

```bash
# AWS — schedule deletion (default 30-day pending window)
aws kms schedule-key-deletion --key-id "$OLD_KEY_ARN" --pending-window-in-days 30

# GCP — schedule destruction (24h pending window)
gcloud kms keys versions destroy "$OLD_VERSION" \
  --key="$KEY" --keyring="$KEYRING" --location="$LOCATION"
```

Both providers allow cancellation during the pending window.

---

## 7. Documentation requirement

Every rotation MUST produce an entry in
`docs/security/key-management/rotation-log.md`. The log is the
**source of truth** for what has rotated when, by whom, against what
trigger. External auditors (SOC 2, FedRAMP) will request the log.

### 7.1 Log entry shape

```markdown
## <ISO-date> — <key-name> — <trigger-class>

- **Actor**: <operator name + reviewer name>
- **Trigger**: calendar | compromise | advisory | turnover | cryptanalytic | HNDL | drill
- **Trigger detail**: <CVE link, advisory ID, incident ID, drill plan link, or "scheduled">
- **Old key**: <ARN or version path>
- **Old EVM address** (if applicable): <0x...>
- **New key**: <ARN or version path>
- **New EVM address**: <0x...>
- **Pre-rotation checkpoint**: tmp/checkpoints/<date>-pre-rotation.json (sha256: <hash>)
- **Post-rotation checkpoint**: tmp/checkpoints/<date>-post-rotation.json (sha256: <hash>)
- **Verification artefacts**:
  - signature sample: <link to audit row id>
  - cast spot-check: <terminal output or N/A>
  - audit-chain diff: clean | dirty (explain)
- **Outcome**: SUCCESS | ROLLBACK | INCIDENT
- **Notes**: <any deviations from the runbook, follow-ups required>
```

### 7.2 Log review cadence

- **Weekly**: on-call reviews the last week's entries.
- **Monthly**: Security agent reviews the last month + maps to threat model.
- **Quarterly**: Security + Infra agents sign off on the rotation
  cadence; entries from the LocalStack drill are evidence the procedure
  still works.
- **Annual**: external auditor review (when SOC 2 / FedRAMP is in play).

### 7.3 Initial population

Until the first real rotation, the log starts with the LocalStack drill
entries from K2 dry-runs. This validates the log format and the
procedure end-to-end before any prod key is touched.

---

## 8. Open questions logged from this runbook

| # | Question | Recommended resolution | Owner |
|---|---|---|---|
| **K1-Q1** | bundlerSigner / sessionIssuer addresses are immutable per-account; cadence rotation requires factory redeploy. | Implement "Phase A.1 — role registry" — `AgentAccount` reads bundler/issuer from a `RoleRegistry` contract with owner-multisig gated updates. HARD GATE before production. | Developer + Reviewer |
| **K1-Q2** | MAC verifiers accept a single active key per edge; rotation requires planned-outage window. | Implement multi-kid trust list: each MAC verifier accepts a list of `kid` values during a rotation window. CI guard: at most 2 active keys per edge at any time. | Developer + Security |
| **K1-Q3** | No diagnostic endpoint for runtime key state. | Add `GET /diag/key-state` to a2a-agent; admin-auth-gated. | Developer |
| **K1-Q4** | Pre-rotation quiesce relies on `POST /admin/pause-relays` which does not exist. | Add the endpoint as part of Phase A acceptance criteria addendum. | Developer |
| **K1-Q5** | `scripts/audit-chain-checkpoint.ts` does not exist. | Implement; output JSON shape `{ table, head_hash, head_id, snapshot_at }`. | Developer + Security |

These open questions are tracked as follow-on issues; this runbook
documents the procedure as it will be executed POST resolution. Any
rotation attempted before they are resolved must use the manual
workarounds noted inline.

---

## 9. Residual risk (be honest)

Even with this runbook executed perfectly:

- **Address-change immutability** (K1-Q1) means existing accounts on
  Phase A but pre-A.1 cannot be rotated without a factory redeploy or
  the user migrating their account. This is a real production-blocking
  gap and is the single biggest item to resolve before live deploy.
- **Multi-kid MAC trust** (K1-Q2) means master rotation today is a
  planned-outage event. Acceptable for early production with a single
  region; not acceptable at scale.
- **No automated rotation triggers** — this is a manual runbook. A
  scheduled task that REMINDS the operator quarterly does NOT exist
  yet; until it does, calendar rotation is on the operator's calendar
  discipline.
- **Single-region KMS** — if the KMS region is down, you cannot rotate
  even if you needed to. K3 covers that scenario.
- **No live customer impact today** — there are no prod accounts; this
  runbook is largely theoretical until prod onboard. The corollary is
  that we have a window to drill K2 cleanly before any user is on the
  line.

---

## 10. Quick reference card

| Step | AWS | GCP | LocalStack |
|---|---|---|---|
| Create new key/version | `aws kms create-key ... --key-spec ECC_SECG_P256K1` | `gcloud kms keys versions create --key=...` | `awslocal kms create-key ...` |
| Point alias / env | `aws kms update-alias` then `vercel env add` | `vercel env add GCP_KMS_*_VERSION` | `awslocal kms update-alias` |
| Derive EVM addr | `pnpm exec tsx scripts/master-signer-address.ts --kms-key-id ...` | `... --gcp-version ...` | same |
| Disable old | `aws kms disable-key` | `gcloud kms keys versions disable` | `awslocal kms disable-key` |
| Schedule destroy | `aws kms schedule-key-deletion --pending-window-in-days 30` | `gcloud kms keys versions destroy` | n/a (LocalStack is ephemeral) |
| Audit | CloudTrail (K6) | Cloud Audit Logs (K6) | execution_audit table |

---

*Last updated: 2026-05-18. Authors: Security + Infra agents.
External-reviewer pass scheduled for Phase H acceptance.*
