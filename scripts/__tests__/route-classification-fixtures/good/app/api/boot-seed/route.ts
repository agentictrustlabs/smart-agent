/** @sa-route dev-only @sa-auth none @sa-prod-gate requireDev */
export async function GET() {
  return Response.json({ ok: true })
}
