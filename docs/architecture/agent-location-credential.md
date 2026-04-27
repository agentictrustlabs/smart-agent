# Agent Location Credential

This document defines `AgentLocationCredential` and how Smart Agent uses it
with `.geo`, `GeoFeatureRegistry`, `GeoClaimRegistry`, AnonCreds, and
third-party verifier agents.

`AgentLocationCredential` is intentionally **feature-level**, not
address-level. It proves an agent has a verified relationship to a named,
versioned geographic feature such as `erie.colorado.us.geo`; it does not put
exact addresses, raw coordinates, private H3 cells, or evidence documents in
SQL or on chain.

## 1. Architecture Fit

The geo architecture has three layers:

- `.geo` names resolve human-readable feature handles such as
  `erie.colorado.us.geo`.
- `GeoFeatureRegistry` is the source of truth for a versioned geographic
  feature: `featureId`, `featureVersion`, `geometryHash`,
  `h3CoverageRoot`, `metadataURI`, steward account, bbox, and centroid.
- `GeoClaimRegistry` stores public or commitment-only claims that an agent has
  a relationship to a feature: `residentOf`, `operatesIn`, `servesWithin`,
  `completedTaskIn`, `validatedPresenceIn`, `stewardOf`, or `originIn`.

AnonCreds are used when the holder should prove a location relationship to a
third party without disclosing exact location evidence. The credential carries
the **feature-level claim**, not the raw address or private H3 cell. Exact
addresses, raw coordinates, H3 leaf cells, utility bills, task receipts, and
other location evidence stay in the holder vault or verifier evidence store.

For named-feature matching, no H3 proof is required:

```text
holder credential featureId = erie.colorado.us.geo
verifier policy publicSet   = [erie.colorado.us.geo, colorado.us.geo, ...]
```

For point-in-region matching, H3 is an off-chain verifier input:

```text
private point / private H3 cell
  -> proves membership in public GeoFeature.h3CoverageRoot
      -> verifier emits signed receipt / evidenceCommit
```

The current architecture does **not** require an on-chain AnonCreds verifier.
AnonCreds proofs and H3 inclusion proofs are verified off-chain by trusted or
reputation-bearing verifier agents. The chain anchors the feature, claim,
assertion, and receipt commitments only when a public audit trail is needed.

## 2. Credential Definition

Recommended AnonCreds schema:

```json
{
  "name": "AgentLocationCredential",
  "version": "1.0",
  "attrNames": [
    "subjectAgent",
    "featureId",
    "featureVersion",
    "featureName",
    "relation",
    "locationBasis",
    "h3CoverageRoot",
    "evidenceCommit",
    "issuerAgent",
    "assuranceLevel",
    "issuedAtEpoch",
    "validUntilEpoch"
  ]
}
```

Attribute semantics:

| Attribute | Meaning | Reveal guidance |
| --------- | ------- | --------------- |
| `subjectAgent` | AgentAccount address the credential is about | Reveal only when the verifier must bind proof to a known A2A counterparty; otherwise prefer pairwise holder binding |
| `featureId` | Canonical `GeoFeatureRegistry` id | Safe to reveal when proving a named feature such as Erie; keep hidden for private geo overlap scoring |
| `featureVersion` | Boundary/source version pinned at issuance | Usually reveal with `featureId` so the verifier checks against the same feature record |
| `featureName` | Human-readable `.geo` name, e.g. `erie.colorado.us.geo` | Convenience display; not authority |
| `relation` | `residentOf`, `operatesIn`, `servesWithin`, `completedTaskIn`, `validatedPresenceIn`, `stewardOf`, `originIn` | Often revealed because it changes policy outcome |
| `locationBasis` | `named-feature`, `document-verified`, `h3-inclusion`, `issuer-attested`, `task-receipt` | Reveal when the verifier weights evidence quality |
| `h3CoverageRoot` | Public coverage root from the feature version used | Reveal only for H3-inclusion policies; never reveals the private cell |
| `evidenceCommit` | Hash of verifier transcript / evidence bundle | Safe to reveal as an audit anchor |
| `issuerAgent` | Verifier/issuer agent that issued the credential | Usually reveal for issuer trust scoring |
| `assuranceLevel` | Numeric 0-100 confidence | Use predicates or reveal, depending on verifier policy |
| `issuedAtEpoch` | Unix timestamp | Usually hidden unless recency policy needs it |
| `validUntilEpoch` | Unix timestamp | Usually predicate-only, e.g. `validUntilEpoch >= now` |

Example credential values:

```json
{
  "subjectAgent": "0x1234...abcd",
  "featureId": "0x8f...erie",
  "featureVersion": "1",
  "featureName": "erie.colorado.us.geo",
  "relation": "residentOf",
  "locationBasis": "document-verified",
  "h3CoverageRoot": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "evidenceCommit": "0x9a...receipt",
  "issuerAgent": "0xverifier...",
  "assuranceLevel": "85",
  "issuedAtEpoch": "1777228800",
  "validUntilEpoch": "1808764800"
}
```

If the credential was issued from a private point-in-region check, the
`locationBasis` should be `h3-inclusion` and `h3CoverageRoot` should match the
published `GeoFeatureRegistry` record. The private H3 cell and Merkle path are
not credential attributes; they are verifier-side proof witnesses and should
never be stored in SQL or on-chain metadata.

## 3. Third-Party Verifier Flow

This is the location-verification path used by A2A agents, external verifiers,
or local policy engines. The proof is consumed by the **agent/verifier
runtime**, not by a smart contract. That is why both AnonCreds verification and
H3 inclusion verification stay off-chain.

```text
Holder app              person-mcp                         Third-party verifier        Chain / GraphDB
   |                         |                                      |                         |
   | request policy: "prove location relation"                  |                         |
   +----------------------------------------------------------->|                         |
   |                                                            | resolve feature policy   |
   |                                                            +------------------------>|
   |                                                            | GeoFeatureRegistry /     |
   |                                                            | GraphDB GeoSPARQL        |
   |<-----------------------------------------------------------+ presentationRequest +    |
   | verifierId, verifierAddress, verifierSignature, relation     featureId/version/policy |
   |                                                            |                         |
   | /tools/ssi_create_wallet_action                            |                         |
   |   type=CreatePresentation, policy limits                   |                         |
   +------------------------->|                                |                         |
   |<-------------------------+ unsigned WalletAction           |                         |
   | passkey ceremony in Browser                               |                         |
   |   -> 0x01 || abi.encode(Assertion)                        |                         |
   |                                                            |                         |
   | /tools/ssi_create_presentation(action, sig, selections)    |                         |
   +------------------------->|                                |                         |
   |                          | verify WalletAction                 |                         |
   |                          | enforce proofRequestHash            |                         |
   |                          | load schema/credDef                 +------------------------>|
   |                          | get credential from vault           |                         |
   |                          | create AnonCreds presentation       |                         |
   |<-------------------------+ {presentation, auditSummary}    |                         |
   |                                                            |                         |
   | POST /verify/location/check(presentation, optional h3 proof witnesses)    |
   +----------------------------------------------------------->|                         |
   |                                                            | verify AnonCreds proof   |
   |                                                            | verify issuer/credDef    +------------------------>|
   |                                                            | if policy requires:      |
   |                                                            |   check featureVersion   |
   |                                                            |   verify H3 inclusion    |
   |                                                            | create verifier receipt  |
   |<-----------------------------------------------------------+ {verified, receipt, evidenceCommit}
   |                                                            |                         |
   | optional: publish public or commitment-only GeoClaim        |                         |
   +----------------------------------------------------------->| -----------------------> |
   |                                                            | GeoClaimRegistry.mint    |
```

The verifier can be an internal MCP, an external organisation, or another
agent in an A2A flow. The trust boundary is the verifier's signature and
reputation. When a public audit trail is required, the verifier or holder can
anchor the result in `GeoClaimRegistry`:

- `Visibility.Public` if feature, relation, subject, and evidence are safe to
  expose.
- `Visibility.PublicCoarse` if only a broad feature should be public.
- `Visibility.PrivateCommitment` if the chain should store only
  `evidenceCommit`.
- `Visibility.PrivateZk` if the verifier receipt references a ZK/H3 inclusion
  proof, while the verifier still runs off-chain.

## 4. Verification Boundaries

| Check | Runs where | Why |
| ----- | ---------- | --- |
| AnonCreds proof verification | Third-party verifier / MCP | CL proofs are not EVM-friendly and need schema/credDef/revocation resolution |
| H3 inclusion / point-in-feature verification | Third-party verifier / MCP | Agent policy consumes the result; no contract needs to enforce it directly |
| `GeoFeatureRegistry` lookup | Chain / GraphDB | Public feature version, geometry hash, and coverage root provenance |
| Receipt or commitment anchoring | Optional on-chain `GeoClaimRegistry` | Auditability, replay resistance, and later trust-graph indexing |

Use on-chain verifier contracts only when another contract must consume the
proof directly, such as on-chain access control, payout, minting, or slashing.
For agent trust/routing decisions, keep verification in the agent/verifier
runtime and anchor only commitments or receipts.
