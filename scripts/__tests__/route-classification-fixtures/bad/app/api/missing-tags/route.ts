// No JSDoc at all — should fail the lint.
export async function GET() {
  return Response.json({ ok: true })
}
