import { Hono } from 'hono'
import { config } from '../config.js'
import { buildGuardianProofRequest, verifyGuardianPresentation } from '../verifiers/guardian.js'

export const verifyRoutes = new Hono()

verifyRoutes.get('/verify/guardian/request', (c) => {
  return c.json({ presentationRequest: buildGuardianProofRequest() })
})

verifyRoutes.post('/verify/guardian/check', async (c) => {
  const body = await c.req.json<{
    presentation: string
    presentationRequest: Record<string, unknown>
  }>()
  try {
    const ok = await verifyGuardianPresentation(
      config.registryPath,
      body.presentation,
      body.presentationRequest,
    )
    return c.json({ verified: ok })
  } catch (err) {
    return c.json({ verified: false, reason: (err as Error).message }, 400)
  }
})
