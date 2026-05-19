# K4 — HSM / FIPS Evaluation

> **Status**: DRAFT. Evaluation reflects FIPS 140-3 transition (140-2
> sunset). Action items are operator-actionable. No claim of being
> currently FIPS-compliant — until we enable the FIPS endpoint paths
> on AWS and `protectionLevel: HSM` on every GCP key version, we are
> NOT making the claim.

## 1. Why this matters

Several customer segments REQUIRE the underlying cryptographic substrate
to be backed by a FIPS-validated module. The smart-agent product runs on
managed KMS services (AWS KMS / GCP Cloud KMS) which themselves are
FIPS-validated — but ONLY when accessed through specific endpoints and
with specific key-creation parameters. Default endpoints / parameters
do NOT give us a FIPS posture.

The regulated customer segments:

| Segment | Standard | What they want |
|---|---|---|
| Federal / GovCloud | FedRAMP Moderate or High; FISMA | FIPS 140-2 / 140-3 validated modules at "Moderate" boundaries. |
| Healthcare (US) | HIPAA Security Rule + state PII rules | "Reasonable safeguards"; FIPS-validated crypto is the de-facto industry standard for "reasonable". |
| Financial (US) | PCI DSS, GLBA, SOX | PCI DSS v4.0 § 3.5.1 requires "cryptographic algorithms and key strengths in accordance with industry best practice"; FIPS-validated modules are the industry default. |
| Financial (EU) | DORA, eIDAS | eIDAS qualified electronic signature requires a "qualified signature creation device" — HSM-equivalent. |
| Defense / Aerospace | DFARS, ITAR | FIPS 140-2 / 140-3 explicit. |
| Critical infrastructure (US) | NERC CIP, TSA Pipeline | "Strong cryptography"; FIPS-validated. |
| Enterprise customers (general) | SOC 2 + customer contracts | Often request FIPS as a checkbox. |

A customer who asks "is your signing module FIPS-validated?" must be
able to receive a YES backed by:

- The FIPS certificate number for the underlying HSM module.
- Evidence we access that module via the FIPS endpoint (AWS) or with
  the HSM protection level (GCP).
- An attestation artefact that can be archived in our compliance
  package.

K4 is the operator's checklist for delivering that.

---

## 2. FIPS background (board-relevant primer)

### 2.1 FIPS 140-3 supersedes FIPS 140-2

- FIPS 140-2 was the long-standing cryptographic-module validation
  standard.
- FIPS 140-3 was published in 2019 and went into effect on the CMVP
  (Cryptographic Module Validation Program) on 2020-09-22.
- FIPS 140-2 module certificates are being SUNSET; new validations are
  140-3 only; existing 140-2 certificates remain valid until their
  individual sunset dates (typically 5 years post-issuance).
- FIPS 140-2 validations stopped being issued on 2021-09-22.
- The AWS KMS HSM module's FIPS 140-3 Security Level 3 certificate has
  a sunset date of 2026-11-17 per the NIST CMVP listing (the operator
  refreshes the certificate reference before that date).

### 2.2 Security Levels

| Level | Summary | Real-world example |
|---|---|---|
| L1 | Software, no physical protection. | OpenSSL FIPS module on a Linux server. |
| L2 | Tamper-evident packaging + role-based auth. | A smart-card HSM. |
| L3 | Tamper-RESISTANT packaging + identity-based auth + physical-attack mitigations. | AWS KMS HSMs; GCP Cloud HSM. |
| L4 | Tamper-DETECTION packaging + environmental-fail protections. | Specialised HSMs (e.g., nShield Edge L4-evaluated configurations). |

For our customer segments above, **L3 is sufficient** for every named
standard EXCEPT a small number of defense / aerospace contracts that
specify L4 explicitly. We design for L3.

### 2.3 Module validation vs. system FIPS-compliance

FIPS-validated MODULE means an HSM (or software cryptographic module)
has a CMVP certificate. FIPS-COMPLIANT SYSTEM means the deploying
organisation (a) uses only validated modules for crypto and (b)
configures them per the module's Security Policy.

Smart Agent is in the second category — we build a system, not a
module. Our work is to USE the validated AWS KMS / GCP Cloud KMS
modules and EVIDENCE that usage.

---

## 3. AWS KMS FIPS posture

### 3.1 Module validation

AWS KMS HSMs are validated to **FIPS 140-3 Security Level 3** per the
NIST CMVP (certificate referenced in the AWS compliance documentation
at <https://aws.amazon.com/compliance/fips/>). The validation covers
the HSMs that back AWS KMS Customer Managed Keys.

Source: AWS announcement "AWS KMS is now FIPS 140-3 Security Level 3"
(2024); confirmed via NIST CMVP listings. The active certificate has a
sunset date of 2026-11-17; AWS will re-certify before that date.

### 3.2 FIPS endpoints

Even though the module is validated, calls to KMS through the DEFAULT
service endpoints (e.g., `kms.us-east-1.amazonaws.com`) do NOT
guarantee that the entire request path traverses only
FIPS-validated cryptography. The TLS termination, request signing,
etc., must also be FIPS-validated.

AWS provides **FIPS-only endpoints** for KMS in every region:

| Region | Default endpoint | FIPS endpoint |
|---|---|---|
| `us-east-1` | `kms.us-east-1.amazonaws.com` | `kms-fips.us-east-1.amazonaws.com` |
| `us-east-2` | `kms.us-east-2.amazonaws.com` | `kms-fips.us-east-2.amazonaws.com` |
| `us-west-1` | `kms.us-west-1.amazonaws.com` | `kms-fips.us-west-1.amazonaws.com` |
| `us-west-2` | `kms.us-west-2.amazonaws.com` | `kms-fips.us-west-2.amazonaws.com` |
| GovCloud | `kms.us-gov-east-1.amazonaws.com` | `kms-fips.us-gov-east-1.amazonaws.com` |
| ... | (others) | (others) |

Reference: <https://aws.amazon.com/compliance/fips/> — "AWS services
that support FIPS endpoints".

### 3.3 How we enable FIPS endpoints

The AWS SDK for JavaScript v3 supports FIPS endpoints via the
`useFipsEndpoint` config option OR the `AWS_USE_FIPS_ENDPOINT=true`
env var.

#### 3.3.1 SDK-level change

`packages/sdk/src/key-custody/aws-kms-client-config.ts` currently
constructs the `KMSClient` without explicit endpoint configuration. We
ADD:

```ts
import { KMSClient, KMSClientConfig } from '@aws-sdk/client-kms'

export function makeKmsClient(env: AwsKmsEnv): KMSClient {
  const config: KMSClientConfig = {
    region: env.AWS_REGION,
    // ...
  }

  if (env.AWS_USE_FIPS_ENDPOINT === 'true' || env.NODE_ENV === 'production') {
    config.useFipsEndpoint = true
  }

  return new KMSClient(config)
}
```

The `NODE_ENV === 'production'` branch makes FIPS the default in prod;
the env override exists for staging-only opt-out (e.g. region not yet
FIPS-supported).

#### 3.3.2 Boot-time verification

`apps/a2a-agent/src/lib/policy-startup.ts` already has the
`assertGcpEnvComplete` shape; we add an `assertFipsEndpointInUse` that:

1. Resolves the in-use KMS endpoint (`kmsClient.config.endpoint` or
   the resolved endpoint provider).
2. Asserts the hostname matches `kms-fips.<region>.amazonaws.com`.
3. Refuses to boot in prod if the check fails.

```ts
export async function assertFipsEndpointInUse(env: Env, kms: KMSClient) {
  if (env.NODE_ENV !== 'production') return
  const endpoint = await kms.config.endpoint()
  const hostname = new URL(endpoint).hostname
  if (!hostname.startsWith('kms-fips.')) {
    throw new Error(
      `FIPS endpoint required in production; got ${hostname}. ` +
      `Set AWS_USE_FIPS_ENDPOINT=true or remove the override.`
    )
  }
}
```

#### 3.3.3 Verification step

```bash
# At boot, the a2a-agent emits a line:
# kms endpoint: kms-fips.us-east-1.amazonaws.com (FIPS=true)

vercel logs --since=2m | grep 'kms endpoint:'
```

### 3.4 Key creation parameters

KMS keys themselves do not need special creation flags for FIPS — once
the underlying module is FIPS-validated and the endpoint is the FIPS
endpoint, every key on that module is accessed FIPS-mode. The relevant
key parameters for our use case are still:

- `KeyUsage = SIGN_VERIFY` for signing keys.
- `KeySpec = ECC_SECG_P256K1` for our signing curve (NOTE: secp256k1
  is NOT in NIST SP 800-186 as a recommended curve; FIPS 140-3 does
  validate the MODULE that holds the key, not the curve choice itself.
  See § 6 for caveat.).
- `KeyUsage = ENCRYPT_DECRYPT` + `KeySpec = SYMMETRIC_DEFAULT` for the
  envelope KEK.
- `KeyUsage = GENERATE_VERIFY_MAC` + `KeySpec = HMAC_256` for MAC keys.

All of the above are accessed via the same FIPS endpoint when
`useFipsEndpoint=true`.

### 3.5 Attestation evidence

For the compliance package, we capture:

1. The NIST CMVP certificate URL for the AWS KMS HSM (current
   certificate is at <https://csrc.nist.gov/projects/cryptographic-module-validation-program/certificate-search>
   — search "AWS Key Management Service HSM").
2. AWS's published compliance attestation (
   <https://aws.amazon.com/compliance/fips/>).
3. Our SDK code showing `useFipsEndpoint=true`.
4. Our boot-log evidence showing `kms-fips.<region>.amazonaws.com` is
   the resolved hostname.
5. Our CloudTrail records showing every KMS call traversed the FIPS
   endpoint.

---

## 4. GCP Cloud KMS FIPS posture

### 4.1 Module validation

- **Cloud KMS software keys** (`protectionLevel: SOFTWARE`): the
  underlying cryptographic implementation is FIPS 140-2 validated for
  the BoringCrypto module. Source: Google Cloud security docs.
- **Cloud KMS HSM keys** (`protectionLevel: HSM`): backed by FIPS 140-2
  Level 3 validated HSMs (Marvell LiquidSecurity). Source: GCP Cloud
  HSM documentation at <https://cloud.google.com/kms/docs/hsm>.

GCP's roadmap to FIPS 140-3 follows the broader CMVP timeline; as of
this writing, GCP's HSM validation is still 140-2 (the underlying
hardware is FIPS 140-3 ready and re-certification is in progress).

For our customer segments above, **140-2 Level 3 is acceptable** for
every standard listed except those that specifically pin to 140-3 (a
small subset; check per-customer).

### 4.2 How we enable HSM-backed keys

The `protectionLevel: HSM` parameter is required on EVERY key creation
for FIPS-substantiated operations. Our provisioning runbook
(`docs/operator/gcp-kms-provisioning.md`) currently does NOT specify
`--protection-level=hsm` — it uses the default `SOFTWARE`. **This is a
gap.**

Updated provisioning commands:

```bash
# Master EOA signer (HSM-backed)
gcloud kms keys create master-eoa-signer \
  --keyring=smart-agent \
  --location=us-east1 \
  --purpose=asymmetric-signing \
  --default-algorithm=ec-sign-secp256k1-sha256 \
  --protection-level=hsm

# Session envelope KEK (HSM-backed)
gcloud kms keys create a2a-session-kek \
  --keyring=smart-agent \
  --location=us-east1 \
  --purpose=encryption \
  --rotation-period=90d \
  --next-rotation-time=$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ) \
  --protection-level=hsm

# MAC keys (HSM-backed)
gcloud kms keys create mac-web-to-a2a \
  --keyring=smart-agent \
  --location=us-east1 \
  --purpose=mac \
  --default-algorithm=hmac-sha256 \
  --protection-level=hsm
```

**Action item**: update `docs/operator/gcp-kms-provisioning.md` to
specify `--protection-level=hsm` in every key creation. Track as
follow-up.

### 4.3 Algorithm caveat — secp256k1 on GCP HSM

GCP Cloud HSM supports `EC_SIGN_SECP256K1_SHA256` at the HSM
protection level. Source: GCP CryptoKey algorithm reference at
<https://cloud.google.com/kms/docs/algorithms>. The same caveat as
AWS applies (secp256k1 is not a NIST SP 800-186 curve, see § 6).

### 4.4 Key attestation

GCP Cloud HSM provides per-CryptoKeyVersion ATTESTATION certificates
that prove the key was generated on a FIPS-validated HSM and never
left it. We capture the attestation for every HSM-backed key:

```bash
# Per key version, capture the attestation
gcloud kms keys versions get-public-key \
  --key=master-eoa-signer --keyring=smart-agent --location=us-east1 --version=1 \
  --output-file=tmp/attestation/master-eoa-signer-v1-pubkey.pem

gcloud kms keys versions describe \
  --key=master-eoa-signer --keyring=smart-agent --location=us-east1 1 \
  --format=json > tmp/attestation/master-eoa-signer-v1-meta.json
# The attestation cert is in the .attestation field; extract and verify.
```

The attestation chain is verifiable against Google's published root
certificate (documented at <https://cloud.google.com/kms/docs/attest-key>).
This artefact goes into the compliance package per key version.

### 4.5 Attestation evidence (GCP)

For the compliance package, we capture:

1. The Cloud HSM FIPS 140-2 Level 3 documentation URL.
2. The per-CryptoKeyVersion attestation files (binary + verification
   record).
3. Our IaC code showing `protection_level = "HSM"` on every key
   resource.
4. Our boot-log evidence showing the version path matches an
   HSM-protected version.

---

## 5. Customer-facing attestation package

When a customer asks "are you FIPS-validated?", we hand them:

```
docs/security/compliance/
├── fips-attestation/
│   ├── 2026-Q3-fips-package.pdf       (one-page summary)
│   ├── aws/
│   │   ├── kms-hsm-cmvp-cert.pdf      (NIST CMVP certificate PDF)
│   │   ├── aws-compliance-attestation.pdf
│   │   ├── boot-log-evidence-20260701.txt
│   │   └── cloudtrail-sample-20260701.json
│   └── gcp/
│       ├── cloud-hsm-fips-doc.pdf
│       ├── attestations/              (per-key-version attestation files)
│       │   ├── master-eoa-signer-v1.bin
│       │   ├── master-eoa-signer-v1.verification.txt
│       │   └── ...
│       └── boot-log-evidence-20260701.txt
└── README.md                          (chronological compliance log)
```

The compliance lead (or external auditor) reads `README.md`, follows
the pointers, validates each artefact. Refreshed quarterly.

---

## 6. Caveat — secp256k1 and FIPS

secp256k1 (the curve used for Ethereum / Bitcoin signing) is NOT one of
the curves NIST recommends in SP 800-186 (the NIST curve set is P-256,
P-384, P-521 plus a few others). **This does NOT mean secp256k1 cannot
be used on a FIPS-validated module** — the FIPS validation is for the
MODULE, not the algorithm choice. AWS KMS and GCP Cloud KMS both
expose secp256k1 ON FIPS-validated HSMs.

**What is true**:

- The HSM is FIPS-validated.
- The HSM correctly implements the secp256k1 curve operations.
- The signature is produced on a FIPS-validated module.

**What is NOT true**:

- "secp256k1 is FIPS-approved" — no, the algorithm is not in NIST's
  approved list. The MODULE is FIPS-approved.

For customers who explicitly require FIPS-approved ALGORITHMS (not
just modules), secp256k1 is not acceptable; they'd require
P-256 / P-384. **This is a real customer-conversation gap** — if a
FedRAMP customer pushes back on the algorithm choice, the answer is
"the algorithm choice is dictated by EVM compatibility; the module is
FIPS-validated; you cannot have an EVM signature with a P-256 curve."

Some customers (the strict subset) will not accept this. For those,
the response is "we don't support that today; if your contract
mandates it, we add P-256 hybrid signing as a follow-on" — see
`docs/security/cryptographic-posture/` C3 for the cryptographic-agility
plan that addresses this.

---

## 7. GovCloud considerations

Customers requiring FedRAMP High typically also require deployment in
AWS GovCloud (or equivalent isolation). GovCloud KMS:

- Same FIPS 140-3 Level 3 module.
- ALL endpoints in GovCloud are FIPS-only by default
  (`kms-fips.us-gov-*.amazonaws.com`).
- Requires a separate AWS account (not transferable from commercial).
- Requires Vercel to support GovCloud OIDC (CHECK: Vercel may not
  support this; if not, the runtime cannot deploy on Vercel for
  GovCloud).

Action: **for any FedRAMP-High customer ask, the OIDC federation path
must be re-verified against GovCloud constraints**. This is out of
scope for the current spec; flagged as a known gap.

---

## 8. Action items (operator-actionable)

| # | Action | Owner | Status |
|---|---|---|---|
| **K4-A1** | Update `aws-kms-client-config.ts` to set `useFipsEndpoint: true` when `NODE_ENV='production'` OR `AWS_USE_FIPS_ENDPOINT='true'`. | Developer | NOT STARTED |
| **K4-A2** | Add `assertFipsEndpointInUse` to `apps/a2a-agent/src/lib/policy-startup.ts`; boot fails in prod if endpoint is not FIPS. | Developer | NOT STARTED |
| **K4-A3** | Update `docs/operator/gcp-kms-provisioning.md` to specify `--protection-level=hsm` in EVERY key creation command. | Documentarian + Infra | NOT STARTED |
| **K4-A4** | Add `protection_level = "HSM"` to the Terraform GCP module (Phase H). | Infra | NOT STARTED |
| **K4-A5** | Capture attestation files for every GCP key version at provisioning time; archive to `docs/security/compliance/fips-attestation/gcp/attestations/`. | Operator | NOT STARTED |
| **K4-A6** | Capture AWS KMS HSM CMVP certificate URL + AWS compliance attestation PDF; archive to `docs/security/compliance/fips-attestation/aws/`. | Operator | NOT STARTED |
| **K4-A7** | Document the secp256k1 caveat (§ 6) in customer-facing security FAQ. | Documentarian | NOT STARTED |
| **K4-A8** | Verify the AWS KMS HSM FIPS 140-3 certificate's sunset (2026-11-17); place a calendar item to capture the re-certification certificate when AWS publishes it. | Security | NOT STARTED |
| **K4-A9** | Pre-flight: verify Vercel OIDC federation is supported in GovCloud (or document the lack of support). | Infra | NOT STARTED |
| **K4-A10** | Add a compliance-package generator script: `scripts/generate-fips-attestation-package.sh <quarter>` that bundles the artefacts under `docs/security/compliance/fips-attestation/<quarter>/`. | Documentarian | NOT STARTED |

---

## 9. Honest disclosure

What is and is not true today:

| Claim | True today? |
|---|---|
| "We use AWS KMS HSMs which are FIPS 140-3 Level 3 validated." | Conditionally — only IF we route through `kms-fips.*` endpoints. Today we route through the default endpoints. |
| "We use GCP Cloud HSMs which are FIPS 140-2 Level 3 validated." | NO — today our GCP keys are SOFTWARE-backed (default protection level). |
| "Every signing operation is FIPS-validated." | NO. |
| "We can hand a customer a FIPS attestation package." | Partial — only the upstream vendor documents. None of our system-level evidence is captured. |

After K4-A1 through K4-A10:

| Claim | True after action items? |
|---|---|
| "We route all KMS calls through FIPS endpoints in production." | YES (K4-A1, K4-A2). |
| "All GCP keys are HSM-protected." | YES (K4-A3, K4-A4). |
| "We can hand a customer a FIPS attestation package." | YES (K4-A5, K4-A6, K4-A10). |
| "Our secp256k1 signing algorithm is on a FIPS-validated module." | YES (caveat per § 6). |

The compliance posture goes from "claims we cannot substantiate" to
"claims we substantiate with evidence". The actual cryptography does
not change — the validation chain does.

---

## 10. Recommendation to the board

- **K4-A1 / K4-A2 are 1 day of developer work** — do this immediately.
  No reason to be off the FIPS endpoint when the cost is one config
  line.
- **K4-A3 / K4-A4 require re-provisioning GCP keys** with HSM
  protection. Since we have no prod traffic yet, this is a fresh-start
  re-deploy with the updated runbook; cost is operator time, not
  customer-facing disruption.
- **K4-A5 / K4-A6 are evidence capture**, one-time per provisioning;
  do as part of the next provisioning event.
- **K4-A7 (FAQ) and K4-A10 (package generator) are documentation +
  scripting work**; total cost ≤1 week.

After these land, our FIPS posture is defensible to any of the regulated
customer segments in § 1 except those that specifically reject
secp256k1 as an algorithm (rare; see § 6).

---

## 11. References

- AWS FIPS 140-3 page: <https://aws.amazon.com/compliance/fips/>
- AWS KMS FIPS 140-3 Level 3 announcement (2024) and supporting blog: <https://aws.amazon.com/blogs/security/aws-kms-is-now-fips-140-3-security-level-3/>
- AWS KMS HSM CMVP Active certificate (sunset 2026-11-17): NIST CMVP certificate search at <https://csrc.nist.gov/projects/cryptographic-module-validation-program/certificate-search> (search "AWS Key Management Service HSM")
- AWS KMS FIPS endpoints listing: see "Supported FIPS endpoints" table on the AWS compliance/FIPS page above.
- GCP Cloud HSM documentation: <https://cloud.google.com/kms/docs/hsm>
- GCP key attestation: <https://cloud.google.com/kms/docs/attest-key>
- GCP CryptoKey algorithm reference: <https://cloud.google.com/kms/docs/algorithms>
- GCP protection levels: <https://cloud.google.com/kms/docs/protection-levels>
- FIPS 140-3 (NIST overview): <https://csrc.nist.gov/projects/cryptographic-module-validation-program/standards>
- NIST SP 800-186 (recommended elliptic curves): <https://csrc.nist.gov/publications/detail/sp/800-186/final>

---

*Last updated: 2026-05-18.*
