# 05 — Feature Data Flow (After the Cut)

For each web app feature: which stores it reads/writes after the cut. This replaces the current pattern of "web action queries local SQLite."

**Reading convention:**
- `🔵 P` = person-mcp
- `🟢 O` = org-mcp
- `⚫ C` = on-chain
- `🟣 G` = GraphDB
- `⚪ W` = web SQL

A feature's "data flow" is the ordered set of stores its server action touches.

---

## 1. Profile / Settings

| Action | Flow | Notes |
|---|---|---|
| View own profile | `🔵 P:get_profile` | Already there |
| Update own profile | `🔵 P:update_profile` | Already there |
| View another user's profile (with grant) | `🔵 P:get_delegated_profile` | Already there |
| Update preferences | `🔵 P:update_user_preferences` | NEW tool |
| View preferences | `🔵 P:get_user_preferences` | NEW tool |

## 2. Oikos / Circles

| Action | Flow |
|---|---|
| List my oikos | `🔵 P:list_oikos_contacts` |
| Add oikos contact | `🔵 P:add_oikos_contact` |
| Update / delete contact | `🔵 P:update_oikos_contact`, `delete_oikos_contact` |
| Toggle planned conversation | `🔵 P:toggle_planned_conversation` |

All NEW person-mcp tools. Web action becomes a thin pass-through.

## 3. Prayer

| Action | Flow |
|---|---|
| List my prayers | `🔵 P:list_prayers` |
| Create / update / delete prayer | `🔵 P:upsert_prayer`, `delete_prayer` |
| Mark response | `🔵 P:mark_prayer_response` |

## 4. Training / Grow

| Action | Flow |
|---|---|
| List training modules | `⚪ W:trainingModules` (reference catalog) |
| List my progress | `🔵 P:list_training_progress` |
| Toggle module complete | `🔵 P:toggle_training_module` |
| Coach view: read disciple progress | `🔵 P:get_delegated_training_progress` (cross-delegation, scope=`training_progress`) |

`coachRelationships` table is dropped. The coach-disciple link is the on-chain `COACHING_MENTORSHIP` edge; share permission is a cross-delegation grant.

## 5. Pinned Items

| Action | Flow |
|---|---|
| List my pins | `🔵 P:list_pinned_items` |
| Pin / unpin | `🔵 P:pin_item`, `unpin_item` |

## 6. Personal Notifications / Messages

| Action | Flow |
|---|---|
| List my notifications | `🔵 P:list_notifications` |
| Mark read | `🔵 P:mark_notification_read` |

When a person is the *recipient* of a system message (review received, match accepted), the writer (org-mcp action, on-chain event indexer) calls the recipient's `🔵 P:create_notification` via a system delegation token.

## 7. Org Settings (Profile, Members, Detached Members)

| Action | Flow |
|---|---|
| Read org profile | `🟢 O:get_org_profile` |
| Update org profile | `🟢 O:update_org_profile` (delegation must include `update_profile` scope) |
| List members | `🟢 O:list_members` (joins on-chain edge cache) |
| List detached members | `🟢 O:list_detached_members` |
| Add detached member | `🟢 O:add_detached_member` |

## 8. Revenue Reports / Treasury

| Action | Flow |
|---|---|
| Submit revenue report | `🟢 O:submit_revenue_report` |
| Approve / reject | `🟢 O:approve_revenue_report`, `reject_revenue_report` |
| List reports | `🟢 O:list_revenue_reports` |

Pure org-mcp. Delegation scope `revenue:write` for submit, `revenue:approve` for approve.

## 9. Governance / Proposals

| Action | Flow |
|---|---|
| Create proposal (off-chain part) | `🟢 O:create_proposal` then `⚫ C:AgentControl.propose` |
| Vote | `⚫ C:AgentControl.vote` |
| List proposals | `🟢 O:list_proposals` (joins on-chain status) |

On-chain governance state is canonical; org-mcp `proposals` table caches off-chain metadata (body, kind, evidence).

## 10. Activity Logging

| Action | Flow |
|---|---|
| Log personal activity | `🔵 P:log_activity` → updates `engagement_holder_state.capacityConsumed` if `fulfillsEntitlementId` set; emits on-chain assertion if requested |
| Log org activity | `🟢 O:log_activity` → updates `engagement_provider_state` and `work_items` if applicable |
| List my activities | `🔵 P:list_activities` |
| List org activities | `🟢 O:list_activities` |
| Activity feed for hub home | `🔵 P:list_activities` + `🟢 O:list_activities` merged in web action |

The activity → entitlement → outcome cascade stays atomic *within* a single MCP. Cross-MCP coordination uses on-chain events.

## 11. Intents / Needs / Offerings

| Action | Flow |
|---|---|
| Express personal intent (private) | `🔵 P:express_intent` writes intent + projects to needs/offerings. **No on-chain emit. No GraphDB.** |
| Express personal intent (public) | `🔵 P:express_intent` writes intent → MCP emits on-chain assertion via owner's session signer (`makeAssertion`) → on-chain → GraphDB sync indexes it |
| Express personal intent (public-coarse) | Same as public, but the on-chain assertion contains only kind + region + capacity bucket; full detail stays private in MCP |
| Express org intent | Same flows in `🟢 O` |
| Withdraw intent | `🔵 P` or `🟢 O` `withdraw_intent` → if previously public, emits on-chain `revokeAssertion` |
| List my intents | `🔵 P:list_intents` or `🟢 O:list_intents` (sees all visibilities — caller is owner) |
| Discover (search marketplace) | `🟣 G` SPARQL query against on-chain mirror only. Sees nothing private by construction. |
| Run match | `🟣 G` (matcher reads on-chain assertions). Match candidates written to caller's MCP. |

Personal intents stay in person-mcp. Org intents stay in org-mcp. **Neither MCP writes to GraphDB.** Discoverable intents are made discoverable by anchoring an on-chain assertion; the on-chain → GraphDB sync handles the rest.

## 12. Match Acceptance → Entitlement Mint

| Action | Flow |
|---|---|
| Accept match | `⚫ C:DiscoverProtocol.acceptMatch` (mints on-chain entitlement) → both sides' MCPs receive notification |
| Holder side-state initialized | `🔵 P` or `🟢 O` (whichever is holder): `init_engagement_holder_state` |
| Provider side-state initialized | `🔵 P` or `🟢 O` (whichever is provider): `init_engagement_provider_state`, plus session/tranche/policy rows as applicable |

The on-chain mint is the canonical event. Each MCP listens for the event and initializes its private side-state.

## 13. Entitlement Lifecycle

| Action | Flow |
|---|---|
| List my entitlements as holder | `⚫ C:read entitlements where holder=me` + `🔵 P` or `🟢 O` join holder side-state |
| List my entitlements as provider | `⚫ C:read entitlements where provider=me` + provider's MCP join |
| Get my work items | provider's MCP `list_work_items` |
| Resolve work item | provider's MCP `resolve_work_item` (links to `activity_log_entries.id`) |
| Close entitlement | `⚫ C:CommitmentThread.closeEngagement` (on-chain mint) |

## 14. Trust Deposits (Reviews, Skill Claims)

| Action | Flow |
|---|---|
| Submit review | `⚫ C:DelegationManager + AgentAssertion mint` (canonical) → `🟣 G` aggregate updated → recipient's `🔵 P` or `🟢 O` `create_notification` |
| Read agent's reputation | `🟣 G` SPARQL (validation profile aggregate) |
| Submit skill claim | `⚫ C:CredentialRegistry mint` → `🟣 G` aggregate updated |

No web SQL involvement. Aggregates live in GraphDB.

## 15. Hub Home / Dashboard (Composite)

The dashboard joins person + org data. After the cut:

```
GET /h/{hubId}/dashboard
  → web action calls in parallel:
    🔵 P:get_dashboard_summary (training progress, prayer counts, oikos counts)
    🟢 O:get_dashboard_summary (active engagements, pending proposals, revenue summary)
    🟣 G:SPARQL (agent counts, public intent counts, recent activity)
    ⚫ C: read on-chain stats (block count, etc.)
  → merge in API route
  → render
```

No DB JOIN across boundaries; merge happens in the web action.

## 16. Recovery / Onboarding

| Action | Flow |
|---|---|
| Enroll passkey | `⚪ W:recoveryDelegations` (bootstrap state) |
| Initiate recovery | `⚪ W:recoveryIntents` + `⚫ C` |
| Complete recovery | `⚫ C` + `⚪ W` cleanup |
| Accept invite | `⚪ W:invites` + `⚫ C` (mint membership edge) + `🟢 O:add_member` |

Stays in web SQL. Auth/recovery is the one place web SQL is authoritative.

## 17. Discover UI

```
Search → 🟣 G SPARQL (on-chain assertion mirror only — never sees MCP rows)
       → result list (public-anchored intents/offerings)
Click → 🟣 G public detail (on-chain fields only)
      → if caller has cross-delegation, web fetches private detail from owner's MCP
Match → caller emits on-chain match assertion via owner's session signer
      → on-chain → GraphDB sync indexes it
      → caller's MCP records local match metadata (private)
```

The matcher runs against `🟣 G` (which mirrors on-chain only). Matchers **never** query MCP private data. Privacy is structural: a match cannot be made against private intents because they were never published on-chain in the first place.

## 18. Agents Directory / Agent Detail

| Action | Flow |
|---|---|
| List agents | `🟣 G` (subgraph query) |
| Agent detail | `🟣 G` + `⚫ C` (live owner set) + `⚪ W` agentMetadata cache |
| Manage agent (owners, settings) | `⚫ C` writes |

No private MCP data shown on agent detail page unless caller has a delegation.

## 19. Reviews UI

| Action | Flow |
|---|---|
| List my reviews to give | `⚫ C` (where I hold REVIEWER role) |
| Submit review | `⚫ C:DelegationManager + AgentAssertion mint` |
| List reviews about me | `🟣 G` (public aggregate) + on-chain detail |

---

## Cross-MCP Coordination Summary

The three coordination patterns (none involve MCP→GraphDB writes):

1. **On-chain event → MCP listener.** Match accepted on-chain → both sides' MCPs subscribe to the chain event → each initializes its private side-state in its own DB. Engagement closure → both sides receive event → on-chain assertion emitted; on-chain → GraphDB sync handles indexing.
2. **System delegation token.** When org-mcp needs to write a notification into a person's inbox (recipient side), it uses a system-issued cross-delegation with `notifications:create` scope.
3. **On-chain assertion emit (only when row's `visibility` is public/public-coarse).** The MCP signs an assertion with the owning agent's session key and submits it to the chain. The on-chain → GraphDB sync indexes the assertion. **The MCP itself does not write to GraphDB.**
