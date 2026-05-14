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
const OUT_DIR = path.resolve(repoRoot, 'tests/e2e/demo-output')

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
  newStartSec: number // start in TRIMMED video (where narration plays)
  narration: string
}

async function generateChapterAudio(line: ChapterLine, voice = 'alloy'): Promise<string> {
  const file = path.join(AUDIO_DIR, `ch-${String(line.chapter).padStart(2, '0')}.mp3`)
  if (fs.existsSync(file) && fs.statSync(file).size > 100) {
    console.log(`  ch${line.chapter}: cached (${fs.statSync(file).size} bytes)`)
    return file
  }
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts', voice, input: line.narration,
      response_format: 'mp3', speed: 1.0,
    }),
  })
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
function buildSegments(timeline: ChapterLine[], videoDur: number): Segment[] {
  const trim = process.env.TRIM_LOADING === '1'
  const tail = parseFloat(process.env.TRIM_TAIL_SEC ?? '7')
  const minLen = 4
  const out: Segment[] = []
  let cumulative = 0
  for (let i = 0; i < timeline.length; i++) {
    const start = timeline[i].offsetSec
    const nextStart = timeline[i + 1]?.offsetSec ?? videoDur
    let end = trim ? (nextStart - tail) : nextStart
    if (end - start < minLen) end = start + minLen
    if (end > videoDur) end = videoDur
    out.push({
      chapter: timeline[i].chapter,
      startSec: start,
      endSec: end,
      newStartSec: cumulative,
      narration: timeline[i].narration,
    })
    cumulative += (end - start)
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

  const segments = buildSegments(timeline, videoDur)
  const totalNewDur = segments[segments.length - 1].newStartSec
    + (segments[segments.length - 1].endSec - segments[segments.length - 1].startSec)
  if (process.env.TRIM_LOADING === '1') {
    const saved = videoDur - totalNewDur
    console.log(`Trimming loading lulls — new duration ${totalNewDur.toFixed(2)}s (saved ${saved.toFixed(2)}s)`)
  }

  // Build ffmpeg filter_complex:
  //   1. For each segment, trim video to [start,end] and reset pts.
  //   2. Concat the trimmed video segments.
  //   3. For each chapter's mp3 (loaded as a separate -i input), adelay
  //      to its newStartSec.
  //   4. amix all delayed audios.
  const inputs: string[] = ['-i', VIDEO_PATH]
  const filterParts: string[] = []
  const videoLabels: string[] = []

  // Video: trim each segment by seconds, reset PTS, then concat.
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    filterParts.push(
      `[0:v]trim=start=${s.startSec.toFixed(3)}:end=${s.endSec.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`,
    )
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
