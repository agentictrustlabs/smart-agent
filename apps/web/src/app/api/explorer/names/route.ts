/** @sa-route web-auth @sa-auth session-cookie @sa-validation zod @sa-owner developer */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { findAllNamesForAgent, registerAdditionalName, setPrimaryName } from '@/lib/actions/explorer-edit.action'
import { validateRequest } from '@/lib/auth/validate-request'

const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const Bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/)

const RegisterSchema = z.object({
  action: z.literal('register'),
  agentAddress: AddressSchema,
  nameLabel: z.string().min(1).max(64),
  parentNode: Bytes32Schema,
  parentAgentName: z.string().min(1).max(256),
})

const SetPrimarySchema = z.object({
  action: z.literal('setPrimary'),
  agentAddress: AddressSchema,
  fullName: z.string().min(1).max(256),
  nameLabel: z.string().min(1).max(64),
})

const BodySchema = z.discriminatedUnion('action', [RegisterSchema, SetPrimarySchema])

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const address = searchParams.get('address')
  if (!address) return NextResponse.json({ names: [] })

  const names = await findAllNamesForAgent(address)
  return NextResponse.json({ names })
}

export async function POST(request: Request) {
  const parsed = await validateRequest(request, { schema: BodySchema })
  if (!parsed.ok) return parsed.response
  const body = parsed.data

  if (body.action === 'register') {
    const result = await registerAdditionalName(body.agentAddress, body.nameLabel, body.parentNode, body.parentAgentName)
    return NextResponse.json(result)
  }

  // body.action === 'setPrimary'
  const result = await setPrimaryName(body.agentAddress, body.fullName, body.nameLabel)
  return NextResponse.json(result)
}
