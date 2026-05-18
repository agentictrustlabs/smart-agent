/**
 * @sa-route public
 * @sa-auth none
 * @sa-rate-limit 60/min
 */
export async function GET() {
  return Response.json({ ok: true })
}
