# O6 — On-Call Rotation

> **Status**: DRAFT. **No on-call rotation today.** Alerts (where they
> exist) go to whoever is awake. Escalation is informal: someone notices
> on Slack.
>
> This document specifies the PagerDuty rotation, escalation policy,
> handoff procedure, runbook attachment, and the compensation /
> sustainability practices that keep on-call from burning out the team.
>
> **Effort**: S (≤3 days for setup) + ongoing (rotation participation).
> **Owner**: Director of Engineering + the engineer-on-rotation.
> **Depends on**: O2 (alerts come from `/ready`), O5 (tier targets set
> alert thresholds), O7 (runbook attached to every alert).
> **Unblocks**: meaningful SLA commitments to customers.

---

## 1. Today's state (honest)

| Item | Today |
|---|---|
| On-call rotation | None |
| Paging tool | None (Slack only, best-effort) |
| Escalation policy | Informal |
| Handoff procedure | None |
| Compensation | None (volunteers respond) |
| Runbook attachment | None (some runbooks exist; not linked to alerts) |
| Practice drills | None |

If a Tier 1 service goes down at 03:00 today:
1. Datadog / CloudWatch (if configured) flag the issue.
2. The flag emails the team mailbox.
3. Nobody is reading email at 03:00.
4. Service stays down until ~08:00 PT.

This is the gap O6 closes.

---

## 2. Goals

1. **Every Tier 1 alert pages a human within 60 seconds.** No alert
   sits in a queue.
2. **Acknowledgement budget ≤5 minutes.** From page to "I'm on it"
   acknowledgement. Drives the 15-min Tier 1 RTO (O5).
3. **One primary + one secondary on-call at all times.** Secondary is
   the safety net when primary is asleep, on a flight, or in the
   middle of something they can't drop in 5 min.
4. **Every alert links to a runbook.** O7 enforces this; O6 consumes it.
5. **Handoff is explicit.** No silent transitions between week N
   primary and week N+1 primary.
6. **On-call is compensated and bounded.** The rotation must be
   sustainable; an exhausted on-call is a reliability risk.

---

## 3. Roster + cadence

### 3.1 Roster

Minimum 4 engineers in the rotation. Below 4, on-call becomes 1-in-3
which research shows leads to attrition.

For Smart Agent at current team size, the rotation starts with:

| Slot | Engineer | Notes |
|---|---|---|
| 1 | Backend / a2a-agent owner | Primary expertise: signing, sessions, MAC. |
| 2 | Web / SDK owner | Primary expertise: web routes, SDK, browser issues. |
| 3 | Contracts / infra owner | Primary expertise: on-chain, KMS, Postgres. |
| 4 | Generalist / DoE | Cross-cutting; escalation point. |

As the team grows, expand to 6-8. Aim for 1-in-6 minimum.

### 3.2 Cadence

- **Shift length**: 1 week, Monday 10:00 PT → next Monday 10:00 PT.
- **Primary**: full responsibility. Phone on, laptop reachable, max
  15-min response budget.
- **Secondary**: shadow primary. Paged if primary doesn't ack within
  5 min, or if secondary's expertise is required (e.g. on-chain
  issue + secondary is the contracts owner).
- **DoE**: paged on Sev-1 + every escalation step. Not in the regular
  rotation as primary; serves as final escalation.

### 3.3 Calendar

PagerDuty schedule:

```
Week of  Primary    Secondary    DoE
2026-W21 Engineer A Engineer B   DoE
2026-W22 Engineer B Engineer C   DoE
2026-W23 Engineer C Engineer D   DoE
2026-W24 Engineer D Engineer A   DoE
```

Quarterly review: rotation order shuffled to spread expertise + avoid
sequential bad-luck (Engineer A on-call during three release weeks in
a row).

Holidays + planned PTO: swaps tracked in the team's shared calendar +
PagerDuty schedule. Swap MUST be confirmed in writing 1 week ahead;
last-minute swaps require DoE sign-off.

---

## 4. Alert routing

### 4.1 Severity classes

| Sev | Definition | Routes to |
|---|---|---|
| **Sev-1** | Tier 1 service down OR money movement broken OR security incident. | PagerDuty → primary (page) → secondary at +5 min → DoE at +15 min |
| **Sev-2** | Tier 2 service down OR significant degradation. | PagerDuty → primary (page during business hours; non-paging at night) |
| **Sev-3** | Tier 3 service down OR minor degradation. | Slack #ops-alerts (no page) |
| **Sev-4** | Informational (backup succeeded, deploy completed, etc.) | Slack #ops-deploys (no page) |

### 4.2 Examples by source

| Source | Sev | Notes |
|---|---|---|
| Tier 1 readiness probe red >10 s | 1 | O2 |
| Tier 1 synthetic-transaction failure | 1 | O1 §7 |
| Auto-rollback fired | 2 | O1 — already mitigated by rollback, but humans investigate |
| Postgres failover happened | 1 | DR1 — confirm app reconnected |
| KMS quota >80% | 1 | K3 M5 — capacity headroom evaporating |
| KMS quota >50% | 2 | Slack only at first; tighten if traffic continues to climb |
| Audit-sink unreachable >5 min | 1 | Sprint 5 P1-5 |
| Audit-sink unreachable <5 min | 2 | Transient; investigate but don't wake |
| Postgres backup failed once | 2 | DR2 |
| Postgres backup failed twice in a row | 1 | Backups are foundational |
| GraphDB outage | 3 | DR3 — degraded discovery only |
| RPO drift Tier 1 >2 min | 1 | O5 |
| RPO drift Tier 2 >30 min | 2 | O5 |
| CodeQL HIGH finding on `master` | 2 | Security review required |

### 4.3 Quiet hours

A Sev-2 alert outside business hours (Mon-Fri 09:00–18:00 PT) is
held until business hours unless:
- It graduates to Sev-1 (e.g. Tier 2 spreads to Tier 1).
- It's a security-class alert (always pages regardless of hour).
- It's a backup or audit-sink alert that has run for >2 hours.

Quiet hours are configured in PagerDuty's routing rules, not in the
alert itself — the alert's intrinsic severity doesn't change with
time of day, only the routing does.

---

## 5. Escalation policy

```
Page sent at T+0
                              ▼
Primary's phone rings, SMS, push notification
                              ▼
            ┌─── ack within 5 min ───┐
            │                        │
            ▼                        ▼
   Primary handles            T+5 min: secondary paged
                                      │
                                      ▼
                              ┌─── ack within 5 min ───┐
                              │                        │
                              ▼                        ▼
                       Secondary handles       T+15 min: DoE paged
                                                       │
                                                       ▼
                                              ┌─── ack within 10 min ───┐
                                              │                          │
                                              ▼                          ▼
                                          DoE handles      T+30 min: company-wide
                                                                       broadcast,
                                                                       war room
                                                                       opens
```

### 5.1 Acknowledgement

Acknowledging is NOT the same as resolving. Ack = "I see this, I'm
working on it." Resolving = "the alert is no longer firing AND the
underlying cause is addressed (or has a tracking issue)."

Time-to-ack matters because it bounds RTO. Time-to-resolve matters
because it bounds MTTR.

### 5.2 War room

A Sev-1 that's still active at T+30 min opens a war room:
- Slack channel: `#incident-<short-id>`.
- Zoom / Meet bridge: posted in the channel.
- Incident commander assigned (typically DoE; can delegate to a
  trained engineer).
- Status updates every 15 min to `#announcements`.
- External status page (Better Uptime; OQ-O5-3) updated.

Templates: `docs/runbooks/incident-war-room.md`.

---

## 6. Handoff procedure

Every Monday at 10:00 PT, outgoing primary hands off to incoming
primary. 15-min meeting.

### 6.1 Handoff checklist

`docs/runbooks/oncall-handoff.md`:

1. **Open incidents**: incoming primary reads each open incident; outgoing
   primary briefs on context, theories, blockers.
2. **Open PagerDuty alerts**: any unresolved alerts that don't merit a
   full incident (e.g. flapping alert with workaround applied).
3. **Recent deploys**: what shipped this week; what's at risk; any
   feature flags rolled forward.
4. **Active feature flags**: incoming primary should know which flags
   are mid-rollout (O10).
5. **DR drill**: if a drill is scheduled this coming week, who's
   running it.
6. **Vendor-side events**: known upstream issues (AWS health dashboard,
   Vercel status, etc.).
7. **Personal availability**: any windows where incoming primary
   can't be reachable; arrange secondary coverage.

### 6.2 Handoff artifact

A `oncall-handoff-YYYY-MM-DD.md` written collaboratively during the
meeting, committed to `output/oncall/`. Past handoffs serve as a
training corpus + retrospective input.

---

## 7. Runbook attachment

Every alert MUST link to a runbook. O7 enforces this via a CI guard;
O6 specifies what the runbook contains:

| Section | Content |
|---|---|
| **Symptom** | Exact alert text + dashboard URL + what the user sees. |
| **Diagnose** | First 3 commands / queries to run. |
| **Mitigate** | Fastest known mitigation (may not be root-cause fix). |
| **Resolve** | Steps to root-cause + permanent fix. |
| **Verify** | How to confirm the alert won't re-fire. |
| **Escalate** | When to bring in secondary / DoE. |
| **Postmortem trigger** | Was this Sev-1 or did it consume >25% of an error budget? If so, postmortem required. |

PagerDuty alert payload includes the runbook URL. On-call clicks
through within their first response minute.

---

## 8. Compensation + sustainability

### 8.1 Compensation

- Base salary covers on-call participation as part of the engineer's
  role (US-standard practice; document in the offer letter).
- On-call shift premium: **$200 / week** as a non-discretionary cash
  bonus. Increases by $50 per actually-paged-and-acked incident
  >Sev-3 (paid quarterly).
- Adjust for the specific market the company hires in; defer to the
  Head of People for exact numbers.

### 8.2 Sustainability rules

| Rule | Rationale |
|---|---|
| **No two consecutive on-call weeks**. | Burnout prevention. |
| **Paged after 22:00 → next-day morning off**. | Sleep matters. |
| **>3 pages in a single shift → "incident week" review with DoE**. | If a shift is alert-flooded, something's broken upstream (alerts too noisy, system actually degraded). Triggers an "alert hygiene" review. |
| **PagerDuty fatigue metric tracked**. | If an engineer is paged >2× / quarter outside business hours, the system needs fixing — not the engineer needing toughening up. |
| **Vacation freezes shift premiums**. | An engineer on PTO isn't on-call; coverage is owned by the rotation manager. |

### 8.3 Onboarding to the rotation

New engineers do NOT go on primary on-call for 90 days. During that
window:
- Shadow weeks: pair with primary; receive every page but no
  responsibility to act.
- Runbook practice: walk through every Tier 1 runbook in a non-incident
  setting.
- Two DR drills observed.

After 90 days + observed competence + the DoE's sign-off, the
engineer joins the primary rotation.

---

## 9. Postmortems

Every Sev-1 incident gets a postmortem. Sev-2 gets one if it consumed
>25% of an error budget.

### 9.1 Format (blameless)

`docs/postmortems/YYYY-MM-DD-<short-slug>.md`:

1. **Summary**: 1-paragraph what happened, when, who was affected.
2. **Timeline**: timestamped sequence of events.
3. **Detection**: how did we find out? Was it fast enough?
4. **Response**: what worked, what didn't.
5. **Root cause(s)**: 5-whys analysis. Often multiple causes.
6. **Action items**: filed as GitHub issues with `postmortem-action`
   label. Each AI has owner + due date.
7. **Lessons**: distilled learning for the team.

### 9.2 Cadence

- Draft within 5 business days of resolution.
- Reviewed at the next weekly engineering meeting.
- Action items prioritised against the active sprint.

### 9.3 Blameless

The postmortem MUST be blameless. Naming individuals is acceptable;
blaming them is not. The system permitted the incident — what about
the system must change?

---

## 10. Files to create/change

### New

- `docs/runbooks/oncall-handoff.md` — handoff checklist.
- `docs/runbooks/incident-war-room.md` — war-room template.
- `docs/postmortems/README.md` — index + blameless ground rules.
- `docs/postmortems/_template.md` — postmortem template.
- `infra/pagerduty/schedules.tf` — Terraform: schedules, escalation
  policies, services.
- `infra/pagerduty/services.tf` — one PagerDuty "service" per Smart
  Agent service; alert routing wired here.
- `infra/datadog/monitor-to-pagerduty.tf` — Datadog → PagerDuty
  integration.

### Changed

- `docs/security/operations/README.md` — add link to O6.
- Existing runbooks gain the "Symptom / Diagnose / Mitigate / Resolve
  / Verify / Escalate / Postmortem trigger" structure.

---

## 11. Cost

| Item | Cost |
|---|---|
| PagerDuty Business plan (4 users initially) | $84/user/mo × 4 = $336/mo. Plus DoE seat = $420/mo. |
| Better Uptime / status page | $30/mo |
| On-call shift premium | $200/week × 52 weeks × 1 primary = $10,400/yr |
| Incident bonus (estimate 4 pages/yr) | $50 × 4 = $200/yr |

Total recurring: ~$5,500/yr cash + $10,400 on-call premium = ~$15,900/yr.

---

## 12. Acceptance criteria

- [ ] PagerDuty schedule exists with 4+ engineers + DoE in escalation.
- [ ] Every alert in O5 §7.3 routes to PagerDuty with the right
      severity.
- [ ] Every alert payload includes a runbook URL (per O7).
- [ ] Acknowledgement time SLO: 5 min for Sev-1; tracked in Datadog.
- [ ] Quarterly review of rotation order + handoff quality is in the
      DoE's calendar.
- [ ] First DR drill (per O5 §8) has an on-call engineer running it.
- [ ] Onboarding plan is documented; first new hire follows the 90-day
      shadow path before going primary.

---

## 13. Test plan

### 13.1 Pre-production drill

Before any production traffic:

1. Generate a synthetic Sev-1 page via `pd-cli trigger-incident
   --service a2a-agent --severity sev-1`.
2. Confirm primary receives the page within 60 s.
3. Primary acks; confirm logged in PagerDuty.
4. Confirm secondary did NOT receive a page (since primary acked
   within 5 min).
5. Trigger again, deliberately NOT ack; confirm secondary receives
   page at T+5 min.

### 13.2 Quarterly fire drill

Every quarter, the DoE triggers an unplanned Sev-1 drill (real alert,
known-good system). Measures acknowledgement time, escalation
behavior, handoff communication. Reported in `output/oncall-drill-YYYY-
QN.md`.

---

## 14. Rollback

The rotation cannot be "rolled back" — once we commit to on-call, the
question is only how many engineers participate. Scale the rotation up
or down by hiring or by tightening severity classes (fewer Sev-1s).

---

## 15. Open questions

- **OQ-O6-1**: Do we extend the rotation to weekends-on-call or
  separate weekday vs weekend rotations? Proposed: weekly shift covers
  weekends; weekend pages count toward the "next-day off" rule + the
  shift premium.
- **OQ-O6-2**: Is PagerDuty the right tool vs OpsGenie / Datadog
  on-call? Proposed: PagerDuty for incumbency + integration ecosystem;
  re-evaluate at 12 engineers.
- **OQ-O6-3**: How do we handle "follow the sun" once the team is
  globally distributed? Proposed: deferred until the team is in 3+
  time zones; today PT-only is acceptable.
- **OQ-O6-4**: Should DoE participate in primary rotation? Proposed:
  no — DoE handles escalation + the cross-cutting incidents the team
  can't resolve. DoE shadowing the rotation periodically (1 week / year)
  is healthy.
- **OQ-O6-5**: How do we differentiate "real incident" from "alert
  storm during a deploy" for fatigue accounting? Proposed: any alert
  that fired during an active deploy window AND was resolved by the
  deploy's auto-rollback (O1) counts as 0 pages for fatigue
  accounting. Real-incident pages do count.
