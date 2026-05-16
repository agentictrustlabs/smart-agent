#!/usr/bin/env tsx
/**
 * Post-process the customer demo by:
 *   1. Generating per-chapter narration via OpenAI TTS.
 *   2. (Optional) Trimming the loading lull at the tail of each chapter
 *      window so the final video moves chapter-to-chapter cleanly.
 *   3. Muxing audio onto the (possibly trimmed) video at chapter offsets.
 *
 * Inputs:
 *   tests/e2e/demo-output/smart-agent-grant-lifecycle-demo.webm
 *   tests/e2e/demo-output/chapter-timeline.json
 *
 * Output:
 *   tests/e2e/demo-output/smart-agent-grant-lifecycle-narrated.mp4
 *
 * Env:
 *   OPENAI_API_KEY  – required to generate audio (skips if mp3s already cached)
 *   TRIM_LOADING    – '1' to drop trailing loading time at end of each chapter (default off)
 *   TRIM_TAIL_SEC   – seconds to drop from the tail of each chapter window when TRIM_LOADING=1 (default 7)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
// NARRATE_OUT_DIR override so the produced mp4 + cached mp3s can live
// OUTSIDE the playwright `outputDir` (which is wiped on every test run).
const OUT_DIR = process.env.NARRATE_OUT_DIR
  ? path.resolve(process.env.NARRATE_OUT_DIR)
  : path.resolve(repoRoot, 'tests/e2e/demo-output')

const _require = createRequire(import.meta.url)
const FFMPEG_BIN = _require('ffmpeg-static') as string
const FFPROBE_BIN = (_require('ffprobe-static') as { path: string }).path

const TIMELINE_PATH = path.join(OUT_DIR, 'chapter-timeline.json')
const VIDEO_PATH = path.join(OUT_DIR, 'smart-agent-grant-lifecycle-demo.webm')
const AUDIO_DIR = path.join(OUT_DIR, 'narration')
const FINAL_PATH = path.join(OUT_DIR, 'smart-agent-grant-lifecycle-narrated.mp4')

interface ChapterLine { chapter: number; offsetSec: number; narration: string }
interface Segment {
  chapter: number
  startSec: number    // start in ORIGINAL video
  endSec: number      // end in ORIGINAL video
  holdSec: number     // extra hold of the last frame after [start,end] is consumed,
                      // so each chapter's video segment lasts at least as long as
                      // its narration. Prevents chapter-N audio from bleeding into
                      // chapter-(N+1)'s window.
  newStartSec: number // start in OUTPUT (where narration plays)
  narration: string
}

async function generateChapterAudio(line: ChapterLine): Promise<string> {
  const file = path.join(AUDIO_DIR, `ch-${String(line.chapter).padStart(2, '0')}.mp3`)
  if (fs.existsSync(file) && fs.statSync(file).size > 100) {
    console.log(`  ch${line.chapter}: cached (${fs.statSync(file).size} bytes)`)
    return file
  }
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')
  // Voice + model knobs — env overrides for tuning narration clarity.
  //   NARRATE_VOICE: alloy | echo | fable | onyx | nova | shimmer
  //   NARRATE_MODEL: tts-1 | tts-1-hd | gpt-4o-mini-tts
  //   NARRATE_SPEED: 0.25 – 4.0 (default 1.0)
  // Defaults aim for a clear, broadcast-style product-demo voice.
  const voice = process.env.NARRATE_VOICE ?? 'nova'
  const model = process.env.NARRATE_MODEL ?? 'tts-1-hd'
  const speed = parseFloat(process.env.NARRATE_SPEED ?? '1.0')
  // Retry up to 3 times on transient OpenAI server errors (5xx).
  // The TTS endpoint occasionally 500s under load; a short sleep + retry
  // typically recovers without the user having to re-run the whole mux.
  let res: Response | null = null
  let lastErr: string | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, 1500 * attempt))
      console.log(`  ch${line.chapter}: retry ${attempt}`)
    }
    res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model, voice, input: line.narration,
        response_format: 'mp3', speed,
      }),
    }).catch(e => {
      lastErr = e instanceof Error ? e.message : String(e)
      return null as Response | null
    })
    if (res && res.ok) break
    if (res && res.status < 500) break  // 4xx — don't retry
    if (res) lastErr = `${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`
  }
  if (!res) throw new Error(`OpenAI TTS network error after retries: ${lastErr}`)
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`OpenAI TTS ${res.status}: ${txt.slice(0, 300)}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(file, buf)
  console.log(`  ch${line.chapter}: ${buf.length} bytes`)
  return file
}

function probeDurationSec(file: string): number {
  const r = spawnSync(FFPROBE_BIN, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`)
  return parseFloat(r.stdout.trim())
}

/**
 * Build the segment list. Each chapter's window in the original video is
 * [offsetSec[N], offsetSec[N+1]]; the LAST chapter extends to videoDur.
 * When TRIM_LOADING is enabled we lop `TRIM_TAIL_SEC` seconds off the END
 * of each window (where the next page-load lull sits), with a floor of 4s
 * per chapter so we never drop a banner mid-narration.
 *
 * `newStartSec` is what the audio mix uses — it accumulates the trimmed
 * durations so each chapter's narration lands at the right moment in the
 * concatenated output.
 */
function buildSegments(timeline: ChapterLine[], videoDur: number, audioDurs: number[]): Segment[] {
  const trim = process.env.TRIM_LOADING === '1'
  const tail = parseFloat(process.env.TRIM_TAIL_SEC ?? '7')
  const audioPad = parseFloat(process.env.AUDIO_PAD_SEC ?? '0.6')
  const minLen = 4
  const out: Segment[] = []
  let cumulative = 0
  for (let i = 0; i < timeline.length; i++) {
    const start = timeline[i].offsetSec
    const nextStart = timeline[i + 1]?.offsetSec ?? videoDur
    const sourceWindow = nextStart - start
    // Required total runtime for this chapter in the OUTPUT — long enough
    // for the narration to play out with a small padding buffer before the
    // next chapter's narration starts.
    const required = audioDurs[i] + audioPad
    // How much SOURCE footage we keep. When TRIM_LOADING is on we drop the
    // tail-loading lull (up to `tail` seconds); otherwise use the full
    // source window. We also floor to `minLen` so a very short source
    // chapter still shows a banner.
    let sourceKeep = trim ? Math.max(minLen, sourceWindow - tail) : sourceWindow
    sourceKeep = Math.min(sourceKeep, sourceWindow)
    let end = start + sourceKeep
    if (end > videoDur) end = videoDur
    // If the narration is longer than the kept source, freeze the last
    // frame for the remainder. This is what stops chapter-N's audio from
    // bleeding into chapter-(N+1) — previously buildSegments capped at
    // sourceWindow and the amix overlapped narrations.
    const segmentVisible = end - start
    const holdSec = Math.max(0, required - segmentVisible)
    out.push({
      chapter: timeline[i].chapter,
      startSec: start,
      endSec: end,
      holdSec,
      newStartSec: cumulative,
      narration: timeline[i].narration,
    })
    cumulative += segmentVisible + holdSec
  }
  return out
}

async function main() {
  if (!fs.existsSync(TIMELINE_PATH)) {
    console.error(`Missing timeline: ${TIMELINE_PATH}`); process.exit(1)
  }
  if (!fs.existsSync(VIDEO_PATH)) {
    console.error(`Missing video: ${VIDEO_PATH}`); process.exit(1)
  }
  fs.mkdirSync(AUDIO_DIR, { recursive: true })

  const timeline = JSON.parse(fs.readFileSync(TIMELINE_PATH, 'utf8')) as ChapterLine[]
  timeline.sort((a, b) => a.offsetSec - b.offsetSec)
  console.log(`Loaded ${timeline.length} chapters.`)

  console.log('Generating narration mp3s…')
  for (const line of timeline) await generateChapterAudio(line)

  const videoDur = probeDurationSec(VIDEO_PATH)
  console.log(`Original video duration: ${videoDur.toFixed(2)}s`)

  const audioDurs = timeline.map(l =>
    probeDurationSec(path.join(AUDIO_DIR, `ch-${String(l.chapter).padStart(2, '0')}.mp3`)),
  )
  const segments = buildSegments(timeline, videoDur, audioDurs)
  const lastSeg = segments[segments.length - 1]
  const totalNewDur = lastSeg.newStartSec + (lastSeg.endSec - lastSeg.startSec) + lastSeg.holdSec
  const totalHold = segments.reduce((acc, s) => acc + s.holdSec, 0)
  console.log(`Output duration ${totalNewDur.toFixed(2)}s (source ${videoDur.toFixed(2)}s, last-frame hold ${totalHold.toFixed(2)}s)`)

  // Build ffmpeg filter_complex:
  //   1. For each segment, trim video to [start,end] and reset pts.
  //   2. Concat the trimmed video segments.
  //   3. For each chapter's mp3 (loaded as a separate -i input), adelay
  //      to its newStartSec.
  //   4. amix all delayed audios.
  const inputs: string[] = ['-i', VIDEO_PATH]
  const filterParts: string[] = []
  const videoLabels: string[] = []

  // Video: trim each segment by seconds, reset PTS, optionally hold the
  // last frame to cover narration overhang, then concat.
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    const trimExpr = `[0:v]trim=start=${s.startSec.toFixed(3)}:end=${s.endSec.toFixed(3)},setpts=PTS-STARTPTS`
    const padExpr = s.holdSec > 0.01
      ? `,tpad=stop_mode=clone:stop_duration=${s.holdSec.toFixed(3)}`
      : ''
    filterParts.push(`${trimExpr}${padExpr}[v${i}]`)
    videoLabels.push(`[v${i}]`)
  }
  filterParts.push(`${videoLabels.join('')}concat=n=${segments.length}:v=1:a=0[vout]`)

  // Audio delays
  const audioLabels: string[] = []
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    const audioPath = path.join(AUDIO_DIR, `ch-${String(s.chapter).padStart(2, '0')}.mp3`)
    inputs.push('-i', audioPath)
    const inputIdx = i + 1   // 0 is the video
    const offsetMs = Math.floor(s.newStartSec * 1000)
    const label = `a${i}`
    filterParts.push(`[${inputIdx}:a]adelay=${offsetMs}|${offsetMs}[${label}]`)
    audioLabels.push(`[${label}]`)
  }
  filterParts.push(
    `${audioLabels.join('')}amix=inputs=${segments.length}:normalize=0:dropout_transition=0[aout]`,
  )

  const filter = filterParts.join(';')

  const args = [
    ...inputs,
    '-filter_complex', filter,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '22',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    '-shortest',
    '-y', FINAL_PATH,
  ]
  console.log(`\nffmpeg encoding (${segments.length} segments)…`)
  const result = spawnSync(FFMPEG_BIN, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`ffmpeg failed with exit ${result.status}`)
    process.exit(1)
  }
  const finalSize = fs.statSync(FINAL_PATH).size
  console.log(`\n✓ Narrated demo: ${FINAL_PATH} (${(finalSize / 1024 / 1024).toFixed(1)} MB)`)
}

main().catch(e => { console.error(e); process.exit(1) })
void execSync
