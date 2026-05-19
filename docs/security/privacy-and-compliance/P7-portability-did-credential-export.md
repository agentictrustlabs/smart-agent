# P7 — Portability: DID and Credential Export

> **Document status: DRAFT.**
> **Last updated: 2026-05-18.**

## 0. Executive summary

GDPR Article 20 grants the data subject the right to receive personal data they have provided to a controller in a **structured, commonly used, and machine-readable format**, and the right to **transmit those data to another controller** without hindrance.

For most fields, P6 satisfies Art 20 alongside Art 15 (the export bundle is machine-readable JSON-LD). Portability differs from access in three places: (1) it covers only data the user **provided** (not derived), (2) it must be in a format another controller can **ingest**, and (3) it may include the right to **direct transmission** if technically feasible.

For Smart Agent, the load-bearing portability questions are:
- **Identity portability**: can a user move their DID and address ecosystem to another platform?
- **Credential portability**: can a user export their AnonCreds vault to a self-custody wallet (e.g., an Aries-compatible mobile wallet)?
- **Application-data portability**: can a user move their oikos, prayers, intents to another platform?

## 1. What Article 20 covers

GDPR Art 20(1):

> The data subject shall have the right to receive the personal data concerning him or her, which he or she has provided to a controller, in a structured, commonly used and machine-readable format and have the right to transmit those data to another controller without hindrance from the controller to which the personal data have been provided, where:
> (a) the processing is based on consent pursuant to point (a) of Article 6(1) or point (a) of Article 9(2) or on a contract pursuant to point (b) of Article 6(1); and
> (b) the processing is carried out by automated means.

Art 20(2):

> In exercising his or her right to data portability pursuant to paragraph 1, the data subject shall have the right to have the personal data transmitted directly from one controller to another, where technically feasible.

Art 20(3) limits: the right applies "without prejudice to Article 17" and "shall not adversely affect the rights and freedoms of others."

**Scope notes**:
- Applies only to data the data subject **provided** (Article 29 WP Guidelines on Data Portability, 2017-04-05).
- Excludes data the controller **derived** or **inferred** (e.g., system-computed `liveAcknowledgementCount` or ranking scores).
- Applies only where the lawful basis is consent or contract (not legitimate-interest processing).

## 2. What we can port

### 2.1 Identity (DID + smart account)

The user's **DID** (`did:passkey:1:<smartAccount>` or `did:ethr:<chainId>:<eoa>`) is technically portable in two senses:

1. **The DID identifier itself** is just a string; the user can take it anywhere.
2. **Control over the addresses** the DID resolves to depends on cryptographic key control. For passkey users, the user controls the WebAuthn authenticator privately; we cannot port the key (and we should not). For demo users, the EOA private key exists in our DB (`users.privateKey`); we **could** export it as part of an account-recovery flow but doing so creates new attack surface.

**Decision**: 
- Passkey / SIWE users: the DID is their identifier; key control is theirs already. Portability is **immediate** — they take their DID elsewhere and re-authenticate via passkey.
- Demo users: the demo flow itself is dev-only; portability of demo identities is not a v1 customer commitment.

### 2.2 W3C DID Document export

For any user, we generate a W3C DID Document conformant to [`did-core` 1.0](https://www.w3.org/TR/did-core/):

```json
{
  "@context": ["https://www.w3.org/ns/did/v1"],
  "id": "did:passkey:1:0xAB60...3f8d",
  "verificationMethod": [
    {
      "id": "#passkey-1",
      "type": "Multikey",
      "controller": "did:passkey:1:0xAB60...3f8d",
      "publicKeyMultibase": "z..."
    }
  ],
  "authentication": ["#passkey-1"],
  "service": [
    {
      "id": "#person-mcp",
      "type": "PersonMcpEndpoint",
      "serviceEndpoint": "https://person-mcp.smart-agent.example/wallet/..."
    },
    {
      "id": "#a2a",
      "type": "A2AAgentEndpoint",
      "serviceEndpoint": "https://a2a-agent.smart-agent.example/..."
    }
  ]
}
```

This is part of the export bundle from P6.

### 2.3 W3C Verifiable Credentials export

For each AnonCreds credential held in the user's vault, we provide:

**Option A (default — metadata)**:
```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2"],
  "type": ["VerifiableCredential", "AnonCredsCredential"],
  "issuer": "did:smart-agent:issuer:org:vetted.agent",
  "credentialSubject": { ... attributes ... },
  "issuanceDate": "2026-04-01T...",
  "credentialSchema": "https://schema.smart-agent.example/v1/org-membership"
}
```

This describes the credential without releasing the raw blob.

**Option B (opt-in — raw)**:
The raw AnonCreds credential blob (the `Credential` data structure from the AnonCreds spec) is included. **This is what an Aries-compliant mobile wallet would need to import.**

The opt-in is required because raw credential blobs are signing-capable presentation material; a user who shares the export uncarefully could enable an attacker to present their credentials.

### 2.4 Application data

Oikos contacts, prayers, training progress, intents, etc. are all included in the P6 export. The JSON-LD `@context` references our public schema definitions (`https://smart-agent.example/contexts/v1`).

**Reality check on Art 20 destination controllers**: there is no second "smart-agent-compatible" platform today. A user moving to a different oikos-tracking platform would typically need a one-time data-migration script written by the destination platform. We commit to:
- Publishing the JSON-LD schema publicly so any developer can write an import script.
- NOT obfuscating the format to lock users in.

### 2.5 Activity log, audit log, consent records

These are also exported. They are derived from processing, so under Art 20 strict interpretation they are not within scope (only user-provided data is). We include them anyway for completeness; the destination controller can choose what to ingest.

## 3. AnonCreds portability — the hard case

AnonCreds was designed for self-sovereign use. The credential model:
- User holds a **link secret** (the master cryptographic secret).
- Each credential is bound to the link secret at issuance.
- Presentations use the link secret to generate zero-knowledge proofs.

In the custodial model, **we** hold the link secret. To enable portability, the user needs:
1. A new (their own) link secret on the target wallet.
2. Re-issuance of credentials against the new link secret, OR
3. A migration of the existing credentials to the new link secret.

**Option (3) is generally not possible** in standard AnonCreds — credentials are bound to a specific link secret at issue time. Re-binding would require either:
- The issuer to re-issue (Option 2).
- A protocol extension (not in v1 AnonCreds spec).

**Practical portability path**: the export bundle contains the **raw credential blobs** (Option B above) AND the **link secret** export. The user transports both to the target wallet. The target wallet imports both. **This works for AnonCreds 2.0 / Aries-compatible wallets.**

### 3.1 Link secret export — the risk

Exporting the link secret is **the highest-risk operation in the entire portability flow**. Reasons:

1. Compromise of the link secret = compromise of every credential bound to it.
2. The export is, by definition, the link secret leaving our controlled environment.
3. We cannot guarantee the target wallet's security posture.

**Mitigations**:
- Link secret export is **opt-in** (separate consent step beyond the general "raw credential blobs" opt-in).
- Encrypted-at-rest in the export bundle with a **passphrase the user types**, not the bundle signing key. The link secret never travels in cleartext.
- A clear disclosure:
  > Exporting your link secret enables you to use your credentials on another wallet. **It also means whoever has the export can present your credentials.** Treat this export like a password manager backup: store it in an encrypted location and do not share it.
- After export, Smart Agent **does not delete** the link secret from the custodial vault by default (the user may still want to use Smart Agent). A separate "delete custodial vault" action is required.

### 3.2 Compatible wallets

Target wallets (Aries-compatible, AnonCreds-supporting):
- **Aries Mobile Agent React Native (AMRN)** — Hyperledger
- **Lissi Wallet** — Sovrin/Indy-aware
- **Trinsic Wallet**
- **esatus Wallet**

We do NOT certify these wallets; we publish import documentation and let users choose.

### 3.3 Re-issuance pathway (alternative)

If the user prefers not to export the link secret, the alternative is:
1. User obtains a new link secret on the target wallet.
2. Smart Agent (via its issuer endpoints) re-issues each credential against the new link secret.
3. Old credentials are revoked.

This requires cooperation from the **issuer** of each credential. For credentials Smart Agent itself issued (e.g., marketplace-credential-issuance per spec 004), we cooperate. For credentials issued by other parties (e.g., a coaching credential from another org), the other party must cooperate.

**v1 commitment**: re-issuance pathway for Smart-Agent-issued credentials. Third-party-issued credentials are out of scope but we document the path.

## 4. The portability request flow

| Step | Detail |
|---|---|
| Request | User clicks "Export and Port My Data" in Settings → My Data |
| Verify | Same identity verification as P6 |
| Configure | Checkboxes for opt-in items (raw credentials, link secret) |
| Generate | Job runs (P6 § 7.2 logic + the portability extras) |
| Deliver | Signed URL (24 hours) |
| Optional direct-transmit | If user provides a target wallet's HTTP endpoint, we can POST the bundle directly (Art 20(2)) — **NOT v1** |

## 5. Direct-transmit (Art 20(2))

Art 20(2) grants the right to direct controller-to-controller transmission "where technically feasible." For Smart Agent v1:

- **Not feasible**: there is no agreed protocol for controller-to-controller transmission of mixed structured data. The closest fit is OIDC Connect (DID-based) for identity and OID4VCI (OpenID for VC Issuance) for credentials.
- **What we will support**: if the destination is an OID4VP / OID4VCI compliant endpoint, we can attempt direct presentation. v1.1 candidate.
- **User-facing language**: "Direct transmission to another platform is not currently supported. You can download your data and import it manually."

## 6. Implementation

### 6.1 Routes

| Route | Method | Purpose |
|---|---|---|
| `apps/web/src/app/api/account/portability/request/route.ts` | POST | Initiate portability |
| `apps/web/src/app/api/account/portability/configure/route.ts` | POST | Set opt-ins |
| `apps/web/src/app/api/account/portability/status/route.ts` | GET | Status |
| `apps/web/src/app/api/account/portability/download/route.ts` | GET | Download |

### 6.2 MCP tools

| Tool | Server | Purpose |
|---|---|---|
| `person:export_link_secret` | person-MCP | Returns the user's Askar link secret, passphrase-wrapped |
| `person:export_credential_blobs` | person-MCP | Returns raw AnonCreds blobs |
| `person:reissue_credential` | person-MCP | Initiates re-issuance against a new link secret |

All service-only HMAC.

### 6.3 Bundle additions over P6

```
PORT-20260518-001.zip
├── README.txt
├── export.json                  (P6 base)
├── summary.pdf                  (P6 base)
├── on-chain-history.json        (P6 base)
├── did-document.json            (P7 § 2.2)
├── credentials/
│   ├── credential-1.metadata.json  (P7 § 2.3 Option A)
│   ├── credential-1.raw.blob       (Option B, opt-in)
│   └── ...
├── link-secret.encrypted.json   (opt-in, passphrase-wrapped per § 3.1)
└── import-guide/
    ├── README.md
    ├── aries-import.md
    ├── lissi-import.md
    └── trinsic-import.md
```

### 6.4 Tests

| Test | Verifies |
|---|---|
| `tests/privacy/portability-bundle.test.ts` | Bundle contents match opt-ins |
| `tests/privacy/portability-link-secret.test.ts` | Link secret is passphrase-encrypted with PBKDF2/Argon2id, never in plaintext |
| `tests/privacy/portability-aries-import.test.ts` | Bundle imports into a test Aries wallet successfully |

## 7. CCPA portability (§ 1798.100 et seq.)

CCPA grants a comparable right "in a portable and, to the extent technically feasible, in a readily useable format that allows the consumer to transmit this information to another entity without hindrance" (§ 1798.100(d)).

Our JSON-LD + ZIP bundle satisfies CCPA. No additional implementation required.

## 8. Special-category credentials

Some credentials may contain Art 9 special-category data (e.g., a "religious-affiliation credential" issued by a church). Portability of these credentials inherits the special-category gates per P12:
- Explicit additional confirmation before export.
- Encrypted-at-export with a stronger KDF (Argon2id, target 1s on a modern machine).

## 9. Open items

| ID | Item | Owner |
|---|---|---|
| PT1 | Build `/api/account/portability/*` routes | Developer |
| PT2 | Build `person:export_link_secret` tool with passphrase wrapping | Developer + Security |
| PT3 | Author Aries-wallet import guide | Documentarian |
| PT4 | Define re-issuance protocol for Smart-Agent-issued credentials | Security |
| PT5 | v1.1: OID4VP-based direct-transmit | Developer |
| PT6 | Publish JSON-LD `@context` at a stable URL | Documentarian |

## 10. Residual risk

1. **Link-secret exfiltration via export**: even with passphrase encryption, a weak passphrase or a compromised endpoint defeats the protection. Mitigation: passphrase-strength meter, recommended-length guidance, in-browser encryption (the passphrase never reaches the server), high-iteration KDF (Argon2id with t=3, m=64MB target).

2. **Target wallet security**: we cannot vouch for AMRN, Lissi, Trinsic, esatus security postures. Users who export to a less-secure wallet inherit that wallet's risk. Mitigation: documentation, list of vetted wallets, warning at export time.

3. **Re-issuance dependency on third-party issuers**: if a credential was issued by an external party who refuses to re-issue, the user is stuck with the link-secret-export path. Mitigation: clear documentation of which credentials we can re-issue.

4. **DID-document service-endpoint exposure**: the DID document we generate lists person-MCP and A2A endpoints. After the user ports out, those endpoints no longer serve their requests; they may serve them anyway for a transition window. Mitigation: include a `validUntil` field in the DID document and deprecate after the user deletes the custodial vault.

5. **Counterparty credentials**: credentials the user issued TO another party are NOT portable from our side; the recipient holds them. This is correct semantically but may confuse users. Mitigation: export includes a list of "credentials you issued to others" with metadata.

## 11. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-18 | Security agent + Ontologist | Initial draft. |

---

**End of P7.**
