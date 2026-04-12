# Smart Agent Demo — Frame-by-Frame Screenshot Guide

Each frame below describes exactly what should be visible on screen, where the cursor
should be, and what UI elements to highlight (zoom/callout) during editing.

**Resolution:** 1920x1080 (16:9)
**Browser:** Chrome, clean profile, no bookmarks bar, no extensions visible
**URL bar:** Visible (shows localhost:3000/...)
**Zoom:** Browser at 100% (or 110% if text feels small on recording)

---

## Frame 1 — Landing Page (0:18)

**URL:** `http://localhost:3000`
**Visible:**
- "Smart Agent" hero heading
- Subtitle: "Intelligent organization management..."
- Five community cards below:
  1. Agentic Trust Labs
  2. Global.Church
  3. ILAD Mission Collective
  4. Togo Pilot — Wave 1 Businesses
  5. Church Planting Movement (blue card, bottom)
- Each card shows: name, user count, one-line description

**Cursor:** Resting center-screen

**Annotation:** None yet

---

## Frame 2 — Community Selected (0:22)

**Action:** Click "Church Planting Movement" card
**Visible:**
- Back arrow "← Back to communities"
- "Church Planting Movement" heading in blue
- Description: "Activity logging, generational mapping..."
- 7 user buttons in a 2-column grid:
  - Mark Thompson — Network Director — South Asia Movement Network
  - Priya Sharma — Team Leader — Kolkata Team
  - Raj Patel — Church Planter — Kolkata Team
  - Anita Das — National Partner — Kolkata Team
  - David Kim — Strategy Lead — South Asia Movement Network
  - Samuel Bose — Group Leader — Baranagar Group
  - Meera Ghosh — Group Leader — Salt Lake Group

**Cursor:** Hovering over "Priya Sharma" card

**Annotation:** Callout box on Priya's card: "Team Leader — manages the field team"

---

## Frame 3 — Dashboard (0:30)

**Action:** Click Priya Sharma → redirects to `/dashboard`
**URL:** `http://localhost:3000/dashboard?org=0x...`
**Visible:**
- Header: "Smart Agent" logo | Org selector (showing "Kolkata Team") | Nav bar | Demo badge "Priya Sharma"
- Nav bar: Home, Organization, Agents, Network, Treasury, Activities, Gen Map, Reviews, Admin
- Page heading: "Kolkata Team"
- "Welcome, Priya Sharma — managing Kolkata Team"
- Summary cards: Members (count), Relationships (count), AI Agents (count), Template ("Church Planting Team")
- Quick links row
- Members table
- Relationships table

**Cursor:** Center of page

**Annotation:** Callout on org selector: "Switch between organizations here"

---

## Frame 4 — Navigate to Activities (0:42)

**Action:** Click "Activities" in nav bar
**URL:** `http://localhost:3000/activities?org=0x...`
**Visible:**
- Heading: "Activities — Kolkata Team"
- Subtitle: "Log and track field activities..."
- Four summary cards in a row:
  - Total Activities (blue, number)
  - This Week (purple, number)
  - Total Participants (teal, number)
  - Total Hours (orange, number with "h")
- "Log Activity" section with "+ Log Activity" button
- "Recent Activities" feed below showing 10 activity entries

**Cursor:** On the summary cards area

**Annotation:** Zoom callout on the four summary cards

---

## Frame 5 — Open Activity Form (0:50)

**Action:** Click "+ Log Activity" button
**Visible:**
- Expanded form with fields in a grid:
  - Row 1: Type (dropdown), Date (date picker), Participants (number)
  - Row 2: Title (text), Location (text), Duration (number, "min")
  - Row 3: Notes (textarea, 2 rows)
  - "Log Activity" button
- Activity feed still visible below

**Cursor:** On the "Type" dropdown

**Annotation:** Callout: "10 activity types — meeting, visit, training, outreach, and more"

---

## Frame 6 — Fill Activity Form (0:55 – 1:25)

**Actions (sequential):**
1. Select "Outreach" from Type dropdown
2. Set date to today
3. Type "8" in Participants
4. Type "Neighborhood visit — New Town area" in Title
5. Type "New Town, Kolkata" in Location
6. Type "90" in Duration
7. Type "Visited six families in the apartment complex. Two expressed interest in joining a study group." in Notes

**Visible:** Form filled out with all values

**Cursor:** Moving between fields as each is filled

**Annotation:** After filling, callout on the completed form: "All the context your team needs"

---

## Frame 7 — Activity Submitted (1:30)

**Action:** Click "Log Activity" button → page reloads
**Visible:**
- Updated summary cards (Total Activities incremented by 1)
- Activity feed with the new entry at the top:
  - Orange "Outreach" badge
  - "Neighborhood visit — New Town area"
  - "Priya Sharma · 8 participants · New Town, Kolkata · 90 min"
  - Description text below

**Cursor:** On the new activity entry

**Annotation:** Highlight the new entry: "Activity logged — visible to the whole team"

---

## Frame 8 — Navigate to Organization (1:50)

**Action:** Click "Organization" in nav bar
**URL:** `http://localhost:3000/team?org=0x...`
**Visible:**
- Heading: "Organization — Kolkata Team"
- "Members & Roles" section with current members listed:
  - Each member shows: name (link), status badge, roles, delegated authority
- "Related Organizations" table (if present)
- "AI Agents" section
- "Invites" section
- "Invite a New Member" form at bottom

**Cursor:** Scrolling down toward the invite form

**Annotation:** Callout on Members section: "Everyone on the team with their roles"

---

## Frame 9 — Invite Form (2:10)

**Action:** Scroll to "Invite a New Member" section
**Visible:**
- "Invite a New Member" card:
  - Role dropdown showing available roles:
    - Team Leader
    - Church Planter
    - National Partner
    - Coach / Mentor
  - "Create Invitation" button
- Role description text below dropdown

**Cursor:** On the Role dropdown

**Annotation:** Callout: "Roles are defined by the organization template"

---

## Frame 10 — Select Role (2:18)

**Action:** Select "Church Planter" from dropdown
**Visible:**
- Dropdown now shows "Church Planter"
- Description below: "Frontline church planting and discipleship"

**Cursor:** On the "Create Invitation" button

**Annotation:** None

---

## Frame 11 — Invite Created (2:25)

**Action:** Click "Create Invitation"
**Visible:**
- Green success box appears below the form:
  - "Invitation created" heading
  - "Share this link with the person you want to invite as church planter:"
  - Invite URL in a code block: `http://localhost:3000/invite/abc123...`
- Pending invites table above now shows new entry

**Cursor:** On the invite URL

**Annotation:** Highlight the invite URL: "Share this link — they accept with one click"

---

## Frame 12 — Navigate to Gen Map (3:00)

**Action:** Click "Gen Map" in nav bar
**URL:** `http://localhost:3000/genmap?org=0x...`
**Visible:**
- Heading: "Generational Map — Kolkata Team"
- Subtitle about generational multiplication
- Five metric cards in a row:
  - Groups (blue, "9")
  - Deepest Gen (purple, "G3")
  - Baptized (green, total count)
  - Churches (teal, "2")
  - Multiplying (orange, percentage)

**Cursor:** Scanning across the metric cards

**Annotation:** Zoom callout on "G3" metric: "Generation 3 — the movement is multiplying beyond the original team"

---

## Frame 13 — Generation Pipeline (3:12)

**Action:** Scroll slightly to reveal the generation pipeline section
**Visible:**
- "Generation Pipeline" heading
- Row of colored boxes: G0 | G1 | G2 | G3
  - Each box shows a count and generation label
  - G3 box is green (multiplication achieved)
- Subtitle: "2 Tim 2:2 pattern: G0 (you) → G1 (direct) → G2 (their groups) → G3+ (movement multiplication)"

**Cursor:** Scanning left to right across the pipeline

**Annotation:** Arrow from G0 → G1 → G2 → G3 with label "Each generation starts the next"

---

## Frame 14 — Generational Tree (3:25)

**Action:** Scroll to "Generational Tree" section
**Visible:**
- Tree structure with nested nodes:
  - G0 node: "Priya Initial Contact" — Kolkata Central — status: multiplied
    - G1: "Baranagar Group" — Samuel Bose — Baranagar — status: multiplied, "church" badge
      - G2: "Salt Lake Group" — Meera Ghosh — Salt Lake — status: multiplied, "church" badge
        - G3: "New Town Group" — Kavita Dey — New Town — status: active
      - G2: "Dunlop Group" — Ravi Sen — Dunlop — status: active
    - G1: "Howrah Group" — Amit Roy — Howrah — status: active
      - G2: "Shibpur Group" — Deepa Mitra — Shibpur — status: active
- Each node shows: generation badge (circle), name, status badge, health markers (S/B/Bap/L), health score
- Vertical lines connecting parent to children
- "Multiplied" nodes have green left border

**Cursor:** Slowly scanning down the tree

**Annotation:** Callout on Baranagar node: "This group has 8 seekers, 6 believers, 4 baptized, 2 leaders — and it started 2 new groups"

---

## Frame 15 — Second Stream (3:45)

**Action:** Scroll further to see the second stream
**Visible:**
- Second root node:
  - G0: "Raj Initial Contact" — Jadavpur — status: active
    - G1: "Garia Group" — Sunil Das — Garia — status: active
- Visually separated from Priya's stream

**Cursor:** On Raj's stream

**Annotation:** Callout: "Multiple independent streams tracked in one view"

---

## Frame 16 — Health Score Close-up (3:55)

**Action:** Hover/focus on a specific node (Salt Lake Group)
**Visible:**
- Salt Lake Group node clearly visible:
  - G2 badge in teal circle
  - "Salt Lake Group" — bold
  - "multiplied" badge (green), "church" badge
  - Leader: Meera Ghosh
  - Location: Salt Lake
  - Health markers: S:6, B:4, Bap:3, L:1
  - Health score: displayed prominently

**Cursor:** On the health score number

**Annotation:** Callout breaking down the markers:
- "S = Seekers (exploring)"
- "B = Believers"
- "Bap = Baptized"
- "L = Leaders being trained"

---

## Frame 17 — Closing (4:15)

**Action:** Return to dashboard (click "Home" in nav)
**URL:** `http://localhost:3000/dashboard?org=0x...`
**Visible:**
- Dashboard with Kolkata Team summary
- Org selector showing "Kolkata Team"
- Full nav bar visible

**Cursor:** Center screen

**Annotation:** Text overlay: "Log activities · Invite team members · Track generational growth"
Subtitle: "smartagent.io" (or your domain)

---

## POST-PRODUCTION ANNOTATIONS

| Timestamp | Overlay Type | Text | Position |
|-----------|-------------|------|----------|
| 0:00–0:05 | Title card | "Smart Agent — Demo Walkthrough" | Center |
| 0:05–0:18 | Subtitle | "Step 1: Login · Step 2: Log Activity · Step 3: Invite Users · Step 4: Generational Map" | Bottom |
| 0:42 | Section title | "LOG AN ACTIVITY" | Top-left, fade in/out |
| 1:50 | Section title | "INVITE A TEAM MEMBER" | Top-left |
| 3:00 | Section title | "GENERATIONAL MAP" | Top-left |
| 4:15 | End card | "Learn more at smartagent.io" | Center, 5s hold |

## TRANSITION STYLE

- Use simple crossfade (0.3s) between sections
- No flashy transitions — keep it professional
- Cursor should move smoothly (consider mouse smoothing in OBS)
