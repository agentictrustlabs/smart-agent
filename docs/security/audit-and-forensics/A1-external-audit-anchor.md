# A1 — External Audit Anchor

> **Status**: Draft. Sprint 3 S3.1 (`apps/a2a-agent/src/lib/audit-checkpoint.ts`)
> landed the local signed-checkpoint primitive and the generic webhook sink.
> What is *missing* is the second leg: a truly external, append-only, third-party
> store that an attacker who roots our infrastructure cannot mutate after the
> fact. This document specifies that leg.
>
> **Effort**: M (1 week dev) + S (S3 bucket + IAM provisioning) + ongoing
> cost (~$50–$100/mo).
>
> **Owner**: infra + security.
>
> **Reading time**: ~20 min.

---

## 1. Problem statement

The `execution_audit` table is *internally* tamper-evident: each row carries
`prev_entry_hash` and `entry_hash` (sha256), so the row sequence forms an
append-only chain. The checkpoint emitter signs the chain head every 15 min
(prod) using the master signer and persists it to `audit_checkpoint`. This
is a strong **internal** primitive but is **not sufficient** for an
adversary who controls the SQLite file:

> **Threat**: a privileged operator, a compromised CI service account, or a
> cloud provider insider rewrites the entire DB (audit chain + checkpoint
> table) consistently. From inside the system, the chain still verifies.
> No external observer can detect the rewrite.

The fix is to ensure that **at least one copy of every checkpoint lives
somewhere we cannot rewrite, even with root**. That is what "external
anchor" means here: a destination with WORM (Write-Once-Read-Many)
semantics that is operationally independent of the application's own
infrastructure.

## 2. Threat model delta

This doc covers the gap between the **Sprint 3 S3.1** "tamper-evident
chain" claim and an actual "tamper-proof archive" claim. Specifically:

| Attacker | Can defeat S3.1 alone? | Can defeat A1? |
|---|---|---|
| External web attacker (no DB access) | No | No |
| Privileged operator (DB write access) | **Yes** — rewrites both `execution_audit` and `audit_checkpoint` | No — sink rows are immutable for the retention period |
| Cloud provider insider (host root) | **Yes** — rewrites disk | No — sink is in a different account/region |
| Nation-state with subpoena power against the same cloud provider | Yes (if anchor lives in the same provider) | Reduced via cross-provider anchor (S3 + Ethereum) |
| Quantum adversary post-CRQC | Out of scope here — covered in `C3-cryptographic-agility-and-pqc.md`. The retention requirement (7 years) means a CRQC arriving in that window does NOT retroactively forge old anchors as long as the anchor binds a sha256 digest, which it does. | — |

`[OWE-REVIEWER]` — explicitly cross-reference C1 threat model section 4
(insider compromise) once this doc lands.

## 3. Options analysis

We evaluated five anchor options against five criteria: immutability
strength, cost, latency, public verifiability, and operational
complexity.

### 3.1 Option A: AWS S3 with Object Lock (Compliance mode)

- **Mechanism**: S3 bucket with Object Lock enabled in *Compliance* mode
  (not *Governance*). Once an object is written with a retention period,
  **no principal — including the AWS root account holder — can delete or
  modify it before the retention window expires**. Compliance mode is the
  enforcement teeth.
- **Citations**:
  - AWS docs: <https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-overview.html>
  - SEC Rule 17a-4(f) qualification: AWS publishes an annual assessment by
    Cohasset Associates confirming S3 Object Lock (Compliance mode + legal
    holds) satisfies SEC 17a-4(f) and FINRA 4511(c) electronic-records
    requirements: <https://aws.amazon.com/compliance/sec-rule-17-a-4f/>.
- **Immutability strength**: Strong within AWS. The bucket policy locks
  out *every* IAM principal in the account during retention.
- **Cost**: S3 Standard storage is $0.023/GB-month + $0.005 per 1k PUT.
  Checkpoints @ 96/day × 365 days × 1 KB each ≈ 35 MB/year. **<$1/year
  for the storage; <$10/year for the PUTs**. Object Lock is free.
  Cross-region replication doubles it. `[COST]` — <$25/yr total even with
  replication.
- **Latency**: ~100 ms PUT under normal conditions. Fits comfortably in
  the existing 15-min cadence with 5 s timeout + 3-attempt backoff
  (S3.1's existing logic — no change needed).
- **Public verifiability**: Customer would need to query S3 via a
  pre-shared bucket policy or an explicitly delegated read role. Not
  *publicly* verifiable without setup.
- **Operational complexity**: Low. One bucket, one IAM role (Vercel OIDC
  federation, same pattern as KMS), one lifecycle policy.

### 3.2 Option B: AWS S3 with Object Lock (Governance mode)

- Same as 3.1 except a principal with `s3:BypassGovernanceRetention` *can*
  delete/modify. Operationally identical, evidentiarily weaker. **Not
  recommended.** Mention only to record the rejection.

### 3.3 Option C: Ethereum mainnet anchor

- **Mechanism**: A small "anchor receiver" contract on Ethereum mainnet
  with a single `anchor(bytes32 tipHash, uint256 chainTimestamp)` function
  that emits an event indexed by tipHash. We call it on a cadence (weekly
  for cost reasons, not per-15-min) from a dedicated EOA we control.
- **Citations**:
  - Surface for stamping-on-Ethereum: <https://docs.opentimestamps.org/>
    (the OpenTimestamps protocol does this generically for any blockchain).
  - Pure-data on-chain pattern (Optimism / Polygon variants follow same
    shape): we publish our own minimal contract.
- **Immutability strength**: Maximal in practice. Reorgs are bounded
  ≤7 days for serious attack vectors; finality is ~13 minutes (PoS).
- **Cost** at 2026-05-18 gas prices (~10–30 gwei, ETH ~$3,500):
  - One anchor tx ≈ 25k gas (event emit + storage write of timestamp).
  - At 25 gwei × 25k × $3,500/ETH ≈ **$2.19/anchor**.
  - Weekly cadence ≈ 52 anchors × $2.19 ≈ **$114/yr** (range $50–$250
    depending on gas).
  - `[COST]` — keep an alert at $200/yr; widen cadence if gas spikes
    persistent. `[DECISION]` — weekly cadence is the chosen point on the
    cost/granularity curve.
- **Latency**: 13 min finality + 1–2 min mempool. Acceptable for weekly.
- **Public verifiability**: **High**. Anyone with a block explorer can
  fetch the event and verify the tip hash without our cooperation.
- **Operational complexity**: Moderate. Need:
  - One contract (~50 lines, no constructor args beyond owner).
  - One EOA / KMS-backed signer for the anchor sender (NOT the master
    signer — separate key so a compromised anchor signer can't sign
    audit checkpoints).
  - Gas-management runbook (warn at 0.05 ETH balance, top up at 0.02 ETH).

### 3.4 Option D: Bitcoin OP_RETURN

- **Mechanism**: 32-byte tip hash written into an `OP_RETURN` output of a
  Bitcoin transaction (max 80 bytes per OP_RETURN — we use 33 bytes:
  version byte + 32 byte tip hash).
- **Citations**:
  - OpenTimestamps default backend: <https://opentimestamps.org/>.
  - Bitcoin OP_RETURN limit (80 bytes, BIP 0):
    <https://github.com/bitcoin/bitcoin/blob/master/doc/release-notes/release-notes-0.12.0.md>.
- **Immutability strength**: Strongest. Bitcoin's reorg depth is shallower
  than Ethereum's at any given finality budget.
- **Cost**: A single P2WPKH+OP_RETURN tx at 25 sat/vB (typical 2026
  median) ≈ 6,000 sats = ~$3.50/tx (BTC ~$60k). Daily cadence ≈ $1,300/yr.
  Weekly ≈ $185/yr. `[COST]` — comparable to Ethereum at current rates.
- **Latency**: 1 hr for 6-confirmation finality. Acceptable for daily or
  weekly.
- **Public verifiability**: Highest. OpenTimestamps verifier is widely
  trusted.
- **Operational complexity**: Higher. Bitcoin tooling, UTXO management,
  fee estimation, RBF protection. **Rejected for v1** to avoid widening
  our crypto-ops surface — revisit in 12 months.

### 3.5 Option E: Public timestamping service (notary)

- **Mechanism**: <https://opentimestamps.org/> as a hosted service that
  proxies to Bitcoin batches. Free; aggregation across many users batches
  many submissions into one Bitcoin tx.
- **Pros**: Zero ops cost. Free.
- **Cons**: Trust the calendar server's batching, then trust the proxy
  doesn't lose your submission. Verifiability is good but requires
  understanding the OTS proof format.
- **Verdict**: Useful as a *third* belt-and-braces signal but **not as
  the primary anchor** because batching latency is up to 1 hr and the
  calendar service is a single point of failure for proof delivery.

### 3.6 Recommendation matrix

| Cadence | Layer 1 (always-on) | Layer 2 (weekly) | Layer 3 (optional, free) |
|---|---|---|---|
| Every 15 min | **S3 Object Lock (Option A)** | — | — |
| Weekly | — | **Ethereum mainnet (Option C)** | OpenTimestamps (Option E) |

`[DECISION]` — Adopt Layer 1 + Layer 2. Layer 3 is a follow-up if we want
"truly free, no infrastructure" diversification. The combination gives us
near-real-time anchoring inside AWS (S3 Object Lock) plus a public,
verify-without-our-cooperation weekly anchor on Ethereum.

## 4. Implementation specification

### 4.1 File layout

```
apps/a2a-agent/src/lib/
├── audit-checkpoint.ts          (existing — Sprint 3 S3.1)
├── audit-anchor.ts              (NEW — wraps checkpoint export + dual-leg sink)
└── audit-anchor-eth.ts          (NEW — Ethereum weekly anchor)

apps/a2a-agent/src/db/
├── schema.ts                    (existing — adds `audit_anchor` table)

contracts/
└── src/audit/AuditAnchor.sol    (NEW — minimal anchor receiver)

scripts/
├── verify-audit-chain.ts        (existing — extend to verify both legs)
└── deploy-audit-anchor.ts       (NEW — one-time mainnet deploy script)
```

### 4.2 `audit-anchor.ts` contract

This module extends the existing `audit-checkpoint.ts` flow. The
generic webhook sink (`AUDIT_CHECKPOINT_SINK_URL`) stays as a third leg
for customers who want their own SIEM ingest path; A1 adds two more legs.

```typescript
// apps/a2a-agent/src/lib/audit-anchor.ts (sketch — full impl in PR)
import { exportCheckpoint, type Checkpoint } from './audit-checkpoint'
import { putS3Object } from './audit-anchor-s3'
import { maybeAnchorOnChain } from './audit-anchor-eth'

export async function exportAndAnchor(): Promise<{
  checkpoint: Checkpoint
  s3Result: 'ok' | 'failed'
  ethResult: 'submitted' | 'skipped' | 'failed'
}> {
  const cp = await exportCheckpoint()  // existing — writes local row + best-effort generic sink

  // Leg 1: S3 Object Lock — EVERY checkpoint.
  let s3Result: 'ok' | 'failed' = 'failed'
  try {
    await putS3Object(cp)
    s3Result = 'ok'
  } catch (err) {
    console.error('[audit-anchor] S3 PUT failed:', err)
    // emit metric `audit_anchor_s3_failure_total`
  }

  // Leg 2: Ethereum — only on weekly cadence trigger.
  const ethResult = await maybeAnchorOnChain(cp)

  return { checkpoint: cp, s3Result, ethResult }
}
```

Cadence wiring: replace the call to `exportCheckpoint()` inside
`scheduleCheckpoints()` (`audit-checkpoint.ts:333`) with
`exportAndAnchor()`. The 15-min cadence drives both `exportCheckpoint`
(local + generic sink) and the S3 PUT; the Ethereum leg is gated by
`maybeAnchorOnChain()` which is a no-op unless the next anchor is due.

### 4.3 `audit-anchor-s3.ts` — S3 Object Lock implementation

```typescript
// apps/a2a-agent/src/lib/audit-anchor-s3.ts (sketch)
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { fromVercelOidc } from '@vercel/oidc-aws-credentials-provider'
import { config } from '../config'

const s3 = new S3Client({
  region: config.AWS_REGION,
  credentials: fromVercelOidc({ roleArn: config.AUDIT_ANCHOR_S3_ROLE_ARN }),
})

export async function putS3Object(cp: Checkpoint): Promise<void> {
  const key = `checkpoints/${cp.chainId}/${cp.timestamp}-${cp.latestEntryId}.json`
  const body = JSON.stringify(cp)
  const retainUntil = new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000)  // 7 yrs

  await s3.send(
    new PutObjectCommand({
      Bucket: config.AUDIT_ANCHOR_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      // Compliance-mode Object Lock — no principal can delete/modify
      // before `retainUntil`.
      ObjectLockMode: 'COMPLIANCE',
      ObjectLockRetainUntilDate: retainUntil,
      // ChecksumSHA256 forces an integrity check on PUT.
      ChecksumSHA256: sha256Base64(body),
    }),
  )
}
```

**Bucket setup (one-time, Terraform-tracked in Phase H):**

```hcl
resource "aws_s3_bucket" "audit_anchor" {
  bucket = "smart-agent-audit-anchor-prod"
  object_lock_enabled = true
}

resource "aws_s3_bucket_object_lock_configuration" "audit_anchor" {
  bucket = aws_s3_bucket.audit_anchor.bucket
  rule {
    default_retention {
      mode  = "COMPLIANCE"
      years = 7
    }
  }
}

resource "aws_s3_bucket_versioning" "audit_anchor" {
  bucket = aws_s3_bucket.audit_anchor.bucket
  versioning_configuration { status = "Enabled" }  # required for Object Lock
}

resource "aws_s3_bucket_replication_configuration" "audit_anchor" {
  # Cross-region replica for resilience; replica inherits Object Lock.
  bucket = aws_s3_bucket.audit_anchor.bucket
  role   = aws_iam_role.audit_anchor_replication.arn
  rule {
    id     = "audit-anchor-cross-region"
    status = "Enabled"
    destination {
      bucket        = aws_s3_bucket.audit_anchor_replica.arn
      storage_class = "STANDARD_IA"
    }
  }
}
```

**IAM**: a dedicated Vercel OIDC role `audit-anchor-writer` with `s3:PutObject`
and `s3:PutObjectRetention` on this bucket only. **No `s3:DeleteObject`** —
not because it would be honoured under Compliance mode, but because
denying it at the IAM layer prevents accidental noise in CloudTrail and
makes the principle-of-least-privilege story cleaner.

### 4.4 `audit-anchor-eth.ts` — Ethereum weekly anchor

```typescript
// apps/a2a-agent/src/lib/audit-anchor-eth.ts (sketch)
import { createWalletClient, createPublicClient, http, keccak256, toBytes } from 'viem'
import { mainnet } from 'viem/chains'
import { AuditAnchorAbi } from '../contracts/AuditAnchor.abi'
import { getAnchorSigner } from '../auth/anchor-signer'  // separate KMS key, NOT master

const ANCHOR_CADENCE_MS = 7 * 24 * 60 * 60 * 1000  // 1 week

export async function maybeAnchorOnChain(cp: Checkpoint): Promise<'submitted' | 'skipped' | 'failed'> {
  const last = await getLastEthAnchorTimestamp()
  if (last && Date.now() - last.getTime() < ANCHOR_CADENCE_MS) return 'skipped'

  const signer = await getAnchorSigner()
  const wallet = createWalletClient({ account: signer, chain: mainnet, transport: http(config.ETH_RPC_URL) })

  try {
    const tipHash = keccak256(toBytes(cp.latestEntryHash))
    const txHash = await wallet.writeContract({
      address: config.AUDIT_ANCHOR_CONTRACT,
      abi: AuditAnchorAbi,
      functionName: 'anchor',
      args: [tipHash, BigInt(Math.floor(Date.now() / 1000))],
    })
    await recordEthAnchor({ tipHash, txHash, timestamp: new Date() })
    return 'submitted'
  } catch (err) {
    console.error('[audit-anchor-eth] anchor tx failed:', err)
    return 'failed'
  }
}
```

The anchor signer is a **separate KMS key** (`auditAnchorSigner`) listed
in `docs/security/key-management/README.md`'s key inventory. Rotating it
on the K1 cadence does not affect master / bundler / sessionIssuer keys.

### 4.5 `AuditAnchor.sol` contract

Minimal — under 50 lines. No upgradeability (intentional: if we ever need
to "upgrade," we deploy a v2 and start a fresh anchor sequence; old
events stay valid forever).

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * AuditAnchor — receives Smart Agent audit-chain tip hashes on Ethereum
 * mainnet, emitting an event indexed by tip hash so anyone with a block
 * explorer can prove a given chain head existed at a given block height.
 *
 * Not upgradeable. Single writer (the configured signer). No funds.
 */
contract AuditAnchor {
    address public immutable writer;

    event Anchored(bytes32 indexed tipHash, uint256 chainTimestamp, uint256 blockTimestamp);

    error NotWriter();

    constructor(address _writer) { writer = _writer; }

    function anchor(bytes32 tipHash, uint256 chainTimestamp) external {
        if (msg.sender != writer) revert NotWriter();
        emit Anchored(tipHash, chainTimestamp, block.timestamp);
    }
}
```

`[OWE-REVIEWER]` — handed to SC1 auditor as an additional minor surface
(but trivial enough to slot into the same audit window without scope
inflation).

### 4.6 New DB schema — `audit_anchor`

Adds a sibling to `audit_checkpoint`:

```typescript
// apps/a2a-agent/src/db/schema.ts (additions)
export const auditAnchor = sqliteTable('audit_anchor', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  checkpointRowId: integer('checkpoint_row_id').notNull(),
  // 'aws-s3' | 'eth-mainnet'
  leg: text('leg', { enum: ['aws-s3', 'eth-mainnet'] }).notNull(),
  status: text('status', { enum: ['ok', 'failed'] }).notNull(),
  // S3 object URL or ETH tx hash; opaque to this schema.
  externalRef: text('external_ref').notNull(),
  attempts: integer('attempts').notNull().default(1),
  createdAt: text('created_at').notNull(),
})
```

### 4.7 Verification CLI extensions

`scripts/verify-audit-chain.ts` already walks the local chain and verifies
signatures on local checkpoint rows. Extend it to fetch each anchor leg
and re-verify:

```
$ pnpm tsx scripts/verify-audit-chain.ts \
    --since 2026-05-01 \
    --s3-bucket smart-agent-audit-anchor-prod \
    --eth-rpc $ETH_RPC_URL \
    --eth-contract 0x...

[verify] chain rows: 1..14,237 ........ OK
[verify] local checkpoints: 96 ........ OK (all signatures valid)
[verify] S3 leg: fetched 96 objects ... OK (every local checkpoint matches the S3 body byte-for-byte)
[verify] ETH leg: 4 weekly anchors .... OK
        - block 22,189,011 anchored tipHash 0xab12... at chainTimestamp 1715789432
        - block 22,231,007 anchored tipHash 0xcd34... at chainTimestamp 1716394312
        ...
[verify] ALL LEGS PASS.
```

A divergence at any leg is fatal and exits non-zero. The CI cron in §6
runs this nightly.

## 5. Verification procedure (external party)

This is the section a regulator / customer auditor can execute themselves
WITHOUT our cooperation beyond bucket-read credentials:

1. Pre-share: customer auditor gets read-only credentials to the S3 bucket
   (via `s3:GetObject` on a specific path prefix only — no list of other
   keys).
2. Auditor downloads any subset of `s3://smart-agent-audit-anchor-prod/checkpoints/...`
   for the period they're auditing.
3. Auditor downloads the **same** rows from the `audit_checkpoint` table
   (we provide a SQL or CSV export).
4. Auditor confirms:
   1. For every S3 object, `signerAddress` matches the configured master
      signer's public address (independently published in the spec).
   2. For every S3 object, `signature` verifies the digest derived from
      `latestEntryHash || timestamp || chainId` (deterministic, matches
      `buildCheckpointDigest`).
   3. For every weekly anchor in the period, the auditor fetches the
      Ethereum block via Etherscan / their own RPC and confirms the
      `Anchored` event payload matches one of the local checkpoints.
5. Auditor cross-checks the most-recent S3 object's `latestEntryHash`
   against the hash they recompute from a fresh dump of `execution_audit`
   rows.

If all four pass, the audit chain is *forensically defensible* for the
period covered by the anchored checkpoints.

## 6. CI / monitoring

| Signal | Source | Cadence | Alert |
|---|---|---|---|
| `audit_anchor_s3_failure_total` | a2a-agent Prom metric | per-checkpoint | PagerDuty if > 0 in any 60 min window |
| `audit_anchor_eth_failure_total` | a2a-agent Prom metric | per-anchor | PagerDuty if 2 consecutive fail |
| `audit_anchor_eth_balance_eth` | a2a-agent Prom metric | per-anchor | Warn at 0.05; page at 0.02 |
| `audit_anchor_s3_objects_uploaded` | a2a-agent Prom metric (counter) | per-checkpoint | Sanity check: matches checkpoint cadence |
| **Nightly verifier** | `scripts/verify-audit-chain.ts` in GH Actions | daily 04:00 UTC | Issue auto-created on non-zero exit |

`[OWE-REVIEWER]` — wire the SIEM alerts in A3, not here. This list is the
contract A3 implements against.

## 7. Cost summary

| Line item | Cost | Source |
|---|---|---|
| S3 storage (35 MB/yr × 7 yrs retention) | $0.02/yr | $0.023/GB-month × 7 × 0.035 |
| S3 PUTs (35k/yr) | $0.18/yr | $0.005 / 1k × 35 |
| Cross-region replication | $0.05/yr | egress + replica storage |
| Ethereum anchor tx (52/yr) | $50–$250/yr | gas market dependent |
| Anchor signer KMS key | $1/yr | one CMK |
| Verifier CI minutes | ~$5/yr | < 5 min/day, ubuntu-latest |
| **Total** | **$56–$256/yr** | dominated by ETH gas |

`[DECISION]` — accept the upper bound ($256/yr) as the operational ceiling.
If sustained gas conditions push past $400/yr we switch to monthly
cadence for the Ethereum leg.

## 8. Open questions

- `[OPEN] A1-1`: Do we publish the audit-anchor contract address + the
  master-signer address in a customer-facing security page so an auditor
  can verify *without* needing to ask us for the address? Suggested:
  yes — a `/security/anchors` static page on the marketing site.
- `[OPEN] A1-2`: Should the weekly Ethereum anchor switch to L2
  (Optimism / Base) for cost? Saves ~95% gas but trades for L2-specific
  reorg + finality assumptions. Defer until $/yr matters more.
- `[OPEN] A1-3`: Do we mirror the S3 bucket to GCS for cross-cloud
  resilience? Would defeat a hypothetical AWS-account-suspension attack.
  Cost: ~$1/yr storage, ~$5/yr egress. Defer to a Phase H follow-up.

## 9. Acceptance criteria (merge gate)

- [ ] `apps/a2a-agent/src/lib/audit-anchor.ts` + tests landed
- [ ] `apps/a2a-agent/src/lib/audit-anchor-s3.ts` + tests landed
- [ ] `apps/a2a-agent/src/lib/audit-anchor-eth.ts` + tests landed
- [ ] `audit_anchor` table migration landed
- [ ] `contracts/src/audit/AuditAnchor.sol` deployed to mainnet AND
      mumbai-testnet; addresses recorded in `docs/security/anchors.md`
- [ ] S3 bucket `smart-agent-audit-anchor-prod` provisioned via Terraform
      (Phase H module), Object Lock = Compliance, retention = 7 yrs
- [ ] Vercel OIDC role for the writer has `s3:PutObject` +
      `s3:PutObjectRetention` only (verified by a CI policy-snapshot test)
- [ ] `scripts/verify-audit-chain.ts` accepts `--s3-bucket` and
      `--eth-contract` flags and exits non-zero on divergence
- [ ] Nightly GH Actions workflow runs the verifier; alert auto-creates
      issue
- [ ] Cost dashboard widget showing month-to-date anchor spend
- [ ] Runbook entry in A6 §3 (the "audit-chain integrity violation"
      scenario) cross-links the SOP for a verifier failure

## 10. Glossary

- **Object Lock (Compliance mode)**: S3 feature; once set, the retention
  period cannot be reduced, the object cannot be deleted or overwritten,
  even by the AWS account root user. Distinct from Governance mode where
  certain principals can bypass.
- **Anchor**: a tip-hash record in an external, immutable medium.
- **Anchor signer**: a dedicated EOA (KMS-backed) whose only job is to
  submit `AuditAnchor.anchor(...)` transactions. NOT the master signer.
- **Tip**: the chain head — `audit_checkpoint.latest_entry_hash`.

---

*Last updated: 2026-05-18. Owner: Security agent + Infra agent.*
