/**
 * @sa-route web-auth
 * @sa-auth session-cookie
 */
export async function GET() {
  return Response.json({ user: null })
}

/**
 * @sa-route web-auth
 * @sa-auth session-cookie
 */
export async function POST() {
  return Response.json({ ok: true })
}
