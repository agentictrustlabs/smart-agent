# CPM Demo Walkthrough — Video Production

Automated screen recording + Trupeer narration for a polished demo video.

## Quick Start

```bash
# 1. Start the app (Terminal 1)
pnpm dev

# 2. Record the demo (Terminal 2)
npx playwright test --config demos/cpm-walkthrough/playwright.config.ts

# 3. Find the video
ls demos/cpm-walkthrough/output/
# → record-CPM-Demo-Walkthrough/video.webm
```

## Upload to Trupeer

1. Go to [trupeer.ai](https://trupeer.ai) and create a project
2. Upload the `.webm` recording from `output/`
3. Paste each segment from `narration-trupeer.md` as narration
4. Trupeer auto-generates: AI voice, captions, zooms, transitions
5. Export and publish

## What the Recording Covers

| Section | Duration | What Happens |
|---------|----------|-------------|
| Login | ~25s | Landing page → CPM community → select user → dashboard |
| Log Activity | ~70s | Activities page → fill form → submit → see in feed |
| Invite User | ~60s | Organization page → scroll to invite → create link |
| Gen Map | ~75s | Metrics → generation pipeline → tree view → health markers |
| Closing | ~10s | Return to dashboard |

## Files

| File | Purpose |
|------|---------|
| `record.ts` | Playwright script — automates the browser walkthrough |
| `playwright.config.ts` | Config — 1920x1080, video recording enabled |
| `narration-trupeer.md` | 5 narration segments ready to paste into Trupeer |
| `output/` | Generated recordings (gitignored) |

## Customizing

- **Typing speed:** Change `SLOW` constant in `record.ts` (default: 80ms/char)
- **Pause duration:** Change `PAUSE` constant (default: 2000ms between sections)
- **Base URL:** Set `BASE_URL` env var (default: http://localhost:3000)
- **Different user:** Change the community/user selection in the login section
