# Person-MCP Route + Tool Inventory

_Generated: 2026-05-18T02:47:03.028Z_  
_Source: `apps/person-mcp/src/{index.ts, ssi/api/**, auth/**, tools/**}`_  
_Regenerate: `pnpm generate:person-mcp-inventory`_  
_Drift-check: `pnpm generate:person-mcp-inventory --check` (CI gate)_

This file is auto-generated from the `@sa-route` / `@sa-tool` JSDoc tags on every Hono route handler and MCP tool descriptor in person-mcp. Editing it by hand will be undone the next time the generator runs — change the handler/tool's JSDoc and regenerate.

Why this exists: person-mcp owns PII, the AnonCreds wallet, and session storage. Without this inventory, the attack surface is unauditable. The sibling `check-person-mcp-classification` lint fails CI when any handler/tool drops its classification.

## Summary

| Section | Count |
|---------|-------|
| Public HTTP routes | 3 |
| Service-only HTTP routes (require inbound HMAC) | 15 |
| Delegation-verified HTTP routes | 7 |
| Bootstrap HTTP routes | 1 |
| Dev-only HTTP routes | 0 |
| **HTTP routes total** | **26** |
| Delegation-verified MCP tools | 76 |
| Service-only MCP tools | 0 |
| Bootstrap MCP tools | 1 |
| Dev-only MCP tools | 0 |
| **MCP tools total** | **77** |
| **Grand total** | **103** |

## HTTP routes

### Public HTTP routes

Unauthenticated by design (health, operator debug). MUST disclose no PII and rate-limit any DB/network touch.

| Route | Method | Auth | Rate Limit | Validation | Prod Gate | Risk | Source |
|-------|--------|------|------------|------------|-----------|------|--------|
| `/.well-known/ssi-wallet.json` | GET | none-system-scoped | none | — | always | — | [`index.ts`](../../apps/person-mcp/src/index.ts) |
| `/health` | GET | none-system-scoped | none | — | always | — | [`index.ts`](../../apps/person-mcp/src/index.ts) |
| `/tools` | GET | none-system-scoped | none | — | always | — | [`index.ts`](../../apps/person-mcp/src/index.ts) |

### Service-only HTTP routes (require inbound HMAC)

Gated on `requireInboundServiceAuth()` — caller signs with the shared `a2a-to-person` MAC key. Never reachable from a browser.

| Route | Method | Auth | Rate Limit | Validation | Prod Gate | Risk | Source |
|-------|--------|------|------------|------------|-----------|------|--------|
| `/audit/:holderWalletId/credentials` | GET | service-hmac | none | none-path-params | always | high | [`ssi/api/audit.ts`](../../apps/person-mcp/src/ssi/api/audit.ts) |
| `/audit/append` | POST | service-hmac | none | shape-check | always | high | [`auth/wallet-action-routes.ts`](../../apps/person-mcp/src/auth/wallet-action-routes.ts) |
| `/audit/log/:account` | GET | service-hmac | none | none-path-params | always | high | [`auth/wallet-action-routes.ts`](../../apps/person-mcp/src/auth/wallet-action-routes.ts) |
| `/credentials/:holderWalletId` | GET | service-hmac | none | none-path-params | always | high | [`ssi/api/credentials.ts`](../../apps/person-mcp/src/ssi/api/credentials.ts) |
| `/credentials/store` | POST | service-hmac | none | shape-check | always | high | [`ssi/api/credentials.ts`](../../apps/person-mcp/src/ssi/api/credentials.ts) |
| `/session-store/active/:account` | GET | service-hmac | none | none-path-params | always | high | [`auth/wallet-action-routes.ts`](../../apps/person-mcp/src/auth/wallet-action-routes.ts) |
| `/session-store/bump-epoch` | POST | service-hmac | none | shape-check | always | sensitive | [`auth/wallet-action-routes.ts`](../../apps/person-mcp/src/auth/wallet-action-routes.ts) |
| `/session-store/by-cookie/:cookieValue` | GET | service-hmac | none | none-path-params | always | high | [`auth/wallet-action-routes.ts`](../../apps/person-mcp/src/auth/wallet-action-routes.ts) |
| `/session-store/epoch/:account` | GET | service-hmac | none | none-path-params | always | medium | [`auth/wallet-action-routes.ts`](../../apps/person-mcp/src/auth/wallet-action-routes.ts) |
| `/session-store/insert` | POST | service-hmac | none | shape-check | always | sensitive | [`auth/wallet-action-routes.ts`](../../apps/person-mcp/src/auth/wallet-action-routes.ts) |
| `/session-store/revoke` | POST | service-hmac | none | shape-check | always | high | [`auth/wallet-action-routes.ts`](../../apps/person-mcp/src/auth/wallet-action-routes.ts) |
| `/tools/:toolName` | POST | service-hmac | none | shape-check | always | high | [`index.ts`](../../apps/person-mcp/src/index.ts) |
| `/wallet-action/verify` | POST | service-hmac | none | shape-check | always | high | [`auth/wallet-action-routes.ts`](../../apps/person-mcp/src/auth/wallet-action-routes.ts) |
| `/wallet/:principal` | GET | service-hmac | none | none-path-params | always | medium | [`ssi/api/wallet.ts`](../../apps/person-mcp/src/ssi/api/wallet.ts) |
| `/wallet/:principal/:context` | GET | service-hmac | none | none-path-params | always | medium | [`ssi/api/wallet.ts`](../../apps/person-mcp/src/ssi/api/wallet.ts) |

### Delegation-verified HTTP routes

Each call carries a signed WalletAction the route verifies via `gateExistingWalletAction` / `gateProvisionAction` / `verifyDelegatedWalletAction`.

| Route | Method | Auth | Rate Limit | Validation | Prod Gate | Risk | Source |
|-------|--------|------|------------|------------|-----------|------|--------|
| `/credentials/request` | POST | wallet-action-signature | none | wallet-action-canonical | always | sensitive | [`ssi/api/credentials.ts`](../../apps/person-mcp/src/ssi/api/credentials.ts) |
| `/oid4vp/authorize` | POST | wallet-action-signature | none | wallet-action-canonical | always | sensitive | [`ssi/api/oid4vp.ts`](../../apps/person-mcp/src/ssi/api/oid4vp.ts) |
| `/proofs/present` | POST | wallet-action-signature | none | wallet-action-canonical | always | sensitive | [`ssi/api/proofs.ts`](../../apps/person-mcp/src/ssi/api/proofs.ts) |
| `/wallet-action/dispatch` | POST | service-hmac | none | wallet-action-canonical | always | sensitive | [`auth/dispatch-routes.ts`](../../apps/person-mcp/src/auth/dispatch-routes.ts) |
| `/wallet/match-against-public-set` | POST | wallet-action-signature | none | wallet-action-canonical | always | sensitive | [`ssi/api/match-public-set.ts`](../../apps/person-mcp/src/ssi/api/match-public-set.ts) |
| `/wallet/provision` | POST | wallet-action-signature | none | wallet-action-canonical | always | sensitive | [`ssi/api/wallet.ts`](../../apps/person-mcp/src/ssi/api/wallet.ts) |
| `/wallet/rotate-link-secret` | POST | wallet-action-signature | none | wallet-action-canonical | always | sensitive | [`ssi/api/wallet.ts`](../../apps/person-mcp/src/ssi/api/wallet.ts) |

### Bootstrap HTTP routes

Special-purpose unauthenticated entry points (e.g. provisioning idempotency probes). Must still rate-limit and audit.

| Route | Method | Auth | Rate Limit | Validation | Prod Gate | Risk | Source |
|-------|--------|------|------------|------------|-----------|------|--------|
| `/oid4vp/preview` | POST | none-system-scoped | none | shape-check | always | low | [`ssi/api/oid4vp.ts`](../../apps/person-mcp/src/ssi/api/oid4vp.ts) |

### Dev-only HTTP routes

Guarded by `@sa-prod-gate` — return 404 in production.

_None._

## MCP tools

### Delegation-verified MCP tools

Each invocation calls `requirePrincipal(token, scope)` against the cross-MCP delegation registry. The principal is derived from the verified delegation chain, not from input.

| Tool | Side | Auth | Rate Limit | Validation | Prod Gate | Risk | Source |
|------|------|------|------------|------------|-----------|------|--------|
| `add_external_identity` | write | delegation-token | none | json-schema | always | medium | [`tools/identities.ts`](../../apps/person-mcp/src/tools/identities.ts) |
| `add_message` | write | delegation-token | none | json-schema | always | medium | [`tools/chat.ts`](../../apps/person-mcp/src/tools/chat.ts) |
| `add_oikos_contact` | write | delegation-token | none | json-schema | always | medium | [`tools/oikos.ts`](../../apps/person-mcp/src/tools/oikos.ts) |
| `create_notification` | write | delegation-token | none | json-schema | always | medium | [`tools/notifications.ts`](../../apps/person-mcp/src/tools/notifications.ts) |
| `create_thread` | write | delegation-token | none | json-schema | always | medium | [`tools/chat.ts`](../../apps/person-mcp/src/tools/chat.ts) |
| `create_work_item` | write | delegation-token | none | json-schema | always | medium | [`tools/work-items.ts`](../../apps/person-mcp/src/tools/work-items.ts) |
| `delete_belief` | write | delegation-token | none | json-schema | always | medium | [`tools/beliefs.ts`](../../apps/person-mcp/src/tools/beliefs.ts) |
| `delete_coaching_note` | write | delegation-token | none | json-schema | always | medium | [`tools/coaching.ts`](../../apps/person-mcp/src/tools/coaching.ts) |
| `delete_oikos_contact` | write | delegation-token | none | json-schema | always | medium | [`tools/oikos.ts`](../../apps/person-mcp/src/tools/oikos.ts) |
| `delete_prayer` | write | delegation-token | none | json-schema | always | medium | [`tools/prayers.ts`](../../apps/person-mcp/src/tools/prayers.ts) |
| `ETH` | write | delegation-token | none | json-schema | always | medium | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |
| `express_intent` | write | delegation-token | none | json-schema | always | medium | [`tools/intents.ts`](../../apps/person-mcp/src/tools/intents.ts) |
| `get_delegated_profile` | read | delegation-token | none | — | always | low | [`tools/profile.ts`](../../apps/person-mcp/src/tools/profile.ts) |
| `get_delegated_training_progress` | read | delegation-token | none | — | always | low | [`tools/training.ts`](../../apps/person-mcp/src/tools/training.ts) |
| `get_intent` | read | delegation-token | none | — | always | low | [`tools/intents.ts`](../../apps/person-mcp/src/tools/intents.ts) |
| `get_profile` | read | delegation-token | none | — | always | low | [`tools/profile.ts`](../../apps/person-mcp/src/tools/profile.ts) |
| `get_shared_coaching_notes` | read | delegation-token | none | — | always | medium | [`tools/coaching.ts`](../../apps/person-mcp/src/tools/coaching.ts) |
| `get_thread` | read | delegation-token | none | — | always | low | [`tools/chat.ts`](../../apps/person-mcp/src/tools/chat.ts) |
| `get_user_preferences` | read | delegation-token | none | — | always | low | [`tools/preferences.ts`](../../apps/person-mcp/src/tools/preferences.ts) |
| `grant_cross_delegation` | write | delegation-token | none | json-schema | always | medium | [`tools/cross-delegations.ts`](../../apps/person-mcp/src/tools/cross-delegations.ts) |
| `grant_proposal:clone` | write | delegation-token | none | json-schema | always | medium | [`tools/grantProposals.ts`](../../apps/person-mcp/src/tools/grantProposals.ts) |
| `grant_proposal:draft` | write | delegation-token | none | json-schema | always | medium | [`tools/grantProposals.ts`](../../apps/person-mcp/src/tools/grantProposals.ts) |
| `grant_proposal:edit_pre_deadline` | write | delegation-token | none | json-schema | always | medium | [`tools/grantProposals.ts`](../../apps/person-mcp/src/tools/grantProposals.ts) |
| `grant_proposal:list_for_member` | read | delegation-token | none | — | always | low | [`tools/grantProposals.ts`](../../apps/person-mcp/src/tools/grantProposals.ts) |
| `grant_proposal:read_self` | read | delegation-token | none | — | always | low | [`tools/grantProposals.ts`](../../apps/person-mcp/src/tools/grantProposals.ts) |
| `grant_proposal:submit` | write | delegation-token | none | json-schema | always | medium | [`tools/grantProposals.ts`](../../apps/person-mcp/src/tools/grantProposals.ts) |
| `grant_proposal:withdraw` | write | delegation-token | none | json-schema | always | medium | [`tools/grantProposals.ts`](../../apps/person-mcp/src/tools/grantProposals.ts) |
| `intent:bump_ack_count` | write | delegation-token | none | json-schema | always | high | [`tools/intents.ts`](../../apps/person-mcp/src/tools/intents.ts) |
| `list_activities` | read | delegation-token | none | — | always | low | [`tools/activities.ts`](../../apps/person-mcp/src/tools/activities.ts) |
| `list_beliefs` | read | delegation-token | none | — | always | low | [`tools/beliefs.ts`](../../apps/person-mcp/src/tools/beliefs.ts) |
| `list_coaching_notes` | read | delegation-token | none | — | always | low | [`tools/coaching.ts`](../../apps/person-mcp/src/tools/coaching.ts) |
| `list_cross_delegation_grants` | read | delegation-token | none | — | always | low | [`tools/cross-delegations.ts`](../../apps/person-mcp/src/tools/cross-delegations.ts) |
| `list_external_identities` | read | delegation-token | none | — | always | low | [`tools/identities.ts`](../../apps/person-mcp/src/tools/identities.ts) |
| `list_intents` | read | delegation-token | none | — | always | low | [`tools/intents.ts`](../../apps/person-mcp/src/tools/intents.ts) |
| `list_notifications` | read | delegation-token | none | — | always | low | [`tools/notifications.ts`](../../apps/person-mcp/src/tools/notifications.ts) |
| `list_oikos_contacts` | read | delegation-token | none | — | always | low | [`tools/oikos.ts`](../../apps/person-mcp/src/tools/oikos.ts) |
| `list_pinned_items` | read | delegation-token | none | — | always | low | [`tools/pinned.ts`](../../apps/person-mcp/src/tools/pinned.ts) |
| `list_prayers` | read | delegation-token | none | — | always | low | [`tools/prayers.ts`](../../apps/person-mcp/src/tools/prayers.ts) |
| `list_received_delegations` | read | delegation-token | none | — | always | low | [`tools/received-delegations.ts`](../../apps/person-mcp/src/tools/received-delegations.ts) |
| `list_threads` | read | delegation-token | none | — | always | low | [`tools/chat.ts`](../../apps/person-mcp/src/tools/chat.ts) |
| `list_training_progress` | read | delegation-token | none | — | always | low | [`tools/training.ts`](../../apps/person-mcp/src/tools/training.ts) |
| `list_work_items` | read | delegation-token | none | — | always | low | [`tools/work-items.ts`](../../apps/person-mcp/src/tools/work-items.ts) |
| `log_activity` | write | delegation-token | none | json-schema | always | medium | [`tools/activities.ts`](../../apps/person-mcp/src/tools/activities.ts) |
| `mark_notification_read` | write | delegation-token | none | json-schema | always | medium | [`tools/notifications.ts`](../../apps/person-mcp/src/tools/notifications.ts) |
| `mark_prayer_response` | write | delegation-token | none | json-schema | always | medium | [`tools/prayers.ts`](../../apps/person-mcp/src/tools/prayers.ts) |
| `pin_item` | write | delegation-token | none | json-schema | always | medium | [`tools/pinned.ts`](../../apps/person-mcp/src/tools/pinned.ts) |
| `register_received_delegation` | write | delegation-token | none | json-schema | always | high | [`tools/received-delegations.ts`](../../apps/person-mcp/src/tools/received-delegations.ts) |
| `relationship:emit_edge` | write | delegation-token | none | json-schema | always | medium | [`tools/relationship.ts`](../../apps/person-mcp/src/tools/relationship.ts) |
| `relationship:list_outgoing` | read | delegation-token | none | — | always | low | [`tools/relationship.ts`](../../apps/person-mcp/src/tools/relationship.ts) |
| `relationship:set_edge_status` | write | delegation-token | none | json-schema | always | medium | [`tools/relationship.ts`](../../apps/person-mcp/src/tools/relationship.ts) |
| `remove_external_identity` | write | delegation-token | none | json-schema | always | medium | [`tools/identities.ts`](../../apps/person-mcp/src/tools/identities.ts) |
| `resolve_work_item` | write | delegation-token | none | json-schema | always | medium | [`tools/work-items.ts`](../../apps/person-mcp/src/tools/work-items.ts) |
| `revoke_cross_delegation` | write | delegation-token | none | json-schema | always | medium | [`tools/cross-delegations.ts`](../../apps/person-mcp/src/tools/cross-delegations.ts) |
| `revoke_received_delegation` | write | delegation-token | none | json-schema | always | high | [`tools/received-delegations.ts`](../../apps/person-mcp/src/tools/received-delegations.ts) |
| `ssi_create_presentation` | write | delegation-token | none | json-schema | always | medium | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |
| `ssi_finish_credential_exchange` | write | delegation-token | none | json-schema | always | medium | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |
| `ssi_get_credential_details` | write | delegation-token | none | json-schema | always | medium | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |
| `ssi_get_holder_wallet` | write | delegation-token | none | json-schema | always | medium | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |
| `ssi_get_marketplace_delegation` | write | delegation-token | none | json-schema | always | medium | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |
| `ssi_list_my_credentials` | read | delegation-token | none | json-schema | always | medium | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |
| `ssi_list_proof_audit` | read | delegation-token | none | json-schema | always | medium | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |
| `ssi_list_wallets` | read | delegation-token | none | json-schema | always | medium | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |
| `ssi_match_against_public_set` | write | delegation-token | none | json-schema | always | medium | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |
| `ssi_provision_wallet` | write | delegation-token | none | json-schema | always | medium | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |
| `ssi_rotate_link_secret` | write | delegation-token | none | json-schema | always | medium | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |
| `ssi_start_credential_exchange` | write | delegation-token | none | json-schema | always | medium | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |
| `toggle_planned_conversation` | write | delegation-token | none | json-schema | always | medium | [`tools/oikos.ts`](../../apps/person-mcp/src/tools/oikos.ts) |
| `toggle_training_module` | write | delegation-token | none | json-schema | always | medium | [`tools/training.ts`](../../apps/person-mcp/src/tools/training.ts) |
| `unpin_item` | write | delegation-token | none | json-schema | always | medium | [`tools/pinned.ts`](../../apps/person-mcp/src/tools/pinned.ts) |
| `update_oikos_contact` | write | delegation-token | none | json-schema | always | medium | [`tools/oikos.ts`](../../apps/person-mcp/src/tools/oikos.ts) |
| `update_profile` | write | delegation-token | none | json-schema | always | medium | [`tools/profile.ts`](../../apps/person-mcp/src/tools/profile.ts) |
| `update_user_preferences` | write | delegation-token | none | json-schema | always | medium | [`tools/preferences.ts`](../../apps/person-mcp/src/tools/preferences.ts) |
| `upsert_belief` | write | delegation-token | none | json-schema | always | medium | [`tools/beliefs.ts`](../../apps/person-mcp/src/tools/beliefs.ts) |
| `upsert_coaching_note` | write | delegation-token | none | json-schema | always | medium | [`tools/coaching.ts`](../../apps/person-mcp/src/tools/coaching.ts) |
| `upsert_prayer` | write | delegation-token | none | json-schema | always | medium | [`tools/prayers.ts`](../../apps/person-mcp/src/tools/prayers.ts) |
| `withdraw_intent` | write | delegation-token | none | json-schema | always | medium | [`tools/intents.ts`](../../apps/person-mcp/src/tools/intents.ts) |

### Service-only MCP tools

Reachable only via the a2a-agent mcp-proxy after HMAC service-auth; tools require `_a2aSessionId` injected by the proxy.

_None._

### Bootstrap MCP tools

Special-purpose tools that build a wallet action envelope clients then sign client-side. Tool output is the unsigned action, not a state change.

| Tool | Side | Auth | Rate Limit | Validation | Prod Gate | Risk | Source |
|------|------|------|------------|------------|-----------|------|--------|
| `ssi_create_wallet_action` | write | none-system-scoped | none | json-schema | always | low | [`tools/ssi-wallet.ts`](../../apps/person-mcp/src/tools/ssi-wallet.ts) |

### Dev-only MCP tools

Guarded by `@sa-prod-gate` — refuse in production.

_None._
