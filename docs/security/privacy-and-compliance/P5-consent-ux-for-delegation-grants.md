# P5 — Consent UX for Delegation Grants

> **Document status: DRAFT.**
> **Last updated: 2026-05-18.**
> **Counterpart UX spec — `/home/barb/.cursor/plans/funding-ux-audit_51ac035e.plan.md` (the full-site UX audit, currently queued per project_ux_audit_queued.md). This document defines the privacy / consent requirements that any UX design MUST satisfy.**

## 0. Executive summary

A **delegation** in Smart Agent is the ERC-7710-style scoped authorization a user grants — to a session key, an agent, an org, a coach. Each delegation has consequences (financial, data-disclosure, governance) that the user must consent to with **specific, informed, freely given, unambiguous** consent (GDPR Art 4(11), Art 7).

The custodial wallet model amplifies the stakes: when person-MCP holds the user's link secret and signing key, every delegation we mint is something we mint on the user's behalf. The user must understand what they're authorizing.

This document specifies:
1. **What must be shown** before any delegation is signed.
2. **What information must be persistently visible** after the delegation is active.
3. **What revocation surface** must exist.
4. **What high-risk-action gating** is required.
5. **What consent record we maintain** for compliance evidence.

## 1. The consent test (GDPR Article 4(11))

> 'consent' of the data subject means any freely given, specific, informed and unambiguous indication of the data subject's wishes by which he or she, by a statement or by a clear affirmative action, signifies agreement to the processing of personal data relating to him or her.

Four prongs. Each must be passed by our UX:

| Prong | What it means | UX implication |
|---|---|---|
| **Freely given** | No coercion, no take-it-or-leave-it bundling | Granular per-scope consent; ability to refuse without losing core service |
| **Specific** | Each processing purpose is separately consented to | Per-scope toggles; no global "I agree" mega-checkbox |
| **Informed** | Plain language describing what is being authorized | Pre-signature disclosure with scope, target, time, value bounds |
| **Unambiguous** | Affirmative action; no pre-ticked boxes | "Sign delegation" button is the affirmative action; never auto-signed |

EDPB Guidelines 05/2020 on consent (version 1.1, 2020-05-04) elaborates. Our consent UX must align.

## 2. The delegation taxonomy (what we consent to)

Cross-reference: `packages/sdk/src/`, `apps/web/src/lib/actions/`, the unified delegation flow.

| Delegation type | Subject | Purpose | Risk |
|---|---|---|---|
| **Session key** | User → A2A session signer | Sign user-operations during the session | Low if scoped + time-bound; high if scope-anything + long-lived |
| **Coaching grant** | Coach → Disciple read access | Allow disciple to read coaching notes via cross-delegation | Medium (private data disclosure) |
| **Pool stewardship** | User → Pool steward agent | Authorize the steward to administer a pool the user funds | High (financial control) |
| **Pledge** | User → Pool / Fund | Commit USDC | High (financial) |
| **Grant proposal vote** | User → Round | Cast a vote | Medium (governance) |
| **Match initiation** | User → Counterparty | Initiate a direct intent match | Medium (commitment) |
| **Org membership / role** | Org → User | Assign role; user accepts | Medium |
| **Outcome attestation** | Validator → Project | Attest delivery | Medium |
| **MCP data-share** | User → Other user/org | Grant scoped read of person-MCP data | High (depending on scope) |

## 3. Pre-signature disclosure — the required components

Every "Authorize" UI MUST present these eight components before allowing the user to sign. The order is the cognitive walk-through order; components can be visually combined but must all be present.

### 3.1 Plain-language summary

A 1-2 sentence statement of what is being authorized, in user-facing language. Examples:

- "Authorize Tomorrow's Hope (an organization) to receive your pledge of $30,000 USDC."
- "Authorize the Discovery Lane app to act on your behalf for the next 24 hours."
- "Allow Pastor James (your coach) to read your coaching notes."

The summary MUST avoid jargon (no "ERC-7710", no "caveat enforcer", no "delegationHash"). The technical detail goes in component 3.6.

### 3.2 Scope visible

The specific actions authorized. Each action listed individually:

- "Sign smart-account transactions"
- "Read your profile (name, email)"
- "Read your oikos contacts"
- "Increment your live-acknowledgement count on intents"

If an `AllowedMethodsEnforcer` is in play, list each method by friendly name (mapped from the function selector).

### 3.3 Target visible

The principal receiving the authority, displayed with:
- Agent name (e.g., `pastorjames.agent`)
- Smart account address (truncated `0xAB60...3f8d` with hover for full)
- Type (Person, Org, Pool, Session-signer)
- Verification badge (have they been verified? Issued credentials? Established trust?)

### 3.4 Time bounds visible

Plain language:
- "Active from now until <date>"
- "Active until you revoke it" (for open-ended delegations — disallowed for high-risk; see § 5)
- "Valid for 24 hours"

Implementation: extract from the `TimestampEnforcer` caveat; display in the user's timezone.

### 3.5 Value bounds visible (where applicable)

For delegations carrying a value enforcer:
- "Maximum value per transaction: $X"
- "Maximum total value: $Y"

Implementation: extract from the `ValueEnforcer` caveat; convert from wei to display unit; convert from token-base-units to user-readable amounts (USDC has 6 decimals, ETH has 18).

### 3.6 Technical detail (collapsed by default, expandable)

For users who want it: full caveat list, contract addresses, raw EIP-712 payload, expected gas cost. Hidden behind an "Advanced" toggle to avoid intimidating non-technical users.

### 3.7 Revocation mechanism

Plain language:
- "You can revoke this delegation at any time from Settings → Delegations."
- "This delegation will revoke automatically when it expires."

### 3.8 On-chain vs off-chain disclosure (CRITICAL)

The user must know whether their action creates a permanent on-chain record. We distinguish:

**Variant A — off-chain delegation** (signed but stored locally / forwarded as a bearer credential):
> ⓘ This authorization is **stored privately** by Smart Agent and not published to the blockchain. You can revoke it at any time.

**Variant B — on-chain delegation** (recorded in `DelegationManager`):
> ⚠️ **This action creates a permanent record on the blockchain.** Anyone can see that you authorized this. Revocation creates a second permanent record. The original authorization remains in the history.

This is the single most under-disclosed risk in delegation-based products. Customers and users frequently misunderstand the durability of on-chain delegations. Our UX MUST surface this distinction.

## 4. Persistent visibility (post-signature)

A user MUST be able to find every active delegation they have issued, at any time, with no friction.

**Required surface**: `apps/web/src/app/settings/delegations/page.tsx` (build target if not present) — single-page list:

| Column | Content |
|---|---|
| Description | Plain-language summary (§ 3.1) |
| Target | Name + address (§ 3.3) |
| Scope | Bullet list of authorized actions |
| Time | Active-until (§ 3.4) |
| Value-spent | Running total against the value-cap |
| Status | Active / expired / revoked |
| Action | "Revoke" button (single-click + confirm) |

The list MUST include **both** off-chain (variant A) and on-chain (variant B) delegations. The list MUST sort by most-recently-active first.

## 5. High-risk action confirmation

Some delegations cross a threshold of risk that mandates a stricter affirmative action. Thresholds:

| Trigger | Required additional confirmation |
|---|---|
| Single-transaction value > $1,000 USDC | Plain-text confirmation: "I authorize transferring $X" + type-to-confirm "CONFIRM" |
| Total committed value > $10,000 USDC over delegation lifetime | Same + 24-hour cool-off before any redemption |
| Delegation duration > 30 days | Explicit "I understand this is long-lived" toggle |
| Delegation with no value cap AND no time bound | Disallowed in v1; the form refuses to render this combination |
| First-time delegation to a target with no prior trust relationship | Verification step: confirm target address out-of-band |
| Special-category processing (Art 9) | Per P12: explicit opt-in with category-specific disclosure |

**Type-to-confirm pattern**:

```
[ "This will move $30,000 USDC to Tomorrow's Hope (vetted.agent).
   Type CONFIRM to proceed."        ]
[ Input: ____________________________ ]
[ Authorize button — disabled until input = "CONFIRM" ]
```

This adds friction proportional to risk. The pattern is well-established for irreversible operations (GitHub repo deletion, AWS account deletion, Stripe production-key rotation).

## 6. AnonCreds-specific consent

When a delegation triggers an AnonCreds presentation, additional disclosure is required.

### 6.1 Pre-presentation disclosure

> You are about to present a credential to **{verifier}**. They will see:
>
> - **{attr_1}**: <value>
> - **{attr_2}**: <predicate result, e.g., "your age is over 18">
>
> They will NOT see:
> - **{redacted_attrs}**: hidden by selective disclosure
> - Your other credentials
> - Other presentations you've made

### 6.2 Custodial-model erosion notice

The first time a user presents a credential — and prominently in the privacy notice — we disclose:

> ⓘ **About credential unlinkability**
>
> AnonCreds is designed so that two presentations of the same credential to two different verifiers are cryptographically unlinkable to the verifiers.
>
> However, in Smart Agent's v1 custodial model, **we** (the platform) **do** see all your presentations and could correlate them internally. We log every presentation for audit (see "Activity Log"). We do not sell, share, or use this data for advertising.
>
> A future "self-custody" mode will hold credentials on your device, restoring full unlinkability. It is on our roadmap.

## 7. Consent record (compliance evidence)

For every consent event, we record:

| Field | Source |
|---|---|
| `consent_id` | UUID generated at signature |
| `principal` | Session principal |
| `purpose` | Delegation kind from the taxonomy (§ 2) |
| `scope_json` | Authorized actions |
| `target_principal` | Delegatee |
| `time_bounds` | validAfter / validUntil from caveats |
| `value_bounds` | maxValue from value enforcer |
| `variant` | "off-chain" or "on-chain" |
| `disclosure_version` | Version of the disclosure UI shown |
| `consent_method` | "single-click" / "type-to-confirm" / "twoFA-step" |
| `signature` | The EIP-712 signature (proof of affirmative action) |
| `on_chain_tx` | Tx hash if variant B |
| `created_at` | Timestamp |
| `revoked_at`, `revocation_method`, `revocation_tx` | At revocation |

**Storage**: dedicated `consent_records` table in person-MCP, mirrored to org-MCP for org-issued delegations. Retention class R2 (1 year for routine; R3 for financial; § P4).

**Retrieval**: a user filing a DSAR (P6) receives their full consent record as part of the export.

## 8. Withdrawal — Art 7(3) parity

GDPR Art 7(3): "It shall be as easy to withdraw as to give consent."

Implementation:
- Revoke is **one click** from the `/settings/delegations` page, plus a single confirmation.
- No friction added beyond what was added at consent time (high-risk actions had type-to-confirm at consent; they have type-to-confirm at revoke too — symmetric).
- Revocation does not require justification.
- Revocation is acknowledged immediately in the UI; for on-chain delegations, the chain confirmation typically follows within 1 block (1-15 seconds depending on network).

## 9. Variant-A vs Variant-B handling (deep dive)

The on-chain / off-chain distinction is the most consequential disclosure in the entire consent surface. Why:

### 9.1 Variant A (off-chain, held privately)

- Recorded in person-MCP / org-MCP `cross_delegation_grants` or `received_delegations`.
- Revocable by deleting the row.
- No public footprint.
- Suitable for: coaching grants, intra-org member-to-member data sharing, short-lived session keys.

**Disclosure language** (§ 3.8 Variant A) is sufficient; user expects normal account-level privacy.

### 9.2 Variant B (on-chain, recorded in `DelegationManager`)

- Recorded as a state mutation + event on chain.
- Revocable only by another on-chain transaction (`revokeDelegation`).
- Public footprint: anyone can see the delegator address, delegatee address, scope hash, expiry.
- Suitable for: pool stewardship (publicly auditable), governance proposals, anything requiring third-party verifiability.

**Disclosure language** (§ 3.8 Variant B) emphasizes permanence. We display a small ⛓ icon throughout the UI for variant-B records.

### 9.3 Mixed flows

Some operations create both a variant-A record (in the MCP for application state) AND a variant-B record (on chain for verifiability). The consent UX must reflect both:

> This action creates two records:
> - A **private** record in your account ([what it contains])
> - A **public** record on the blockchain ([what it contains])
> Both records persist after the delegation expires; only the private one can be fully deleted on request.

## 10. Per-flow consent specifications

### 10.1 Pledge flow (spec 002 / 005)

Trigger: user clicks "Pledge" on a pool page.

Disclosure sequence:
1. Plain summary (§ 3.1)
2. Pool details (name, mandate, steward agent)
3. Amount selector with running total
4. Settlement-rail selection (Rail A: cryptographic transfer; Rail B: attested transfer with evidence) — explain consequences of each
5. Time bound (when does the pledge expire if not allocated?)
6. § 3.8 disclosure (this writes on chain to PledgeRegistry)
7. § 5 high-risk gate if amount > $1,000
8. Confirm + sign

### 10.2 Match-initiation flow (spec 001)

Trigger: user clicks "Initiate match" on an intent.

Disclosure sequence:
1. Plain summary (§ 3.1) — "You are initiating a direct match with {counterparty}..."
2. Counterparty details
3. Intent reference (what's being matched)
4. § 3.8 disclosure (variant B — writes to MatchInitiationRegistry)
5. Confirm + sign

### 10.3 Grant-proposal submission flow (spec 003)

Trigger: user submits a proposal to a round.

Disclosure sequence:
1. Plain summary (§ 3.1) — "Submit your proposal to the {round} for review..."
2. **PROMINENT**: "Your proposal body remains private. Only the round's stewards (and reviewers you grant access to) can read it. Your IDENTITY as a proposer becomes public on chain when you submit." (per SHACL `sa:GrantProposalAlwaysPrivateShape`)
3. Steward list (who will be able to read)
4. § 3.8 disclosure (variant B — writes to GrantProposalRegistry; body stays in MCP)
5. Confirm + sign

### 10.4 Coaching grant (cross-delegation)

Trigger: user invites a coach to read their notes.

Disclosure sequence:
1. Plain summary (§ 3.1) — "Allow {coach} to read your coaching notes..."
2. Scope list (which categories of notes)
3. Time bound
4. Revoke instructions
5. § 3.8 disclosure — **Variant A** (kept private; can be fully deleted on revoke)
6. Confirm + sign

### 10.5 Session key bootstrap

Trigger: user logs in; a session signer needs delegation.

Disclosure sequence (for first-time session per device):
1. Plain summary — "Authorize this device to act on your behalf for the next 24 hours..."
2. Scope — typically constrained to specific tool families
3. Device name (if available from User-Agent)
4. Time bound — 24h default
5. Confirm + sign

For repeat sessions, we silently mint a new delegation **provided** the scope is unchanged and no high-risk action is implied. Any scope upgrade triggers fresh consent.

## 11. Recording every consent event

The compliance evidence we collect (§ 7) is the legal-defense backbone. Implementation requirements:

- **Tamper-evident**: consent records are inserted into a hash-chained audit log (`apps/a2a-agent/src/db/audit_log` — extension target).
- **Versioned disclosure UI**: the `disclosure_version` field references a snapshot of the disclosure UI HTML/Markdown at the time of consent. Storage: `docs/security/privacy-and-compliance/disclosure-versions/v{N}.md` — committed snapshots.
- **Reproducibility**: given a `consent_id`, we can reproduce the exact UI the user saw.

## 12. Dark patterns to avoid (anti-pattern catalog)

Per EDPB Guidelines 03/2022 on dark patterns in social-media platform interfaces (revised 2023-02-14), the following patterns are non-compliant. We avoid all of them:

| Anti-pattern | Why it's bad | What we do instead |
|---|---|---|
| Pre-ticked consent | Violates "unambiguous" | All toggles default to unchecked |
| "I agree to everything" mega-button | Violates "specific" | Per-scope granular toggles |
| Visual prominence asymmetry ("Accept all" highlighted vs "Reject all" gray) | Pressures the user | Symmetric button design |
| Burying revocation in nested settings | Violates Art 7(3) | One-click revoke from header / settings landing |
| Justification requirement for revocation | Violates "freely given" | No justification required |
| Re-prompting after refusal | Violates "freely given" | After refuse, do not re-prompt in same session |
| Confusing language ("decline to deny consent") | Violates "informed" | Plain language verbs (allow / refuse) |
| Forcing consent to use core service | Violates "freely given" / Art 7(4) | Core service available with minimum required consents only |

## 13. Accessibility

Consent UI MUST meet WCAG 2.1 AA:
- Keyboard-navigable
- Screen-reader compatible (semantic HTML, ARIA labels)
- 4.5:1 contrast ratio
- No timeouts on consent forms (or, if timeouts, prominent warning + extension option)
- Plain language at Flesch-Kincaid grade 8 or below where possible

## 14. Localization

Translations of disclosure text are versioned and reviewed:
- English (canonical)
- French (Togo / francophone Africa)
- Spanish (US Hispanic + LatAm)
- additional locales as customer base grows

Each translation is `disclosure-versions/v{N}/{locale}.md`. Counsel review per locale before publication.

## 15. Open items

| ID | Item | Owner |
|---|---|---|
| C1 | Build `/settings/delegations` page (§ 4) | Developer + UX |
| C2 | Build consent-record table + writer | Developer |
| C3 | Build disclosure-version registry | Developer + Documentarian |
| C4 | Type-to-confirm component (§ 5) | UX |
| C5 | Variant A/B icon system | UX |
| C6 | Anti-pattern review of all current consent flows | Security + UX |
| C7 | Wireframes for §§ 10.1–10.5 | UX |
| C8 | Translation pipeline (§ 14) | Documentarian |
| C9 | Wire up to full UX audit `/home/barb/.cursor/plans/funding-ux-audit_51ac035e.plan.md` | UX |

## 16. Residual risk

1. **Custodial-signing assumption**: when we mint the delegation on the user's behalf via session key (a common flow), the user clicks once and we sign. There's a window between click and signature where the user did not see the final EIP-712 payload. Mitigation: pre-render the payload, sign only after user clicks Confirm.

2. **Free-text scope descriptions**: scopes are encoded as caveats in the contract layer, but the friendly description in the UI is hand-written. A mistranslation between the technical caveat and the friendly description could mislead users. Mitigation: scope-description registry with reviewer sign-off; SDK-side test that asserts the registry maps every caveat code.

3. **Variant A → B promotion**: a user might agree to Variant A and then, due to a flow change in the application, end up creating a Variant B record. Mitigation: each consent record records its variant at the time of consent; if a flow change would promote, a fresh consent is required.

4. **Special-category inference at consent time**: a user consenting to a "coaching" delegation is implicitly consenting to Art 9 special-category processing (religious data) without that being called out. We address in P12 with a stronger gate at signup. P5-level mitigation: include "religious notes" in the scope list explicitly so Art 9 processing is named.

## 17. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-18 | Security agent + UX (draft) | Initial draft. |

---

**End of P5.**
