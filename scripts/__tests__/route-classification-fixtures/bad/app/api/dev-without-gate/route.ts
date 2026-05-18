/**
 * @sa-route dev-only
 * @sa-auth none
 */
// Note: intentionally missing @sa-prod-gate so the lint catches it.
export async function GET() {
  return Response.json({ ok: true })
}
