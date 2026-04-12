# Smart Agent Demo — Recording Guide

Step-by-step instructions for recording the demo video using OBS Studio or Loom.

---

## Pre-Recording Setup

### 1. Start the local environment

```bash
# Terminal 1 — local blockchain
cd /home/barb/smart-agent
anvil --host 0.0.0.0

# Terminal 2 — deploy contracts + seed all communities
./scripts/deploy-local.sh
./scripts/seed-graph.sh
./scripts/seed-global-church.sh
./scripts/seed-ilad-mc.sh
./scripts/seed-togo-pilot.sh
./scripts/seed-togo-data.sh
./scripts/seed-cpm.sh

# Terminal 3 — web app
cd apps/web
pnpm dev
```

### 2. Verify the app is running

Open `http://localhost:3000` in Chrome. You should see the landing page with 5 community cards.

### 3. Browser setup

- Chrome, clean profile (no bookmarks bar, no extension icons)
- Window size: 1920x1080 (or record at native resolution + crop in editing)
- Zoom: 100% (Cmd/Ctrl + 0 to reset)
- Clear browsing data to ensure no stale cookies
- Close all other tabs
- Hide OS dock/taskbar if possible

### 4. OBS Setup (if using OBS)

- Source: Window Capture (Chrome)
- Output: 1920x1080, 30fps, H.264, CRF 18
- Audio: Desktop audio OFF, Mic OFF (narration added in post)
- Recording format: MP4 or MKV

### 5. Loom Setup (if using Loom)

- Record: Screen only (no webcam)
- Mic: OFF (narration added in post)
- Resolution: 1080p

---

## Recording Script — Exact Clicks

Perform each action smoothly with ~1-2 second pauses between clicks.
The narration will be overlaid in post-production.

### TAKE 1 — Login (0:00 – 0:42)

```
1. Open http://localhost:3000
2. WAIT 3 seconds (show landing page)
3. Slowly scroll down if needed to show all 5 community cards
4. CLICK: "Church Planting Movement" card (blue, bottom)
5. WAIT 2 seconds (show user picker)
6. HOVER over "Priya Sharma" card briefly
7. CLICK: "Priya Sharma" card
8. WAIT 3 seconds (dashboard loads)
9. Slowly move cursor to the org selector in the header showing "Kolkata Team"
10. WAIT 2 seconds
```

### TAKE 2 — Log Activity (0:42 – 1:50)

```
1. CLICK: "Activities" in nav bar
2. WAIT 3 seconds (activities page loads, show summary cards)
3. Slowly move cursor across the 4 summary cards (left to right)
4. WAIT 1 second
5. CLICK: "+ Log Activity" button
6. WAIT 2 seconds (form expands)

7. CLICK: "Type" dropdown → select "Outreach"
8. CLICK: "Date" field → set to today's date
9. CLICK: "Participants" field → type "8"
10. CLICK: "Title" field → type "Neighborhood visit — New Town area"
    (type at readable speed, ~3-4 chars/second)
11. CLICK: "Location" field → type "New Town, Kolkata"
12. CLICK: "Duration" field → type "90"
13. CLICK: "Notes" textarea → type:
    "Visited six families in the apartment complex.
     Two expressed interest in joining a study group."
14. WAIT 2 seconds (show completed form)

15. CLICK: "Log Activity" button
16. WAIT 3 seconds (page reloads, show new entry at top of feed)
17. Move cursor to the new activity entry
18. WAIT 2 seconds
```

### TAKE 3 — Invite User (1:50 – 3:00)

```
1. CLICK: "Organization" in nav bar
2. WAIT 3 seconds (team page loads)
3. Slowly scroll down past Members, past Related Orgs, past AI Agents, past Invites
4. Stop at "Invite a New Member" section
5. WAIT 2 seconds

6. CLICK: Role dropdown
7. Browse the options briefly (hover over each)
8. SELECT: "Church Planter"
9. WAIT 1 second (show description: "Frontline church planting and discipleship")

10. CLICK: "Create Invitation" button
11. WAIT 2 seconds (green success box appears with invite link)
12. Move cursor to the invite URL code block
13. WAIT 3 seconds (let viewer read it)
14. Scroll up slightly to show the invite appearing in the pending invites table
15. WAIT 2 seconds
```

### TAKE 4 — Generational Map (3:00 – 4:15)

```
1. CLICK: "Gen Map" in nav bar
2. WAIT 3 seconds (gen map page loads)
3. Slowly move cursor across the 5 metric cards (left to right):
   Groups → Deepest Gen → Baptized → Churches → Multiplying
4. WAIT 2 seconds

5. Scroll down to "Generation Pipeline" section
6. Move cursor slowly from G0 → G1 → G2 → G3 boxes
7. WAIT 3 seconds (let viewer read the 2 Tim 2:2 explanation)

8. Scroll down to "Generational Tree" section
9. WAIT 2 seconds (show full tree)

10. Slowly scan down Priya's stream:
    - G0 (Priya) → G1 (Baranagar, "church" badge) → G2 (Salt Lake, "church" badge) → G3 (New Town)
    - Back up to G1 (Howrah) → G2 (Shibpur)
11. Move cursor to Baranagar node, hover on health markers
12. WAIT 3 seconds

13. Scroll down to Raj's stream (second root)
14. WAIT 2 seconds

15. Scroll back up to Salt Lake node
16. Move cursor to its health score
17. WAIT 3 seconds
```

### TAKE 5 — Closing (4:15 – 4:30)

```
1. CLICK: "Home" in nav bar
2. WAIT 3 seconds (dashboard loads)
3. Let screen sit for 5 seconds (closing narration plays over this)
```

---

## Post-Production Workflow

### Step 1: Generate narration audio

Use [ElevenLabs](https://elevenlabs.io):

1. Create account (free tier = 10,000 chars/month, enough for this script)
2. Select voice: **"Rachel"** (or "Bella" for warmer tone)
3. Settings: Stability = 0.50, Similarity = 0.75, Style = 0.30
4. Paste each section of `narration-script.md` separately
5. Generate → Download MP3 for each section
6. Name files: `01-intro.mp3`, `02-login.mp3`, `03-activity.mp3`, `04-invite.mp3`, `05-genmap.mp3`, `06-closing.mp3`

### Step 2: Edit in video editor

Recommended editors (free):
- **DaVinci Resolve** (professional, free)
- **CapCut** (easy, free, web-based)
- **Shotcut** (open source)

Assembly:
1. Import screen recording as video track
2. Import audio files to audio track
3. Align narration to the matching sections using the timestamps in `narration-script.md`
4. Add section title overlays from the frame guide annotations table
5. Add intro title card (0:00–0:05): "Smart Agent — Demo Walkthrough"
6. Add end card (4:15–4:30): "Learn more at smartagent.io"

### Step 3: Add annotations

From the `frame-guide.md` annotations:
- Use zoom/crop effects to highlight specific UI elements
- Add callout text boxes at the timestamps noted
- Use subtle yellow or blue highlight rectangles (semi-transparent) to draw attention

### Step 4: Export

- Format: MP4, H.264
- Resolution: 1920x1080
- Frame rate: 30fps
- Audio: AAC, 192kbps
- Target file size: < 100MB (for YouTube upload)

### Step 5: Upload

- YouTube: Title "Smart Agent — Log Activity, Invite Users, Build Generational Map"
- Description: include timestamps for each section
- Thumbnail: screenshot of the generational map tree view

---

## Timing Cheat Sheet

| Section | Start | End | Duration | Key Action |
|---------|-------|-----|----------|------------|
| Intro | 0:00 | 0:18 | 18s | Title + overview |
| Login | 0:18 | 0:42 | 24s | Community → Priya → Dashboard |
| Log Activity | 0:42 | 1:50 | 68s | Activities → Form → Submit |
| Invite User | 1:50 | 3:00 | 70s | Organization → Invite form → Link |
| Gen Map | 3:00 | 4:15 | 75s | Metrics → Pipeline → Tree |
| Closing | 4:15 | 4:30 | 15s | Dashboard + sign-off |
| **Total** | | | **~4:30** | |

---

## Troubleshooting

**Activities page is empty:**
Run `./scripts/seed-cpm.sh` — it seeds 10 activities for the Kolkata Team.

**Gen map shows no nodes:**
Run `./scripts/seed-cpm.sh` — it seeds 9 generational map nodes.

**Org selector shows wrong org:**
Clear localStorage (`localStorage.removeItem('smart-agent-selected-org')`) and reload.

**Invite fails:**
Make sure you're logged in as Priya (cpm-user-002) who created the Kolkata Team org.

**Nav doesn't show Activities/Gen Map:**
These only appear for CPM templates. Make sure the org selector shows "Kolkata Team" (template: church-planting-team).
