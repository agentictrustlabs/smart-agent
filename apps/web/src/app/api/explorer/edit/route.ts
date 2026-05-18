/** @sa-route dev-only @sa-auth none @sa-prod-gate requireDev @sa-validation zod @sa-owner developer */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { setAgentStringProperty, updateAgentCore } from '@/lib/actions/explorer-edit.action'
import { requireDev } from '@/lib/env-guard'
import { validateRequest } from '@/lib/auth/validate-request'

const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'invalid address')

const SetPropertySchema = z.object({
  action: z.literal('setProperty'),
  agentAddress: AddressSchema,
  key: z.string().min(1).max(256),
  value: z.string().max(8192).optional(),
})

const UpdateCoreSchema = z.object({
  action: z.literal('updateCore'),
  agentAddress: AddressSchema,
  displayName: z.string().min(1).max(256),
  description: z.string().max(2048).optional(),
})

const BodySchema = z.discriminatedUnion('action', [SetPropertySchema, UpdateCoreSchema])

/**
 * Explorer edit route — writes on-chain agent properties.
 *
 * Currently has NO caller auth, so it is locked behind `requireDev()`
 * until a proper delegation-bearing wrapper is added (Phase 1B).
 * Returns 404 in production.
 */
export async function POST(request: Request) {
  const denied = requireDev()
  if (denied) return denied

  const parsed = await validateRequest(request, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  if (body.action === 'setProperty') {
    const result = await setAgentStringProperty(body.agentAddress, body.key, body.value ?? '')
    return NextResponse.json(result)
  }

  // body.action === 'updateCore'
  const result = await updateAgentCore(body.agentAddress, body.displayName, body.description ?? '')
  return NextResponse.json(result)
}
