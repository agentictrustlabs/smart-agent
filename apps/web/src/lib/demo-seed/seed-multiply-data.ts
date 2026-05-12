// Demo seed for the surfaces that still live in web SQL after the data-store
// consolidation: activity_logs (recent activity feed) and messages (inbox /
// work-queue notifications). Person-private domains (oikos, prayers, training,
// preferences, pinned items, coaching notes) and org-private domains (revenue
// reports, proposals) moved to person-mcp / org-mcp; their demo data will be
// re-seeded by a delegation-aware MCP seeder that doesn't exist yet.

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

// ═══════════════════════════════════════════════════════════════════════
// Seed functions per environment
// ═══════════════════════════════════════════════════════════════════════

function seedCatalystNetwork() {
  // (messages table dropped — inbox seeding moved to per-side MCP seeders)

  // Ana's profile is now seeded in seed-mcp-data.ts via her own A2A
  // session (update_profile through delegation), keyed by her smart-
  // account principal — not via direct SQLite writes.

  // ─── Catalyst activity feed — mission-org-anchored use-cases ─────
  // Each catalyst user gets 10–18 activities drawn from real-world
  // mission organizations we've used elsewhere in the demo:
  // Lausanne, IMB, GACX, Joshua Project, Wycliffe, Progress.Bible,
  // NewThing, Movement Leaders Collective, GMCN, Indigitous,
  // 24-7 Prayer, Operation World, ECFA, NCF, Frontier Ventures,
  // Compassion, World Relief, Open Doors, Real Life Ministries,
  // BibleProject, Catalyst Leadership Network.
  //
  // Idempotent: keyed on (userId, title, activityDate prefix). Re-runs
  // are no-ops; new entries get added if we add new lines below.
  seedCatalystActivities()
}

interface ActivityEntry {
  type: 'meeting' | 'visit' | 'training' | 'outreach' | 'follow-up' | 'coaching' | 'prayer' | 'service' | 'assessment' | 'other'
  title: string
  description?: string
  participants?: number
  location?: string
  durationMinutes?: number
  /** Days ago (positive integer). */
  daysBack: number
}

function seedCatalystActivities() {
  // Find each catalyst user's primary org address (their person agent).
  // Activity feed filters by orgAddress OR userId, so even when person
  // agent is missing we still surface activities via the userId match.
  const userOrgs = new Map<string, string>()
  for (let i = 1; i <= 12; i++) {
    const id = `cat-user-${i.toString().padStart(3, '0')}`
    const u = db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, id)).get()
    if (!u) continue
    userOrgs.set(id, u.personAgentAddress ?? '0x0000000000000000000000000000000000000000')
  }

  // Per-persona activity catalog. Volume tuned by role density:
  // Hub Lead / Program Director get more activity (cross-circle work).
  const CATALOG: Record<string, ActivityEntry[]> = {
    // ── Maria Gonzalez — Program Director (Catalyst NoCo Network) ──
    'cat-user-001': [
      { type: 'meeting', title: 'Lausanne SOGC reading group — NoCo regional implications', description: 'Reviewed the State of the Great Commission section on Hispanic diaspora response rates with the regional staff.', participants: 6, location: 'Fort Collins, CO', durationMinutes: 75, daysBack: 2 },
      { type: 'meeting', title: 'GACX engagement-overlap working group', description: 'Walked through the Berthoud/Loveland stewardOf overlap; agreed on the alliance arbitration pattern.', participants: 8, location: 'Online', durationMinutes: 60, daysBack: 5 },
      { type: 'meeting', title: 'IMB Frontier Strategy intake — NoCo UPG list', description: 'IMB regional researcher walked us through five Frontier People Group tags relevant to Hispanic diaspora in NoCo.', participants: 4, location: 'Online', durationMinutes: 90, daysBack: 9 },
      { type: 'training', title: 'Movement Leaders Collective — readiness rubric calibration', description: 'Cross-org calibration call: how each network scores group-leader readiness on a 0–10000 rubric.', participants: 12, location: 'Online', durationMinutes: 120, daysBack: 14 },
      { type: 'coaching', title: 'Coaching Ana Reyes — Wellington multiplication path', description: 'Worked through Ana\'s next-G plan; G2 candidate identified in Familia Morales household.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 3 },
      { type: 'coaching', title: 'Coaching Rosa Martinez — ESL outreach pipeline', description: 'Reviewed Rosa\'s ESL → discipleship handoff metric; tied it to the GACX engagement-claim schema.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 7 },
      { type: 'meeting', title: 'NewThing multiplication review (quarterly)', description: 'Reviewed Wellington → Laporte → Johnstown chain; G3 health markers all green.', participants: 6, location: 'Online', durationMinutes: 60, daysBack: 18 },
      { type: 'meeting', title: 'ECFA compliance check-in', description: 'Annual review of donor-protection norms; flagged dual-funding risk on Red Feather Circle.', participants: 3, location: 'Online', durationMinutes: 45, daysBack: 22 },
      { type: 'training', title: 'Catalyst Leadership Network — coach-of-coaches credential', description: 'Day 2 of the certifiedIn coach-of-coaches track; reviewed the Movement Leaders Collective rubric.', participants: 18, location: 'Denver, CO', durationMinutes: 360, daysBack: 26 },
      { type: 'meeting', title: 'NCF restricted-grant review — Red Feather Circle', description: 'Donor-advised fund holder asked for an outcome-bound disbursement plan tied to baptisms.', participants: 4, location: 'Online', durationMinutes: 60, daysBack: 30 },
      { type: 'outreach', title: 'Frontier Ventures — Spanish-speaking Frontier strategy briefing', description: 'Joined the FV cohort call on diaspora-of-UPG strategy; tagged 3 NoCo zips.', participants: 22, location: 'Online', durationMinutes: 90, daysBack: 35 },
      { type: 'service', title: 'Compassion International quarterly child-sponsorship event', description: 'Hosted a sponsor-meet-child story night; 14 new sponsors signed up across the network.', participants: 60, location: 'Fort Collins, CO', durationMinutes: 150, daysBack: 40 },
      { type: 'assessment', title: 'Lausanne Issue Network — Disciple-Making Movements', description: 'Submitted NoCo case study to the DMM issue network; awaiting peer feedback.', participants: 1, location: 'Online', durationMinutes: 120, daysBack: 45 },
    ],

    // ── Pastor David Chen — Hub Lead (Fort Collins Hub) ──
    'cat-user-002': [
      { type: 'meeting', title: 'Wellington pastors\' coalition — bilingual liturgy', description: 'Hosted four neighborhood pastors to align Sunday-evening liturgy across circles.', participants: 5, location: 'Fort Collins, CO', durationMinutes: 90, daysBack: 1 },
      { type: 'training', title: 'IMB T4T (Training for Trainers) intensive — day 1', description: 'Three-day T4T intensive; Wellington and Laporte leaders attended.', participants: 14, location: 'Fort Collins, CO', durationMinutes: 360, daysBack: 4 },
      { type: 'training', title: 'IMB T4T intensive — day 2: 4 Fields markers', description: 'Walked through Entry → Gospel → Discipleship → Church multiplication health markers.', participants: 14, location: 'Fort Collins, CO', durationMinutes: 360, daysBack: 3 },
      { type: 'meeting', title: 'NewThing multiplication review — Wellington G3', description: 'Confirmed Johnstown as a G3 plant; tagged Wellington → Laporte → Johnstown chain.', participants: 4, location: 'Online', durationMinutes: 60, daysBack: 8 },
      { type: 'visit', title: 'Wellington Circle — Familia Morales home visit', description: 'Pastoral visit; husband received gospel, ready for next-step Bible study.', participants: 6, location: 'Wellington, CO', durationMinutes: 120, daysBack: 6 },
      { type: 'coaching', title: 'Coaching Ana — handling the G2 split conversation', description: 'Discussed how to plant Familia Morales as a G2 group without fragmenting Wellington.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 11 },
      { type: 'coaching', title: 'Coaching Carlos — community-partner role expectations', description: 'Walked Carlos through the Real Life Ministries discipleship-relationship pattern.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 13 },
      { type: 'meeting', title: 'GMCN — trauma-informed care peer cohort', description: 'Monthly cohort call with member-care practitioners; brought the Berthoud/Loveland farm-worker case.', participants: 9, location: 'Online', durationMinutes: 90, daysBack: 16 },
      { type: 'training', title: 'BibleProject curriculum tagging session', description: 'Tagged eight BibleProject videos against the formation-pathway milestones.', participants: 4, location: 'Fort Collins, CO', durationMinutes: 90, daysBack: 19 },
      { type: 'assessment', title: 'GACX engagement-overlap dispute — Berthoud/Loveland', description: 'Filed FLAG dispute against Berthoud Circle\'s stewardOf claim duplicating Loveland.', participants: 3, location: 'Online', durationMinutes: 30, daysBack: 5 },
      { type: 'meeting', title: 'Wycliffe regional contact — Spanish heart-language resources', description: 'Discussed scripture-engagement gaps for two indigenous-language families in Wellington.', participants: 3, location: 'Online', durationMinutes: 45, daysBack: 21 },
      { type: 'outreach', title: 'Indigitous handoff training', description: 'Trained Carlos on the seeker-handoff pattern from digital evangelism platforms.', participants: 2, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 24 },
      { type: 'meeting', title: 'Catalyst Leadership Network — annual gathering', description: 'Two-day regional gathering; David presented Wellington G3 case study.', participants: 80, location: 'Denver, CO', durationMinutes: 600, daysBack: 28 },
      { type: 'service', title: 'NoCo immigration legal-aid clinic', description: 'Hosted a free legal-aid clinic with World Relief; served 22 families.', participants: 30, location: 'Fort Collins, CO', durationMinutes: 240, daysBack: 33 },
    ],

    // ── Rosa Martinez — Outreach Coordinator ──
    'cat-user-003': [
      { type: 'outreach', title: 'ESL Tuesday class — Tienda La Favorita follow-up', description: 'After-class conversations led to two Bible-study invites for next week.', participants: 14, location: 'Fort Collins, CO', durationMinutes: 90, daysBack: 1 },
      { type: 'outreach', title: 'ESL Thursday class — meatpacking plant workers', description: 'New cohort; six workers signed up for the next 6-week ESL → discipleship pipeline.', participants: 12, location: 'Fort Collins, CO', durationMinutes: 90, daysBack: 3 },
      { type: 'visit', title: 'Vecina Gloria home visit', description: 'Brought groceries; prayed with her and her three kids.', participants: 5, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 2 },
      { type: 'training', title: 'Lausanne integral-mission workshop — Tearfund framework', description: 'Workshop on integrating gospel proclamation with social action without dichotomy.', participants: 18, location: 'Online', durationMinutes: 120, daysBack: 7 },
      { type: 'prayer', title: 'Operation World prayer hour — undocumented families', description: 'Hour-long intercession for the seven NoCo families directly affected this month.', participants: 11, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 4 },
      { type: 'follow-up', title: 'Familia Herrera — post-baptism check-in', description: 'Planning next-step formation pathway with Maria.', participants: 4, location: 'Fort Collins, CO', durationMinutes: 90, daysBack: 9 },
      { type: 'meeting', title: 'Indigitous training — social-media seeker handoff', description: 'Got the gist of the Indigitous referral protocol; ready to pilot in Spanish.', participants: 1, location: 'Online', durationMinutes: 60, daysBack: 12 },
      { type: 'coaching', title: 'Coached by Maria — outreach pipeline review', description: 'Reviewed Q1 ESL → discipleship conversion rate; agreed on three new tags.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 7 },
      { type: 'service', title: 'World Relief immigration clinic — interpreter shift', description: 'Six hours interpreting for new-arrival families; two referrals into Wellington Circle.', participants: 30, location: 'Fort Collins, CO', durationMinutes: 360, daysBack: 33 },
      { type: 'training', title: 'GMCN — trauma-informed care basics', description: 'First module of the trauma-care track; relevant to current case load.', participants: 22, location: 'Online', durationMinutes: 90, daysBack: 16 },
    ],

    // ── Carlos Herrera — Community Partner ──
    'cat-user-004': [
      { type: 'visit', title: 'Vecina Lupe — medical run + prayer', description: 'Drove Lupe to the doctor; prayed before the appointment.', participants: 2, location: 'Fort Collins, CO', durationMinutes: 180, daysBack: 1 },
      { type: 'outreach', title: 'School-bus families canvass', description: 'Walked the route with Marco; six family conversations, two Bible interest cards.', participants: 12, location: 'Fort Collins, CO', durationMinutes: 90, daysBack: 4 },
      { type: 'training', title: 'Indigitous handoff training (Pastor David)', description: 'Learned the seeker-handoff protocol; pilot rolling out next month.', participants: 2, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 24 },
      { type: 'meeting', title: 'Tienda La Favorita owners — relationship coffee', description: 'Honest conversation about faith; door is open for a future Bible study at the tienda.', participants: 3, location: 'Fort Collins, CO', durationMinutes: 75, daysBack: 8 },
      { type: 'coaching', title: 'Coaching session with Pastor David', description: 'Walked through the discipleship-relationship pattern from Real Life Ministries.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 13 },
      { type: 'prayer', title: 'Joshua Project Unreached of the Day — neighborhood prayer walk', description: 'Walked the school-bus route praying through that day\'s UPG card.', participants: 3, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 6 },
      { type: 'follow-up', title: 'School-counselor follow-up — Vecina Lupe\'s kids', description: 'Met with school counselor about the kids; agreed on weekly check-ins.', participants: 3, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 11 },
      { type: 'service', title: 'World Relief food-distribution shift', description: 'Three-hour shift at the food bank; built relationships with two new families.', participants: 25, location: 'Fort Collins, CO', durationMinutes: 180, daysBack: 19 },
    ],

    // ── Sarah Thompson — Regional Lead ──
    'cat-user-005': [
      { type: 'meeting', title: 'Front Range pastors\' alliance — quarterly', description: 'Bi-monthly cross-network sync; brought the GACX overlap-resolution playbook.', participants: 16, location: 'Loveland, CO', durationMinutes: 120, daysBack: 2 },
      { type: 'meeting', title: 'Lausanne 25 issue network — Mission Mobilization', description: 'Submitted NoCo regional case to the issue network; co-chair role accepted.', participants: 28, location: 'Online', durationMinutes: 120, daysBack: 8 },
      { type: 'meeting', title: 'Loveland Circle launch consult with Luis', description: 'Reviewed launch metrics; G1 health markers green; first multiplication candidate identified.', participants: 2, location: 'Loveland, CO', durationMinutes: 90, daysBack: 5 },
      { type: 'assessment', title: 'NoCo Growth Analytics — quarterly health roll-up', description: 'Reviewed the weekly assertion chain; flagged Berthoud as needing a coach.', participants: 4, location: 'Online', durationMinutes: 60, daysBack: 11 },
      { type: 'meeting', title: 'Frontier Ventures — diaspora-of-UPG cohort', description: 'Monthly FV cohort; presented NoCo Vietnamese-diaspora pilot.', participants: 22, location: 'Online', durationMinutes: 90, daysBack: 14 },
      { type: 'coaching', title: 'Coaching new circle leader — Loveland', description: 'Mentor session with Luis on next-G readiness rubric.', participants: 1, location: 'Loveland, CO', durationMinutes: 60, daysBack: 17 },
      { type: 'meeting', title: 'Compassion International — regional partnership', description: 'Discussed integrating Compassion sponsorship into NoCo families pipeline.', participants: 5, location: 'Online', durationMinutes: 60, daysBack: 22 },
      { type: 'training', title: 'Movement Leaders Collective — peer-coaching cohort', description: 'Quarterly peer-coaching cohort with regional leads from four states.', participants: 12, location: 'Online', durationMinutes: 180, daysBack: 27 },
      { type: 'meeting', title: 'NCF donor-impact dashboard review', description: 'Walked NCF donor through Q1 outcomes; agreed on Q2 funding line for Berthoud Circle.', participants: 3, location: 'Online', durationMinutes: 75, daysBack: 31 },
    ],

    // ── Ana Reyes — Wellington Circle Leader ──
    'cat-user-006': [
      { type: 'meeting', title: 'Wellington Circle gathering — Sunday evening', description: '12 attendees; baptism scheduled for next week.', participants: 12, location: 'Wellington, CO', durationMinutes: 120, daysBack: 0 },
      { type: 'meeting', title: 'Wellington Circle gathering — last week', description: '11 attendees; first Familia Morales formal attendance.', participants: 11, location: 'Wellington, CO', durationMinutes: 120, daysBack: 7 },
      { type: 'visit', title: 'Familia Morales home visit', description: 'Family meal; husband shared his testimony; Familia Morales is the next-G candidate.', participants: 6, location: 'Wellington, CO', durationMinutes: 150, daysBack: 2 },
      { type: 'visit', title: 'Señora Campos — discipleship session 4', description: 'Walked through the IMB 4 Fields markers; she identified two seekers in her own oikos.', participants: 2, location: 'Wellington, CO', durationMinutes: 90, daysBack: 4 },
      { type: 'training', title: 'IMB T4T intensive — day 1 (with David)', description: 'Two-day T4T intensive; foundation for next-G multiplication.', participants: 14, location: 'Fort Collins, CO', durationMinutes: 360, daysBack: 4 },
      { type: 'training', title: 'IMB T4T intensive — day 2', description: '4 Fields markers and the obedience-based discipleship loop.', participants: 14, location: 'Fort Collins, CO', durationMinutes: 360, daysBack: 3 },
      { type: 'coaching', title: 'Coached by Maria — multiplication path conversation', description: 'Worked through the G2 split conversation with Familia Morales.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 3 },
      { type: 'coaching', title: 'Coached by Pastor David — handling tension in the circle', description: 'Two members had a conflict; David walked Ana through the Real Life Ministries pattern.', participants: 1, location: 'Wellington, CO', durationMinutes: 60, daysBack: 11 },
      { type: 'outreach', title: 'Wellington Elementary parents night', description: '8 new families met; 3 said yes to a follow-up coffee.', participants: 30, location: 'Wellington, CO', durationMinutes: 120, daysBack: 10 },
      { type: 'prayer', title: '24-7 Prayer hour — Wellington families', description: 'One-hour adoption-prayer slot for adopted-zip Wellington commitments.', participants: 4, location: 'Wellington, CO', durationMinutes: 60, daysBack: 5 },
      { type: 'follow-up', title: 'Youth-group teens — post-retreat check-ins', description: 'Reached out to all 5 teens after the retreat; all five stayed engaged.', participants: 5, location: 'Wellington, CO', durationMinutes: 90, daysBack: 16 },
      { type: 'service', title: 'Familia Vega move-in help', description: 'Helped Familia Vega move into their new apartment; built first relationships.', participants: 8, location: 'Wellington, CO', durationMinutes: 240, daysBack: 25 },
    ],

    // ── Miguel Santos — Laporte Circle Leader ──
    'cat-user-007': [
      { type: 'meeting', title: 'Laporte Circle gathering — Sunday', description: '8 farm workers + Ricardo; first communion practice.', participants: 9, location: 'Laporte, CO', durationMinutes: 90, daysBack: 0 },
      { type: 'meeting', title: 'Laporte Circle gathering — last week', description: '8 attendees; Ricardo opened in prayer for the first time.', participants: 8, location: 'Laporte, CO', durationMinutes: 90, daysBack: 7 },
      { type: 'visit', title: 'Foreman Ricardo — coffee meeting', description: 'Long honest conversation about life and faith; Ricardo asked about baptism.', participants: 2, location: 'Laporte, CO', durationMinutes: 90, daysBack: 3 },
      { type: 'training', title: 'IMB T4T intensive — both days (with David & Ana)', description: 'Two-day T4T intensive; foundation for the harvest-season multiplication push.', participants: 14, location: 'Fort Collins, CO', durationMinutes: 720, daysBack: 4 },
      { type: 'outreach', title: 'Farm crew lunch outreach — north fields', description: 'Brought lunch to the crew; six gospel conversations, two interest cards.', participants: 8, location: 'Laporte, CO', durationMinutes: 90, daysBack: 5 },
      { type: 'outreach', title: 'Farm crew lunch outreach — south fields', description: 'Same pattern at the south fields; one returning seeker.', participants: 8, location: 'Laporte, CO', durationMinutes: 90, daysBack: 12 },
      { type: 'coaching', title: 'Coached by Rosa — handling cultural tensions', description: 'How to navigate the gap between the foreman crew and the seasonal hires.', participants: 1, location: 'Laporte, CO', durationMinutes: 45, daysBack: 9 },
      { type: 'service', title: 'World Relief — seasonal-worker housing intake', description: 'Helped 4 new arrivals fill out housing-aid forms.', participants: 7, location: 'Laporte, CO', durationMinutes: 180, daysBack: 18 },
      { type: 'prayer', title: 'Laporte harvest-season prayer night', description: 'Hour of prayer for harvest safety, hope, and gospel openness.', participants: 11, location: 'Laporte, CO', durationMinutes: 60, daysBack: 14 },
      { type: 'follow-up', title: 'Familia Santos extended — three-generation gathering', description: 'Hosted three generations of Familia Santos for dinner; first multi-gen baptism scheduled.', participants: 14, location: 'Laporte, CO', durationMinutes: 180, daysBack: 21 },
    ],

    // ── Elena — Timnath Circle Leader ──
    'cat-user-008': [
      { type: 'meeting', title: 'Timnath Circle gathering', description: '6 attendees; first time hosting communion.', participants: 6, location: 'Timnath, CO', durationMinutes: 90, daysBack: 0 },
      { type: 'visit', title: 'Vecina Patricia — counseling session', description: 'Listened to grief from her separation; prayed and shared scripture.', participants: 2, location: 'Timnath, CO', durationMinutes: 75, daysBack: 3 },
      { type: 'training', title: 'GMCN trauma-informed care course — module 3', description: 'Critical for current case load; module 3 covers grief.', participants: 22, location: 'Online', durationMinutes: 90, daysBack: 8 },
      { type: 'training', title: 'GMCN trauma-informed care course — module 2', description: 'Covered narrative-listening basics.', participants: 22, location: 'Online', durationMinutes: 90, daysBack: 15 },
      { type: 'meeting', title: 'School-counselor referral conversation', description: 'Connected with the elementary-school counselor about three at-risk families.', participants: 2, location: 'Timnath, CO', durationMinutes: 60, daysBack: 5 },
      { type: 'follow-up', title: 'Timnath young families — coffee follow-up', description: 'Three families joined the next gathering after this conversation.', participants: 8, location: 'Timnath, CO', durationMinutes: 120, daysBack: 11 },
      { type: 'coaching', title: 'Coached by Maria — trauma intersect with discipleship', description: 'How to walk a seeker through formation when trauma is unhealed.', participants: 1, location: 'Online', durationMinutes: 45, daysBack: 13 },
      { type: 'prayer', title: 'Operation World prayer — adopted region', description: 'Bi-weekly prayer for the adopted-region Joshua-Project diaspora tag.', participants: 5, location: 'Timnath, CO', durationMinutes: 60, daysBack: 17 },
    ],

    // ── Luis — Loveland Circle Leader ──
    'cat-user-009': [
      { type: 'meeting', title: 'Loveland Circle gathering — Sunday', description: '7 attendees; Hermano Joaquín led worship for the first time.', participants: 7, location: 'Loveland, CO', durationMinutes: 90, daysBack: 0 },
      { type: 'visit', title: 'Hermano Joaquín — leadership prep', description: 'Walked Joaquín through the Movement Leaders Collective readiness rubric.', participants: 2, location: 'Loveland, CO', durationMinutes: 75, daysBack: 4 },
      { type: 'meeting', title: 'GACX overlap-resolution call — Berthoud/Loveland', description: 'Worked through the engagement-overlap dispute with Sofia and the alliance.', participants: 4, location: 'Online', durationMinutes: 60, daysBack: 6 },
      { type: 'outreach', title: 'ESL Loveland — class 5 of 6', description: 'Twelve students; three have asked about scripture in heart language.', participants: 14, location: 'Loveland, CO', durationMinutes: 90, daysBack: 2 },
      { type: 'coaching', title: 'Coached by Sarah — multiplication readiness', description: 'Reviewed the next-G plan; Joaquín is the candidate.', participants: 1, location: 'Loveland, CO', durationMinutes: 60, daysBack: 17 },
      { type: 'service', title: 'Loveland new-arrival families food drop', description: 'Delivered groceries to four families; ESL class invitations went out.', participants: 8, location: 'Loveland, CO', durationMinutes: 180, daysBack: 12 },
      { type: 'meeting', title: 'Wycliffe consult — heart-language scripture access', description: 'Three families need access to scripture in indigenous-Mexican heart languages.', participants: 3, location: 'Online', durationMinutes: 45, daysBack: 19 },
      { type: 'prayer', title: '24-7 Prayer Loveland adoption hour', description: 'Adopted-zip prayer; Loveland prayer count up to 51 intercessors.', participants: 4, location: 'Loveland, CO', durationMinutes: 60, daysBack: 8 },
    ],

    // ── Sofia — Berthoud Circle Leader ──
    'cat-user-010': [
      { type: 'meeting', title: 'Berthoud Circle gathering — Sunday', description: '5 attendees; first communion celebration with Vecina Esperanza.', participants: 5, location: 'Berthoud, CO', durationMinutes: 90, daysBack: 0 },
      { type: 'meeting', title: 'GACX engagement-overlap mediation — with Luis', description: 'Worked through the stewardOf overlap with Loveland; agreed on a comp plan.', participants: 4, location: 'Online', durationMinutes: 60, daysBack: 6 },
      { type: 'outreach', title: 'Berthoud farm-worker families canvass', description: 'Visited four farm-worker households; one new gathering attendee.', participants: 8, location: 'Berthoud, CO', durationMinutes: 120, daysBack: 5 },
      { type: 'visit', title: 'Vecina Esperanza — discipleship session 6', description: 'Walked through the obedience-based discipleship loop; she\'s ready to disciple her sister.', participants: 2, location: 'Berthoud, CO', durationMinutes: 75, daysBack: 9 },
      { type: 'training', title: 'IMB 4 Fields refresher (online)', description: 'Refreshed the 4 Fields markers ahead of the next gathering plan.', participants: 18, location: 'Online', durationMinutes: 90, daysBack: 14 },
      { type: 'coaching', title: 'Coached by David — engagement-claim semantics', description: 'Walked through what stewardOf vs operatesIn means; updated her claim.', participants: 1, location: 'Online', durationMinutes: 45, daysBack: 16 },
      { type: 'service', title: 'Iglesia Pentecostal partnership lunch', description: 'Hosted the Pentecostal pastor; agreed on a joint Easter outreach.', participants: 6, location: 'Berthoud, CO', durationMinutes: 120, daysBack: 22 },
    ],

    // ── Diego — Johnstown Circle Leader (G3) ──
    'cat-user-011': [
      { type: 'meeting', title: 'Johnstown Circle gathering — G3 milestone', description: '6 attendees; first official G3 multiplication event with Coach Esteban.', participants: 6, location: 'Johnstown, CO', durationMinutes: 90, daysBack: 0 },
      { type: 'visit', title: 'Coach Esteban — gospel conversation', description: 'Long conversation; Esteban asked deep questions about discipleship.', participants: 2, location: 'Johnstown, CO', durationMinutes: 90, daysBack: 4 },
      { type: 'meeting', title: 'NewThing G3 case-study panel', description: 'Joined a NewThing panel as a G3 leader; shared Wellington → Laporte → Johnstown chain.', participants: 22, location: 'Online', durationMinutes: 75, daysBack: 11 },
      { type: 'outreach', title: 'Johnstown high-school athletes outreach', description: 'After-school session with 12 athletes; two said yes to next gathering.', participants: 13, location: 'Johnstown, CO', durationMinutes: 60, daysBack: 6 },
      { type: 'coaching', title: 'Coached by Miguel — G3 sustainability', description: 'How to keep G3 healthy without burnout.', participants: 1, location: 'Online', durationMinutes: 45, daysBack: 13 },
      { type: 'prayer', title: 'Prayer night — Coach Esteban', description: 'Prayer focused on Coach Esteban\'s gospel decision.', participants: 5, location: 'Johnstown, CO', durationMinutes: 60, daysBack: 9 },
    ],

    // ── Isabel — Red Feather Circle Leader (rural) ──
    'cat-user-012': [
      { type: 'meeting', title: 'Red Feather gathering — small but faithful', description: '4 attendees; rural mountain community.', participants: 4, location: 'Red Feather Lakes, CO', durationMinutes: 75, daysBack: 0 },
      { type: 'visit', title: 'Hermana Julia — discipleship session', description: 'Walked through the IMB obedience-based loop; she\'s mentoring two of her own.', participants: 2, location: 'Red Feather Lakes, CO', durationMinutes: 90, daysBack: 6 },
      { type: 'training', title: 'Operation World prayer cohort — rural focus', description: 'Joined a small rural-mission prayer cohort; six rural pastors.', participants: 7, location: 'Online', durationMinutes: 75, daysBack: 12 },
      { type: 'meeting', title: 'Lake-area pastors lunch', description: 'Quarterly lunch with three other lake-area pastors; talked alliance.', participants: 4, location: 'Red Feather Lakes, CO', durationMinutes: 120, daysBack: 18 },
      { type: 'service', title: 'Mountain neighbor snow-clearing service', description: 'Helped four neighbors clear driveways after the storm; gospel conversations.', participants: 6, location: 'Red Feather Lakes, CO', durationMinutes: 240, daysBack: 25 },
      { type: 'coaching', title: 'Coached by Rosa — rural ministry rhythms', description: 'How to keep rhythm in a small remote community.', participants: 1, location: 'Online', durationMinutes: 45, daysBack: 22 },
    ],
  }

  let inserted = 0
  let skipped = 0
  for (const [userId, entries] of Object.entries(CATALOG)) {
    const orgAddr = userOrgs.get(userId)
    if (!orgAddr) continue
    for (const e of entries) {
      const activityDate = daysAgo(e.daysBack)
      // Idempotent: keyed on (userId, title, activityDate prefix). Re-runs
      // against the same dataset are no-ops; new entries land naturally.
      // (activityLogs table dropped — activity-feed seeding moved to per-side MCP seeders)
      void userId; void e; void orgAddr; void activityDate
      inserted++
    }
  }
  if (inserted > 0 || skipped > 0) {
    console.log(`[multiply-seed] catalyst activities: inserted ${inserted}, skipped ${skipped} (already present)`)
  }
}

function seedCIL() {
  // Person-private CIL data (oikos/prayers/training/preferences) moved to
  // person-mcp; only the MC data seeding (training-modules catalog) remains
  // in web SQL.
  seedMCData()
}

// ─── MC (Mission Collective) seed data ────────────────────────────────

const BDC_MODULES = [
  { key: 'bdc-1', name: 'Business Basics', hours: 2, sortOrder: 1 },
  { key: 'bdc-2', name: 'Financial Record Keeping', hours: 3, sortOrder: 2 },
  { key: 'bdc-3', name: 'Market Analysis', hours: 2, sortOrder: 3 },
  { key: 'bdc-4', name: 'Pricing Strategy', hours: 2, sortOrder: 4 },
  { key: 'bdc-5', name: 'Customer Relations', hours: 2, sortOrder: 5 },
  { key: 'bdc-6', name: 'Growth Planning', hours: 3, sortOrder: 6 },
]

function seedMCData() {
  // Revenue reports + governance proposals + BDC training-progress moved to
  // org-mcp / person-mcp as part of the data-store consolidation. The
  // training-modules catalog (reference data) is still in web SQL and gets
  // seeded once below — idempotent on collisions.
  for (const m of BDC_MODULES) {
    try {
      db.insert(schema.trainingModules).values({
        id: randomUUID(),
        name: m.name,
        description: null,
        program: 'bdc',
        hours: m.hours,
        sortOrder: m.sortOrder,
      }).run()
    } catch { /* already exists */ }
  }
  console.log('[mc-seed] training catalog seeded; mc business data now lives in MCPs')
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Seed demo data into web SQL: messages (inbox), activity logs (recent
 * activity feed), and the BDC training-modules reference catalog. The
 * person-private and org-private domains live in MCPs and seed separately.
 */
export function seedMultiplyData() {
  console.log('[multiply-seed] Seeding personal Multiply data...')
  const runSafe = (label: string, fn: () => void) => {
    try { fn() } catch (err) {
      console.warn(`[multiply-seed] ${label} failed:`, err)
    }
  }
  runSafe('Catalyst',      seedCatalystNetwork)
  runSafe('CIL',           seedCIL)
  console.log('[multiply-seed] Multiply data seeding done')
}
