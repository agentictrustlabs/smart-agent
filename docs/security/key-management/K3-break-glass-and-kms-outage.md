# K3 — Break-Glass and KMS Outage

> **Status**: DRAFT. **None of the mitigations described here are
> implemented today.** This document scopes the gap, proposes mitigations
> in priority order, and is honest about what we can do TODAY (very
> little) vs. what we can do AFTER each mitigation lands.

## 1. Scope

Three classes of outage are in scope:

| # | Class | Probability | Blast radius |
|---|---|---|---|
| O1 | **Single-region AWS KMS outage** | Has happened: us-east-1 KMS degradations on multiple occasions in recent years. Probability: low single-digit % per region per year. | All KMS-backed operations (envelope encrypt/decrypt, signing, MAC) fail in that region. With current single-region deployment, this is a full system outage. |
| O2 | **AWS account-wide suspension** (billing dispute, ToS action, compromised root). | Very low (<0.1%) but catastrophic. | Every KMS operation, every IAM role, every S3 bucket gone. |
| O3 | **KMS API throttling / quota exhaustion** | Higher (occasional under load). AWS KMS default request quotas are reachable under traffic spikes; the SDK retries with backoff. | Partial degradation: increased latency on every signing-class operation, occasional `ThrottlingException` surfacing to users. |

GCP equivalents track the same shape (regional Cloud KMS outage,
project suspension, quota throttling). The mitigation matrix is the
same.

---

## 2. Today's state (honest)

| Layer | Today |
|---|---|
| KMS regionality | **Single region** (`us-east-1` on AWS, `us-east1` on GCP per the provisioning runbooks). No replication. |
| Cross-cloud failover | **Not wired.** `A2A_KMS_BACKEND` is a per-deploy flag; flipping it requires a redeploy and DOES NOT have a replicated key on the other cloud. |
| Offline signing | **Not supported.** Every signing path goes through KMS at runtime. No paper-key backup exists. |
| Quota monitoring | **Not implemented.** No alert wired for KMS throttling. |
| Outage runbook | **This document.** Not exercised. |

If AWS us-east-1 KMS goes dark right now, the Smart Agent stack goes
dark with it. There is no operator action that recovers function until
KMS comes back up.

This is a real production-blocking gap. K3 prioritises the mitigations
to close it.

---

## 3. Mitigation inventory (priority order)

| # | Mitigation | Effort | Closes | Status |
|---|---|---|---|---|
| **M1** | **Multi-region KMS replication for symmetric keys** (envelope KEK + HMAC sub-keys). AWS KMS Multi-Region Keys support symmetric and HMAC. | 1–2 weeks (Terraform + a2a-agent config + dry-run) | O1 (partially), O3 (per-region quota) | NOT STARTED. **STRONGLY RECOMMENDED.** |
| **M2** | **Multi-region asymmetric KMS keys** for signing (master, bundler, sessionIssuer, tool executors). AWS KMS Multi-Region Keys DO support `ECC_SECG_P256K1` as of May 2021 onward. | 1–2 weeks | O1 (full) | NOT STARTED. **STRONGLY RECOMMENDED.** |
| **M3** | **Standby KMS in alternate cloud** (GCP-as-DR for AWS-as-prod or vice versa). Requires cross-cloud key material parity; for signing keys this means duplicate keys with the SAME EVM address — IMPOSSIBLE for KMS-generated keys, requires import. | 4–8 weeks (key import, IAM, Terraform, dry-run) | O2 | NOT STARTED. Recommended for the customer-compliance / FedRAMP package. |
| **M4** | **Offline-signed delegations with paper-key backup** for HIGHEST-risk operations only (contract upgrade authorisation, multisig escrow root). | 2–4 weeks (process, paper-wallet kit, ceremony runbook) | O2 (for last-resort actions only) | NOT STARTED. RECOMMENDED for upgrade authority. |
| **M5** | **Quota-throttling alarms + retry policy review** | 1–2 days | O3 | NOT STARTED. Easy quick win. |
| **M6** | **Request multi-region quota increases** on AWS Service Quotas console for `RequestCount` on `kms:Sign`, `kms:Decrypt`, `kms:GenerateMac`. | 1 day operator action + ~1 week AWS approval. | O3 (capacity headroom) | NOT STARTED. Block on traffic projections. |
| **M7** | **Read-only degraded mode** — system serves cached/read-only flows when KMS is down. Sessions / writes return 503. | 2 weeks (env flag, route gating, UX states) | All (UX cushion only) | NOT STARTED. Lower priority. |

---

## 4. Detailed mitigation: M1 + M2 (Multi-region KMS)

### 4.1 AWS Multi-Region Keys

AWS KMS supports Multi-Region primary keys for both **symmetric** and
**asymmetric** key specs (including `ECC_SECG_P256K1`). A primary key
in `us-east-1` is created with `--multi-region`; replicas in other
regions share the same key ID prefix (`mrk-...`) and the same key
material. Operations against the replica produce signatures identical
to operations against the primary.

For signing keys this means: a userOp signed by the
`us-east-1` replica is bit-for-bit identical to the same userOp signed
by the `us-west-2` replica. The EVM address is the SAME.

```bash
# Promote bundlerSigner to multi-region
NEW_KEY_ARN=$(aws kms create-key \
  --multi-region \
  --key-usage SIGN_VERIFY \
  --key-spec ECC_SECG_P256K1 \
  --description "Smart Agent bundlerSigner (multi-region)" \
  --region us-east-1 \
  --query 'KeyMetadata.Arn' --output text)

# Replicate to us-west-2
aws kms replicate-key \
  --key-id "$NEW_KEY_ARN" \
  --replica-region us-west-2

# (One-time) attach the same key policy to the replica
aws kms put-key-policy \
  --key-id "$NEW_KEY_ARN" \
  --policy-name default \
  --policy file://infra/policies/aws-kms-signer-policy.json \
  --region us-west-2
```

The runtime env carries the primary ARN; on a primary-region outage,
the operator (or a future automated controller) updates the env to
the replica ARN and redeploys. **Importantly**: the SDK can be made
region-aware so it AUTOMATICALLY fails over without an env flip — but
the current `aws-kms-signer.ts` is region-pinned (it uses
`AWS_REGION` env). This is a small refactor (factory pattern over a
list of regions) and is the recommended shape post-M2.

### 4.2 GCP equivalent

GCP Cloud KMS does not natively replicate keys across regions; the
equivalent is to maintain TWO independent CryptoKeyVersions (one per
region) and load both into the runtime. The asymmetric signing case
has the SAME constraint as AWS cross-cloud (§ M3): two independently
generated keys have different public keys and therefore different EVM
addresses. To preserve EVM-address parity across GCP regions, you must:

(a) Generate the key OFF-CLOUD (e.g. on a hardware wallet) and IMPORT
the same key material into two regions; OR

(b) Treat the second region's key as a SEPARATE bundler — at on-chain
read time, the AgentAccount registry (see K1-Q1 / Phase A.1) lists
BOTH addresses as acceptable.

Option (b) is operationally simpler and avoids key import; it requires
the `RoleRegistry` contract to support an address-list per role rather
than a single address. This is a small extension to A.1.

### 4.3 Recommendation

- **Land M1 + M2 within Phase H** as a blocking item for the first
  production-data deployment. Multi-region symmetric is cheap and
  closes O1 for envelope / MAC operations. Multi-region asymmetric
  for the signing keys closes O1 for userOp / bundler / sessionIssuer
  signing.

- **The Terraform modules in `infra/terraform/{aws,gcp}/` MUST default
  to multi-region** (i.e. `multi_region = true` on every signing-class
  key). Spec 007 Phase H acceptance criteria should add this as a
  REQUIRED property.

- The cost delta is small: AWS KMS is $1/month per primary key + $1/
  month per replica, $0.03 per 10K requests. A multi-region rollout
  for the full key inventory costs an extra ~$10/month.

---

## 5. Detailed mitigation: M3 (Cross-cloud DR)

For O2 (account-wide suspension), multi-region within the SAME cloud
does not help. The mitigation is to maintain a parallel KMS in the
other cloud with parity material.

### 5.1 Symmetric keys

Trivial: generate a 256-bit key off-cloud (random), import to AWS KMS
as `EXTERNAL` origin, then import to GCP KMS as `IMPORTED` origin. The
same plaintext data key encrypts to different ciphertexts under each
cloud's KMS, but DECRYPTS to the same plaintext via either cloud. The
encrypted-data-key column in `sessions` records WHICH cloud's KMS
produced it; runtime decrypt selects accordingly.

### 5.2 Asymmetric signing keys

Harder. KMS-generated key material is non-extractable. To have the
SAME signing key in AWS and GCP, you must:

1. Generate the secp256k1 key OFFLINE in a hardware-wallet ceremony.
2. Import to AWS KMS (`KeyMaterial.Origin = EXTERNAL`).
3. Import to GCP KMS (similar import flow; GCP supports KMS key
   import).
4. Destroy the offline copies.

This produces an identical public key (therefore identical EVM
address) on both clouds. The runtime can fail over by flipping
`A2A_KMS_BACKEND` and the contract layer is OBLIVIOUS to the swap.

**Risk**: the offline ceremony briefly creates a private key in
plaintext. The ceremony MUST be done in a secure environment
(air-gapped, HSM-backed signing, multiple-eyes); see the offline-signing
ceremony runbook to be drafted as part of M4.

**Alternative — Option (b) from § 4.2**: don't import; let each cloud
generate its own bundler key; teach the contract layer (via the
`RoleRegistry`) to accept BOTH addresses. Operationally simpler;
slightly weaker because compromise of one cloud's KMS lets that
cloud's bundler submit; defense in depth via the inner user signature
still holds.

### 5.3 Recommendation

- M3 Option (b) (registry accepts BOTH addresses) is the right v1.
- M3 Option (a) (import) is appropriate for the FedRAMP / SOC 2
  package when key-material parity is a customer requirement.

---

## 6. Detailed mitigation: M4 (Offline-signed paper-key backup)

This is the "last resort" lane for actions whose loss-of-availability
is catastrophic AND whose blast-radius-of-misuse is also catastrophic,
i.e. **upgrade authority** for the contract layer.

The three KMS keys (master / bundler / sessionIssuer) are NOT in this
class — they sign frequent operational traffic. The class that IS in
this class:

- **AgentAccountFactory upgrade authority** (currently NOT defined; if
  Phase A.1's RoleRegistry has an admin, that admin is in this class).
- **DelegationManager upgrade authority** (same).

For these, the recommended shape is **N-of-M multisig** (e.g. 3-of-5)
held by hardware wallets distributed geographically and to different
operators. The signing ceremony to authorise an upgrade is rare (≤1x
per year) and operator-paced.

### 6.1 What "break-glass" looks like for these

If the multisig is required AND the primary KMS is out, the multisig
operators meet (physically or via a pre-rehearsed ceremony) and sign
the upgrade transaction using the paper / hardware-wallet keys. The
resulting signed transaction is submitted via ANY available RPC.

This is the ONLY path that survives O2 + a need to actually CHANGE
contracts. For O2 without an upgrade need, M3 alone suffices.

### 6.2 Storage of multisig keys

- 5 hardware wallets (e.g. Ledger Nano X), one per multisig signer.
- 5 paper backups, each one in a geographically distinct
  bank-deposit-box-equivalent.
- Annual signer integrity check: each operator confirms ability to
  produce a signature with their key.
- Quarterly multisig drill: signers produce a no-op signature on a
  test message; result archived as proof of operability.

### 6.3 Recommendation

- Land M4 as part of Phase A.1 (RoleRegistry) — the multisig becomes
  the admin of the RoleRegistry.
- Document the ceremony runbook as a SEPARATE doc
  (`docs/security/key-management/M4-multisig-ceremony.md`) when M4 is
  scoped. Out of scope for this K3.

---

## 7. Detection: what tells us KMS is out?

| Signal | Source | Today? |
|---|---|---|
| Per-call latency spike on `kms:Sign` | a2a-agent metrics | NO (no metrics). |
| Increased `KMSInvalidStateException` / `KMSThrottlingException` rate | a2a-agent error logs | YES (logged) but not alerted. |
| AWS Health Dashboard event | aws.amazon.com/health | YES (manual check). |
| `kms:DescribeKey` failures from a separate liveness check | Liveness probe (not yet) | NO. |
| User-facing 5xx rate spike | Vercel monitoring | YES (assuming we read it). |

### 7.1 Recommended detection wiring (K6)

- a2a-agent exports a Prometheus metric
  `kms_call_duration_seconds{operation,key_class,backend}`.
- Alert: `histogram_quantile(0.95, ...) > 5s for 1 min` → P1 page.
- Alert: `kms_call_failures_total / kms_call_total > 0.1 for 1 min` → P1 page.
- Liveness probe: separate cron task pings `kms:Sign` against a
  dedicated low-value key every 60s; failure for 3 consecutive
  intervals → P1 page.

Wiring lives in K6 (this doc declares the requirement; K6 specifies
the rules).

---

## 8. Outage response playbook

### 8.1 O1 — Single-region KMS outage

**Trigger**: `kms_call_failures_total / kms_call_total > 0.5 for 2 min`
on the primary region.

| Step | Action | Owner |
|---|---|---|
| 1 | Verify AWS Health Dashboard reports KMS impairment in the affected region. | On-call |
| 2 | Confirm the failover region (replica) is healthy: `aws kms describe-key --region $REPLICA --key-id $REPLICA_ARN`. | On-call |
| 3 | (POST-M2) Flip `AWS_REGION` env var in Vercel to the replica region OR engage the SDK's region failover. | On-call |
| 4 | (PRE-M2) Apologise to users; outage continues until KMS comes back up. Post `[KMS-OUTAGE]` status notice. | On-call |
| 5 | Verify recovery: run K1 § 5.1 signature sample against the failed-over region. | On-call |
| 6 | Post-incident: ratchet up multi-region quota if traffic on replica caused secondary throttling. | Infra |

### 8.2 O2 — Account-wide AWS suspension

**Trigger**: AWS console access fails AND every KMS call returns
`AccessDeniedException`.

| Step | Action | Owner |
|---|---|---|
| 1 | Confirm the suspension via AWS support escalation OR via a separate AWS account. | Security |
| 2 | (POST-M3a) Flip `A2A_KMS_BACKEND` to `gcp-kms` (or vice versa); redeploy. The DR cloud's keys MUST have been kept in lockstep via the IaC pipeline (Phase H). | On-call |
| 3 | (POST-M3b, registry pattern) Same flip; the contract layer recognises both clouds' bundler addresses; sessions in-flight under the AWS bundler are abandoned (small UX impact); new sessions mint against the GCP bundler. | On-call |
| 4 | (PRE-M3) System remains down until AWS access is restored. | n/a |
| 5 | If the AWS root was compromised, see K5 (key escrow / account loss recovery). | Security |

### 8.3 O3 — KMS API throttling

**Trigger**: `KMSThrottlingException` rate > 0.05 for 2 min.

| Step | Action | Owner |
|---|---|---|
| 1 | Check Service Quotas console for current consumed quota. | On-call |
| 2 | Apply emergency quota increase request (AWS Support). Typical TTL: hours, not days. | On-call |
| 3 | (Interim) Switch the SDK's retry backoff to a more aggressive curve. | On-call |
| 4 | (Persistent) Engage M1 multi-region: requests distribute across regions, each with its own quota. | Infra |

---

## 9. Audit + announcement requirements

EVERY break-glass invocation produces an audit record AND an external
announcement.

### 9.1 Audit record

`docs/security/key-management/break-glass-log.md` (proposed; does not
exist yet) records every invocation:

```markdown
## <ISO-date> — <O1/O2/O3> — <outcome>

- **Operator(s)**: <names>
- **Trigger**: <alert detail>
- **Duration**: <wall clock from first alert to restored>
- **Actions taken**: <bulleted list of steps from § 8>
- **Verification**: <evidence of restored function>
- **Post-mortem**: link to post-mortem doc (within 5 business days)
- **Follow-ups**: enumerated, with owners
```

### 9.2 External announcement

- **O1 (regional outage)**: a public status note on the (yet-to-exist)
  `status.smart-agent.dev` page. Customer-language only ("Some
  signing operations are degraded"); no detail on the KMS backend.
- **O2 (account suspension)**: incident-handling per the company
  incident-response policy; the BOARD is notified within 1 hour.
- **O3 (throttling)**: internal-only unless user-facing 5xx exceeds 5%
  for 5 min; then a public status note.

---

## 10. Honest disclosure

What this doc does NOT do today:

- It does not protect against any outage. None of M1–M7 is built.
- It does not specify the liveness probe in code form.
- It does not address GCP regional outage with the same depth as AWS.
- It does not draft the M4 multisig ceremony runbook (separately
  scoped).
- It does not solve the contract-layer immutability problem for
  bundler/issuer addresses — that's K1-Q1 / Phase A.1.

What the BOARD should take away:

- **There is a real production-blocking outage gap today.**
- **M1 + M2 (multi-region KMS) is the highest-leverage mitigation
  and should land before any production user traffic.** It's 1–2 weeks
  of work and ~$10/month operational cost.
- **M3 (cross-cloud DR) is appropriate for the FedRAMP / regulated
  customer track; it can be deferred until that customer ask
  materialises.**
- **The "what happens if AWS suspends our account?" question has no
  good answer today.** M3 is the answer; until M3 lands, the answer is
  "we are down".

---

*Last updated: 2026-05-18.*
