# RL3 — Tax Reporting (1099 + International)

> **NOT LEGAL ADVICE.** This document scopes the tax compliance question
> for counsel + a tax advisor.

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [US 1099 reporting overview](#2-us-1099-reporting-overview)
3. [Per-recipient analysis](#3-per-recipient-analysis)
4. [TIN collection at onboarding](#4-tin-collection-at-onboarding)
5. [1099 filing operations](#5-1099-filing-operations)
6. [International tax reporting](#6-international-tax-reporting)
7. [Edge cases](#7-edge-cases)
8. [Implementation outline](#8-implementation-outline)
9. [Counsel + vendor engagement](#9-counsel--vendor-engagement)
10. [Cost model](#10-cost-model)
11. [Bibliography](#11-bibliography)

---

## 1. Executive summary

If Smart Agent moves >$600 to a recipient in a calendar year for
services rendered (grants for work, contractor payments), the recipient
likely needs a **Form 1099-NEC** (or **1099-MISC** for other income).
If Smart Agent qualifies as a "third-party settlement organization"
(TPSO) under the IRS framework, **Form 1099-K** reporting applies above
$20,000 AND 200 transactions per recipient (post-OBBBA 2025).

For EU-resident recipients, **DAC8** (Council Directive (EU) 2023/2226)
kicks in January 1, 2026, requiring crypto-asset service providers to
report transactions for EU residents.

Smart Agent has architectural friction with both regimes:

- **Pseudonymous recipients**: AnonCreds + nullifier-keyed rows mean
  the platform may not have the recipient's legal identity or TIN.
- **Recipient is a smart account, not a person**: 1099 needs a legal
  person; an `AgentAccount` is not a person.
- **International recipients**: Form W-8 (for non-US persons) collection
  is required; the platform may not have the recipient's residency.

**Required implementation**:

1. TIN collection at recipient onboarding (for any user expecting >$600
   in grants in a calendar year).
2. Form W-9 for US persons / W-8BEN(-E) for non-US.
3. Per-recipient annual roll-up of payments.
4. Secure delivery of 1099 PDFs.
5. Electronic transmission to IRS (via Track1099, Tax1099, Sovos, or
   similar).
6. State 1099 filing where required.
7. DAC8 collection + reporting for EU recipients.

**Cost**: $30k–$80k implementation + $1–$5 per recipient per year
ongoing.

---

## 2. US 1099 reporting overview

### 2.1 The 1099 family

| Form | Threshold | What it reports | Filing deadline |
|---|---|---|---|
| **1099-NEC** | $600+ in calendar year | Non-employee compensation (services) | Jan 31 to recipient + IRS |
| **1099-MISC** | $600+ (most boxes); $10 (royalties) | Other income (rents, prizes, awards) | Jan 31 to recipient; Feb 28 paper / Mar 31 e-file to IRS |
| **1099-K** | $20,000 AND 200 transactions | Payment card + third-party network | Jan 31 to recipient; Feb 28 / Mar 31 to IRS |
| **1099-INT** | $10+ | Interest income | n/a — no interest paid |
| **1099-B** | varies | Broker proceeds + crypto sales | n/a — we don't broker |
| **1099-DA** | new (2025) | Digital asset transactions by brokers | crypto-broker-specific |

### 2.2 The OBBBA-restored 1099-K threshold

Under the One Big Beautiful Bill Act (OBBBA, July 2025), the 1099-K
threshold was restored to **>$20,000 AND >200 transactions** per payee
per calendar year. This applies to 2025 and 2026 reporting. The earlier
ARPA-2021 $600 threshold is gone.

Source: [IRS Form 1099-K FAQs](https://www.irs.gov/newsroom/form-1099-k-faqs),
[RSM US — OBBBA 1099-K update](https://rsmus.com/insights/services/business-tax/irs-updates-obbba-new-reporting-thresholds.html),
[1800Accountant — 2026 thresholds](https://1800accountant.com/blog/irs-1099-reporting-changes-2026).

### 2.3 Is Smart Agent a TPSO?

A Third-Party Settlement Organization (TPSO) is a "central organization
that has the contractual obligation to make payment to participating
payees of third-party network transactions" (IRC § 6050W).

**Pro-TPSO**:

- Smart Agent's contracts hold pool USDC.
- Smart Agent's server relays the transfer.
- The platform mediates between donor and recipient.

**Anti-TPSO**:

- Smart Agent does not have a contractual obligation to pay the payee —
  the pool steward decides.
- The recipient is paid from a specific pool's AgentAccount, not from a
  Smart Agent operating account.
- Smart Agent doesn't hold custody outside of the smart contracts.

Likely outcome: counsel says we're NOT a TPSO if the architecture
remains non-custodial-at-Smart-Agent-level. But each pool / org IS
making payments and may be a payor for 1099 purposes.

### 2.4 Who is the "payor"?

For 1099 purposes, the payor is the entity that owes the obligation +
makes the payment. In Smart Agent:

- For grant disbursements (§2.5 in RL1): the POOL is the payor. The
  pool is an org (a legal entity, ideally; possibly a sole proprietor
  if just one individual operates it).
- For honor (§2.3): the DONOR is paying the pool; the pool isn't paying
  a third party.
- For inter-org transfers: the SENDER org is the payor.

So Smart Agent itself is not the payor; the pools / orgs are. But Smart
Agent operates the rails AND has the data AND the user relationship.

**Implication**: Smart Agent must either (a) provide 1099 generation as
a service to pools (Smart Agent issues 1099s on behalf of each pool),
or (b) provide pools with the data they need to do their own 1099
filing.

### 2.5 Backup withholding

If a payee fails to furnish a TIN, or the TIN is incorrect, the payor
must withhold 24% of payments (IRC § 3406). For crypto payments, this
is currently impossible to enforce at the substrate level (you can't
"withhold" from a USDC transfer — the chain moves the full amount).

**Implication**: BLOCK disbursement at the application layer if TIN is
missing or invalid. Don't let the chain execute until TIN is collected.

---

## 3. Per-recipient analysis

### 3.1 Grant recipients

A recipient who receives a grant for services (e.g., "$5k for
developing the curriculum") — clearly 1099-NEC territory.

A recipient who receives a grant as a charitable gift (e.g., "$5k to
support your community garden") — closer to a gift, less clearly
reportable. But the IRS position is that organizational grants for
charitable purposes ARE generally reportable as 1099-MISC (Other
Income, Box 3) for the recipient if they exceed $600 and are not from
a 501(c)(3) directly to an individual for a recognized exempt purpose.

Counsel must opine per use-case.

### 3.2 Hub-to-hub transfers

A hub disburses to another hub. The recipient hub is the payee. If the
recipient hub is a legal entity with an EIN, 1099 may still apply to
non-corporate entities; corporations (C-corp or S-corp) are generally
exempt from 1099-NEC.

### 3.3 Personal-treasury "honor" transfers

A donor honors a pledge — moves USDC from their personal treasury to a
pool's treasury. The donor is paying the pool; the pool's tax-exempt
status determines whether the donor can deduct.

- If the pool is a 501(c)(3): the pledge is a charitable contribution
  for the donor (Form 1040 Schedule A) and the pool issues a
  contemporaneous written acknowledgment for $250+ donations (IRC §
  170(f)(8)).
- If the pool is not 501(c)(3): the pledge is a transfer, possibly
  a gift (subject to gift-tax filing if > $19,000 per recipient in 2026).

Smart Agent should issue:

- For 501(c)(3) pools: a donation receipt (PDF) for each pledge honor.
- For non-501(c)(3) pools: NO receipt; advise the donor consult tax
  advisor.

### 3.4 Anonymous / pseudonymous pledges + grants

The pool's `storyPermissions=anonymous` setting means the donor is
unknown to the pool. The pool cannot issue a charitable acknowledgment
without a donor identity.

For tax purposes:

- Anonymous donors forgo their deduction (their choice).
- The pool's records still show the contribution (just not the donor).
- The recipient of a grant from an anonymous pledger needs no special
  treatment — they're paid the same way.

### 3.5 Mark-paid pledges

For Rail B (markPaid), the actual payment occurred off-chain. The
on-chain record is an attestation. Tax treatment follows the underlying
payment:

- If donor wired USD to pool: standard bank reporting.
- If donor paid in crypto via an external chain: that chain's reporting.
- The on-chain attestation does NOT create a new taxable event.

### 3.6 Recipient is a smart account, not a person

The recipient address is an `AgentAccount`, owned by one or more keys.
For 1099 purposes, the IRS needs the LEGAL PERSON's name + TIN, not the
smart-account address.

**Mapping**: at recipient onboarding (when they create the AgentAccount
that will receive grants), collect Form W-9 (or W-8 for non-US) and
store it linked to the AgentAccount address. When the platform
disburses to that address, look up the legal-person mapping for the
1099.

**Where to store**: per-recipient PII goes in `person-mcp` (the user's
own MCP) or `org-mcp` (the org's MCP), NEVER in the web SQL or chain.
The 1099 filing service queries `person-mcp` / `org-mcp` at year-end.

---

## 4. TIN collection at onboarding

### 4.1 Form W-9 (US persons)

US persons (citizens, resident aliens, US LLCs, US corporations) provide:

- Name
- Business name (if applicable)
- Federal tax classification (individual / corporation / partnership /
  LLC / trust / other)
- Address
- Taxpayer Identification Number (TIN) — SSN or EIN
- Backup withholding certification
- Signature + date

**When to collect**: at recipient onboarding (when the user creates an
AgentAccount AND expects to receive payments). For donors who never
receive payments, W-9 is unnecessary.

**Storage**: encrypted at rest in `person-mcp` or `org-mcp`. Never in
chain, never in GraphDB, never in web SQL.

**Retention**: 5 years post-payment per IRS guidance.

### 4.2 Form W-8BEN / W-8BEN-E (non-US persons)

Foreign individuals use W-8BEN; foreign entities use W-8BEN-E. Required
for non-US recipients to claim treaty benefits or to certify foreign
status (avoiding US tax withholding on US-source income).

For US-source income paid to a foreign person, withholding can be up to
30% (IRC § 1441) unless a treaty reduces it.

For crypto payments, the "US source" determination is fact-specific.
Counsel must opine.

### 4.3 Form 8233

For nonresident aliens performing personal services in the US;
withholding-exemption certification. Rarely applicable for digital
work.

### 4.4 Verification of TIN

Two paths:

- **IRS TIN Matching Program** ([IRS link](https://www.irs.gov/tax-professionals/taxpayer-identification-number-tin-matching)):
  bulk TIN-to-name match against IRS records. Requires e-Services
  account.
- **Vendor**: most KYC vendors offer TIN verification as an add-on.
  Persona, Onfido, etc.

### 4.5 Friction discussion

TIN collection is FRICTION. Adding a W-9 form to recipient onboarding
will reduce conversion. Options:

- **Delayed collection**: collect TIN only when the recipient first
  receives a payment (or approaches a $600 threshold). Triggers a
  blocking form before disbursement.
- **Eager collection**: collect at signup. Higher friction at signup,
  zero friction at disbursement.
- **Vendor-mediated**: KYC vendor (Persona / Onfido / Jumio) collects
  TIN as part of identity verification (RL5 Tier 1+).

Recommended: **delayed collection at first-disbursement-approach**.
Block the disbursement until W-9 is provided.

---

## 5. 1099 filing operations

### 5.1 Vendor options

| Vendor | URL | Cost | Coverage |
|---|---|---|---|
| **Track1099** | [https://www.track1099.com/](https://www.track1099.com/) | $2.99–$4.99 per recipient | 1099 family + W-2 |
| **Tax1099** | [https://www.tax1099.com/](https://www.tax1099.com/) | $2.90–$3.50 per recipient | Full 1099 family |
| **Sovos** | [https://sovos.com/](https://sovos.com/) | Enterprise pricing | Comprehensive incl. crypto |
| **Avalara 1099** | [https://www.avalara.com/](https://www.avalara.com/) | $2.99–$3.99 | 1099 + state filing |
| **Tipalti** | [https://www.tipalti.com/](https://www.tipalti.com/) | Enterprise | Payout + 1099 combined |
| **Trolley** | [https://www.trolley.com/](https://www.trolley.com/) | Enterprise | Payout + 1099 + global |
| **Bill.com** | [https://www.bill.com/](https://www.bill.com/) | Tiered | Includes 1099 |

For Smart Agent's scale (mid-volume, crypto-native), Track1099 or
Tax1099 are reasonable Phase 1 choices. As volume grows, Sovos or
Trolley become attractive (they handle international tax forms too).

### 5.2 State 1099 filing

Many states require separate 1099 filing. About half participate in
the Combined Federal/State Filing (CF/SF) Program (IRS forwards
federal filings to participating states), so a single filing covers
both. Non-CF/SF states require direct filing.

States NOT in CF/SF (as of 2026): NY, CT, DC, IL, MA, OR, PA, VA, etc.
Verify with state DOR each year.

Filing vendors above generally handle CF/SF + non-CF/SF state filings.

### 5.3 Annual roll-up architecture

```
Per-recipient (AgentAccount) annual report:
  recipient_id (= AgentAccount address)
  payee_legal_name (from W-9 stored in MCP)
  payee_tin (encrypted in MCP)
  payee_classification (individual / corp / etc.)
  payee_address (from W-9)
  payments[]: list of disbursements in calendar year
    - tx_hash
    - amount_usdc
    - amount_usd_at_payment_time (calculated)
    - timestamp
    - source_pool (= payor's legal-name lookup)
    - source_proposal (for grant attribution)
    - 1099_box (NEC / MISC-3 / MISC-other)
  total_for_year (in USD)
  1099_required (boolean)
  1099_form (computed)
```

This object is built by an annual job that walks the disbursement
events on chain (`DisbursementAssertion` class) + the MCP-stored W-9s,
and produces the input for the 1099 vendor's API.

### 5.4 USD conversion

The IRS requires reporting in USD. Crypto payments must be valued at
fair market value at the time of payment.

For USDC: 1 USDC ≈ 1 USD; minor de-peg events typically <0.2%. Use 1:1
for simplicity unless de-peg exceeds a threshold (e.g., >1%).

For non-stablecoin crypto (BTC, ETH): use the spot price at the block
timestamp from an oracle (e.g., Chainlink, CoinGecko API).

Document the conversion methodology in the recipient's 1099.

### 5.5 Delivery to recipient

1099 PDFs must be delivered to each recipient by January 31. Options:

- **Postal mail**: traditional; satisfies IRS regs.
- **Electronic (with consent)**: recipient must consent to electronic
  delivery (IRS Reg § 31.6051-1(j) and related). Vendor handles consent
  + delivery.

For crypto-native recipients, electronic delivery + portal access is
the norm. Persona / Trolley / etc. handle this.

### 5.6 Recipient access

Recipients should be able to access:

- Their issued 1099(s) for the current year.
- Their historical 1099s.
- A real-time year-to-date earnings tracker.
- Their W-9 on file (and update it).
- Their email / address (for delivery).

This is a UI surface in `apps/web` that fetches data from
`person-mcp` / `org-mcp`.

### 5.7 Corrections (1099-C)

If a 1099 is issued incorrectly, file a corrected 1099. Vendors handle
this.

---

## 6. International tax reporting

### 6.1 EU — DAC8 (Council Directive (EU) 2023/2226)

**DAC8** = Directive on Administrative Cooperation 8. Brings crypto-
asset transactions under EU tax-reporting transparency.

- **Effective**: January 1, 2026.
- **First reporting period**: calendar year 2026.
- **First reports due**: by January 31, 2027.
- **Member states to transpose**: by December 31, 2025.
- **In scope**: any Reporting Crypto-Asset Service Provider (RCASP) —
  defined broadly to include any platform facilitating crypto-asset
  exchange or transfer for EU residents.
- **Reportable transactions**: exchange, transfer, retail payments in
  crypto, NFT transactions (above thresholds).
- **What to report per user per year**: aggregate transaction count,
  aggregate value, fair-market-value in EUR, counterparty information,
  KYC data.

**Smart Agent's exposure**: if Smart Agent has any EU resident users
+ moves crypto for them, Smart Agent is plausibly an RCASP under DAC8.
The DAC8 obligation kicks in independently of MiCA CASP licensing.

**Implementation requirements**:

- Collect Tax Identification Number (or equivalent) from EU residents.
- Track all crypto-asset transactions per user.
- Annual report to the user's resident-state tax authority by January
  31 of the following year.
- 6-month grace period (until July 1, 2026) for full compliance, but
  data collection from January 1, 2026.

**Vendor support**: Sovos, Trolley, Regnology offer DAC8 reporting.

Source: [EU DAC8 portal](https://taxation-customs.ec.europa.eu/taxation/tax-transparency-cooperation/administrative-co-operation-and-mutual-assistance/directive-administrative-cooperation-dac/dac8_en),
[Deloitte Malta tax alert](https://www.deloitte.com/mt/en/services/tax/perspectives/tax-alerts/Gearing-up-for-crypto-asset-tax-reporting-requirements-in-2026--.html),
[Regnology CARF/DAC8](https://www.regnology.net/en/resources/regulatory-topics/crypto-asset-reporting-framework-carfdac8/).

### 6.2 OECD — CARF (Crypto-Asset Reporting Framework)

The OECD's **CARF** is the global standard underlying DAC8. It's been
adopted by 50+ jurisdictions (UK, Australia, Canada, Japan, Singapore,
etc.) with rolling effective dates.

- **UK CARF**: effective January 1, 2026.
- **Australia CARF**: effective January 1, 2026.
- **Canada CARF**: effective January 1, 2027.
- **Japan CARF**: effective January 1, 2027.
- **Singapore CARF**: effective January 1, 2027.

Implementation similar to DAC8. Vendors above handle CARF too.

### 6.3 UK — HMRC self-assessment + CARF

UK individuals report crypto on the SA108 (Capital Gains) form annually.
Smart Agent provides transaction history; the recipient files
themselves. Under CARF (from 2026), Smart Agent (as a UK-touching CASP)
must report transactions to HMRC.

### 6.4 Other jurisdictions

| Jurisdiction | Regime | Effective |
|---|---|---|
| Canada | CARF + CRA | 2027 |
| Australia | CARF + ATO | 2026 |
| Japan | CARF + NTA | 2027 |
| Singapore | CARF + IRAS | 2027 |
| Switzerland | AEoI + FTA | 2027 |
| Brazil | RFB + crypto reporting | 2024 (in effect) |
| Mexico | SAT + crypto | 2026 |
| Korea | NTS | 2025 |
| UAE | FTA (Federal Tax Authority) | 2026 |
| Israel | ITA | 2026 |

Each has slight variations; Sovos / Regnology track these centrally.

### 6.5 Implication

If Smart Agent serves multi-jurisdictional users, vendor selection
matters more than ever. Track1099 is US-only; Sovos / Regnology /
Trolley are global. The vendor cost difference: $5–$15k vs. $50k–$200k
annually. Worth it for global compliance.

---

## 7. Edge cases

### 7.1 Pseudonymous recipients (no TIN)

A recipient receives a grant via an AnonCreds-mediated path. The
platform has the recipient's AgentAccount address but NOT their legal
identity.

Options:

- **Block payment**: refuse to disburse without W-9 on file.
- **Smaller-amount allowance**: allow payments under $600 in a year
  without W-9 (since 1099-NEC threshold is $600).
- **Anonymized payout product**: explicitly anonymous; recipient bears
  their own tax-reporting burden; receipt is an air-gapped transaction.

The platform cannot magically know the recipient's TIN. The user must
provide it. Block disbursement is the only safe answer.

### 7.2 Failed-KYC recipients

A user who failed KYC (e.g., couldn't pass identity verification or
who's on a sanctions list) shouldn't receive funds at all (RL4/RL5).
Tax reporting moot.

### 7.3 Recipients in non-tax-treaty countries

A recipient in a country with no tax treaty with the US is still
subject to US withholding (default 30% on US-source income to non-US
persons). For crypto, the source determination is fact-specific.

Counsel must opine. Practical implementation: use Sovos / Trolley which
handle this.

### 7.4 Sanctioned-jurisdiction recipients

Cannot disburse — OFAC violation. See RL4.

### 7.5 Recipients receiving in-kind (non-USDC) value

If we ever extend beyond USDC, FMV at receipt is the reportable value.
USD-conversion methodology must be documented.

### 7.6 Reverse payments

A recipient refunds a payment (e.g., a grant overpayment). This creates
a negative entry in the annual roll-up. Vendors handle.

### 7.7 State residence different from federal address

A taxpayer's federal address may differ from their state-tax residence.
The 1099 should reflect the federal address from W-9; state-tax
considerations are between the recipient and their state DOR.

### 7.8 Pool steward as payor

If Smart Agent issues 1099 ON BEHALF of the pool, the pool steward
appears as payor name + TIN. The steward must have an EIN. If the pool
is operated by an individual without an EIN, that individual's SSN +
name appear as payor.

This is friction for casual pool creation. Mitigation: Smart Agent
issues 1099 as the platform-of-record, with a pool-identifier in box
14 ("State Tax Withheld" repurposed) — counsel must approve.

OR: build a 501(c)(3) wrapper (RL1 § 8.6) which becomes the unified
payor.

### 7.9 Annual income < $600 to recipient

No 1099 required. But the recipient still owes income tax. The platform
can offer a "view your 2026 earnings (USD-equivalent)" report
voluntarily.

### 7.10 Recipients who are non-individuals (LLC, corp, charity)

C-corps and S-corps are generally EXEMPT from 1099-NEC. LLCs depend on
their tax classification (which is on the W-9).

501(c)(3) charities receiving grants from another 501(c)(3) — typically
no 1099 needed (grant to charity, not income from services). Counsel
must opine.

---

## 8. Implementation outline

### 8.1 Architecture sketch

```
apps/
  web/
    src/
      app/
        recipient-onboarding/
          page.tsx               // W-9 / W-8 form
        my-1099/
          page.tsx               // recipient-facing 1099 portal
        admin/
          1099-batch/
            page.tsx             // annual roll-up trigger + status
      lib/
        tax/
          w9-form.ts             // W-9 schema + validation
          w8ben-form.ts          // W-8BEN schema
          w8bene-form.ts         // W-8BEN-E schema
          tin-verify.ts          // IRS TIN-matching + vendor TIN-verify
          fmv-usd.ts             // USDC→USD conversion (oracle)
          annual-rollup.ts       // walks disbursement events → per-recipient totals
          form-1099-issue.ts     // calls 1099 vendor API
          dac8-export.ts         // DAC8 (EU resident) reporting
          carf-export.ts         // CARF (other jurisdictions)
          retention.ts           // 5-year retention policy + secure deletion
  person-mcp/
    src/
      tools/
        tax_forms_store.ts       // store W-9 / W-8 (encrypted)
        tax_forms_read.ts        // retrieve for issuance (gated)
  org-mcp/
    src/
      tools/
        org_tax_id.ts            // EIN / org-level tax info
```

### 8.2 Data model (in person-mcp)

```typescript
interface TaxForm {
  id: string;
  agentAccount: string;        // recipient AgentAccount
  formType: 'W-9' | 'W-8BEN' | 'W-8BEN-E';
  legalName: string;
  businessName?: string;
  classification: 'individual' | 'sole-prop' | 'corp-c' | 'corp-s'
                  | 'partnership' | 'llc-individual' | 'llc-c'
                  | 'llc-s' | 'llc-partnership' | 'trust' | 'other';
  tinHash: string;            // PII-friendly hash for index
  tinEncrypted: string;       // KMS-encrypted; never plaintext at rest
  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  countryOfTaxResidence: string;
  treatyClaim?: string;       // W-8BEN treaty article
  submittedAt: string;
  verifiedAt?: string;
  retentionExpiresAt: string; // 5 years post-last-payment
}
```

### 8.3 Annual job pseudocode

```typescript
async function annual1099Job(year: number) {
  const lookbackStart = new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000;
  const lookbackEnd = new Date(`${year+1}-01-01T00:00:00Z`).getTime() / 1000;

  // 1. Walk on-chain disbursements
  const disbursements = await onchain.queryDisbursements({
    timestampStart: lookbackStart,
    timestampEnd: lookbackEnd,
  });

  // 2. Group by recipient address
  const byRecipient = groupBy(disbursements, d => d.recipientAddr);

  // 3. For each recipient, fetch their tax form
  for (const [addr, txs] of byRecipient) {
    const form = await personMcp.getTaxForm(addr);
    if (!form) {
      log.warn(`No W-9/W-8 for ${addr} with ${txs.length} payments`);
      continue;
    }

    const usdTotal = txs.reduce((sum, tx) =>
      sum + fmvUsd(tx.amount, tx.token, tx.timestamp), 0);

    if (usdTotal < 600) continue;  // no 1099 required

    // 4. Determine form type
    const formType = decideForm1099Variant(form, txs);

    // 5. Send to vendor
    await track1099.issue({
      payor: lookupPayor(txs[0].sourcePool),
      payee: form,
      amount: usdTotal,
      box: formType === '1099-NEC' ? 1 : 3,
      year,
    });
  }

  // 6. Mirror DAC8 reporting for EU residents
  for (const [addr, txs] of byRecipient) {
    const form = await personMcp.getTaxForm(addr);
    if (!form || !isEuMember(form.countryOfTaxResidence)) continue;
    await dac8Export.report(form, txs);
  }
}
```

### 8.4 Block-disbursement gate

```typescript
async function disburseGrant(proposalId: string, recipientAddr: string,
                              amount: bigint, token: string) {
  // 1. Sanctions screening (RL4)
  await assertNotSanctioned(recipientAddr);

  // 2. Cumulative-year-to-date check
  const ytd = await getYearToDate(recipientAddr, new Date().getFullYear());
  const usdAmount = fmvUsd(amount, token, Date.now()/1000);
  const projectedYtd = ytd + usdAmount;

  // 3. Block if approaching $600 without W-9
  if (projectedYtd >= 600) {
    const form = await personMcp.getTaxForm(recipientAddr);
    if (!form) {
      throw new RequiresTaxFormError({
        recipientAddr,
        message: "Recipient must provide W-9 / W-8 before this disbursement (approaching $600/yr threshold).",
      });
    }
  }

  // 4. Proceed with on-chain disbursement
  await onchain.executeDisburse(...);
}
```

### 8.5 Vendor integration

Most 1099 vendors offer REST APIs. Sketch:

```typescript
// Track1099 API
const client = new Track1099Client({ apiKey: env.TRACK1099_KEY });
await client.payer.upsert({ ein, name, address });
await client.payee.upsert({ tin, name, address });
await client.form.create({
  formType: '1099-NEC',
  payerId, payeeId,
  amount: usdTotal,
  taxYear: year,
});
await client.form.submit({ formId });
```

### 8.6 Audit log

Every 1099 issuance, every TIN lookup, every form download is logged
in append-only audit (post-Spec-007 Phase H+ infrastructure).

Required fields:

- Actor
- Action (TIN_VIEW, 1099_ISSUE, 1099_DOWNLOAD, ...)
- Subject (recipient address / form ID)
- Timestamp
- Result (success / failure / reason)

Retention: 7 years.

---

## 9. Counsel + vendor engagement

### 9.1 Tax counsel

- **Cooley LLP** Tax Practice
- **Davis Polk** Tax Practice
- **Skadden** Tax Practice
- **Latham & Watkins** Tax
- **Andersen Tax** (specialist, mid-market)
- **RSM US** (CPA + advisory)
- **Crowe** (CPA + advisory)
- **PwC** Digital Assets Tax
- **EY** Digital Assets Tax

Engagement scope:

```
Smart Agent — Tax Reporting Scoping Memo

Background:
  Smart Agent moves USDC between user-controlled smart accounts for
  charitable / civic grant disbursement. Recipients may be in any
  jurisdiction. Pools (payors) range from informal community groups to
  registered 501(c)(3)s.

Requested deliverables:
  (a) Confirmation of payor identity per disbursement scenario.
  (b) Confirmation that Smart Agent is NOT a TPSO (or, if disputed,
      the path to non-TPSO posture).
  (c) Per-form determinations: when 1099-NEC vs. 1099-MISC vs. 1099-K.
  (d) International-recipient withholding (W-8) implementation
      guidance.
  (e) DAC8 + CARF readiness checklist.
  (f) State 1099 filing requirements summary.
  (g) Audit-trail + retention requirements.

Engagement model: $10k–$25k fixed fee initial scoping; ongoing
retainer at $5k–$15k/mo.
```

### 9.2 1099 vendors

Recommended Phase 1 selection: **Track1099** ([https://www.track1099.com/](https://www.track1099.com/))
for US-only; **Sovos** ([https://sovos.com/](https://sovos.com/)) for
US + international.

### 9.3 TIN verification

- IRS TIN Matching Program (free, requires e-Services):
  [link](https://www.irs.gov/tax-professionals/taxpayer-identification-number-tin-matching)
- Persona TIN verification add-on:
  [https://withpersona.com/](https://withpersona.com/)

---

## 10. Cost model

### 10.1 Initial build

| Item | Cost |
|---|---|
| Tax counsel scoping memo | $10k–$25k |
| Engineering: TIN collection forms + storage | $30k–$50k |
| Engineering: annual roll-up + vendor integration | $40k–$60k |
| Engineering: recipient 1099 portal | $20k–$40k |
| Engineering: DAC8 / CARF export | $30k–$60k |
| Engineering: audit log + retention | $15k–$30k |
| **Total build** | **$145k–$265k** |

### 10.2 Ongoing

| Item | Annual cost |
|---|---|
| Vendor base fee (Track1099 / Sovos) | $0–$5k base |
| Per-recipient fee ($1–$5 × N recipients) | varies by scale |
| Tax counsel retainer | $30k–$120k |
| IRS TIN matching subscription | $0 (free) |
| State filing fees | $0–$2k (most CF/SF) |
| DAC8 / CARF reporting service | $20k–$80k |
| Audit + reconciliation | $10k–$50k |
| **Ongoing floor** | **~$60k–$260k/yr** |

### 10.3 Scaling

At 1,000 recipients/year: ~$5k–$10k in per-recipient fees.

At 10,000 recipients/year: ~$30k–$80k.

At 100,000: enterprise pricing kicks in; budget $150k–$400k.

---

## 11. Bibliography

### Statutes & regulations

- **IRC § 6041** — information reporting (1099-MISC trigger)
- **IRC § 6041A** — services payment information reporting (1099-NEC)
- **IRC § 6050W** — third-party network transactions (1099-K)
- **IRC § 6109** — TIN identification
- **IRC § 1441** — withholding on non-US persons
- **IRC § 3406** — backup withholding
- **IRC § 170(f)(8)** — charitable contribution acknowledgment
- **Council Directive (EU) 2023/2226** — DAC8
- **OECD Crypto-Asset Reporting Framework (CARF)** —
  [link](https://www.oecd.org/tax/exchange-of-tax-information/crypto-asset-reporting-framework.htm)

### IRS guidance

- **Form 1099-K FAQ**: [link](https://www.irs.gov/newsroom/form-1099-k-faqs)
- **Understanding Form 1099-K**: [link](https://www.irs.gov/businesses/understanding-your-form-1099-k)
- **About Form 1099-K**: [link](https://www.irs.gov/forms-pubs/about-form-1099-k)
- **About Form 1099-NEC**: [link](https://www.irs.gov/forms-pubs/about-form-1099-nec)
- **About Form 1099-MISC**: [link](https://www.irs.gov/forms-pubs/about-form-1099-misc)
- **TIN Matching Program**: [link](https://www.irs.gov/tax-professionals/taxpayer-identification-number-tin-matching)
- **About Form W-9**: [link](https://www.irs.gov/forms-pubs/about-form-w-9)
- **About Form W-8BEN**: [link](https://www.irs.gov/forms-pubs/about-form-w-8-ben)
- **Treasury proposed regs on OBBBA backup-withholding thresholds**: [link](https://www.irs.gov/newsroom/treasury-irs-issue-proposed-regulations-reflecting-changes-from-the-one-big-beautiful-bill-to-the-threshold-for-backup-withholding-on-certain-payments-made-through-third-parties)

### EU + international

- **EU DAC8 portal**: [link](https://taxation-customs.ec.europa.eu/taxation/tax-transparency-cooperation/administrative-co-operation-and-mutual-assistance/directive-administrative-cooperation-dac/dac8_en)
- **Yahoo Finance — DAC8 effective January 2026**: [link](https://finance.yahoo.com/news/eu-stricter-crypto-tax-reporting-164435216.html)
- **Deloitte Malta — Tax Alert on crypto-asset reporting 2026**: [link](https://www.deloitte.com/mt/en/services/tax/perspectives/tax-alerts/Gearing-up-for-crypto-asset-tax-reporting-requirements-in-2026--.html)
- **EY — EU DAC8 directive**: [link](https://www.ey.com/en_gl/technical/tax-alerts/eu-adopts-directive-introducing-tax-transparency-rules-for-crypt)
- **Regnology CARF/DAC8**: [link](https://www.regnology.net/en/resources/regulatory-topics/crypto-asset-reporting-framework-carfdac8/)

### Practitioner analyses

- **RSM US — IRS Updates OBBBA 1099-K**:
  [link](https://rsmus.com/insights/services/business-tax/irs-updates-obbba-new-reporting-thresholds.html)
- **Anchin — OBBBA 1099 thresholds**:
  [link](https://www.anchin.com/articles/preparing-for-1099-filing-season-what-the-obbba-means-for-1099-k-and-other-reporting-thresholds/)
- **Littler — Tax Bill 1099 changes**:
  [link](https://www.littler.com/news-analysis/asap/tax-bill-changes-1099-reporting-thresholds)

### Vendors

- **Track1099**: [link](https://www.track1099.com/)
- **Tax1099**: [link](https://www.tax1099.com/)
- **Sovos**: [link](https://sovos.com/)
- **Avalara 1099**: [link](https://www.avalara.com/)
- **Tipalti**: [link](https://www.tipalti.com/)
- **Trolley**: [link](https://www.trolley.com/)

### Related internal documents

- [`README.md`](./README.md)
- [`RL1-money-transmitter-license-analysis.md`](./RL1-money-transmitter-license-analysis.md)
- [`RL5-kyc-aml-high-risk-flows.md`](./RL5-kyc-aml-high-risk-flows.md) — KYC overlap
- `specs/005-pledge-honor/plan.md`
- `specs/006-award-fulfillment/plan.md` — disbursement flow
- `apps/web/src/lib/onchain/disbursementAssertion.ts`
