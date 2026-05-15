/**
 * SSI HTTP clients (phase 3 of A2A-first routing consolidation).
 *
 * Routing rule for this file:
 *
 *   - `person.callTool(name, args)` — ALWAYS goes through the A2A proxy at
 *     `${A2A_AGENT_URL}/mcp/person/<tool>` via `callMcp('person', name, args)`.
 *     The A2A proxy mints a delegation token bound to the user's smart-account
 *     session and forwards it to person-mcp's `/tools/<tool>` endpoint. No
 *     direct `PERSON_MCP_URL/tools/*` hits live here.
 *
 *   - `org` / `family` / `geo` / `skill` clients call ISSUER protocol
 *     endpoints (`/credential/offer`, `/credential/issue`, `/.well-known/*`,
 *     `/oid4vci/*`, `/token`, `/credential`). These are unauthenticated
 *     issuer-side protocol surfaces (analogous to OID4VCI) that any holder
 *     hits regardless of session; the holder identity is established by
 *     the AnonCreds blinding ceremony, not by a session token. They stay
 *     DIRECT-HTTP by design.
 *
 *   - `verifier` client calls verifier protocol endpoints (`/verify/<type>/request`,
 *     `/verify/<type>/check`, `/.well-known/agent.json`). Same reasoning as
 *     above: verifier protocol surface, not a tool-call surface.
 *
 * TODO(phase-4): The remaining direct-HTTP person-mcp routes used by other
 * files (`/wallet/<principal>/<context>`, `/credentials/store`,
 * `/wallet-action/dispatch`, `/session-store/*`) should be wrapped as MCP
 * tools by the person-mcp owner so the SSI lib can drop them on the A2A
 * proxy. Tracked in those files individually.
 */

import { ssiConfig } from './config'
import { callMcp } from '@/lib/clients/mcp-client'

async function call<T>(base: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    body: init.body === undefined
      ? undefined
      : typeof init.body === 'string'
        ? init.body
        : JSON.stringify(init.body, (_, v) => typeof v === 'bigint' ? v.toString() : v),
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${base}${path} ${res.status}: ${text}`)
  return JSON.parse(text) as T
}

/**
 * `person.callTool` — A2A-routed wrapper around `callMcp('person', …)`.
 *
 * The optional second-form `(name, args, { agentAddress })` lets callers
 * that are operating on a *specific* holder (e.g. issuance flows where the
 * web user is the admin but the cred lands in a different holder's wallet)
 * pin the A2A host to that holder's person agent. Default (no opts) routes
 * to the signed-in user's person agent.
 */
export const person = {
  callTool: <T>(name: string, args: unknown, opts?: { agentAddress?: string }) =>
    callMcp<T>('person', name, (args as Record<string, unknown>) ?? {}, opts),
}

export const org = {
  agentCard: () => call<{ name: string; did: string; credentialTypes: string[] }>(ssiConfig.orgUrl, '/.well-known/agent.json'),
  offer: (credentialType: string) => call<{
    credentialOfferJson: string
    credDefId: string
    schemaId: string
    issuerId: string
  }>(ssiConfig.orgUrl, '/credential/offer', { body: { credentialType } }),
  issue: (args: { credentialOfferJson: string; credentialRequestJson: string; attributes: Record<string, string> }) =>
    call<{ credentialJson: string }>(ssiConfig.orgUrl, '/credential/issue', { body: args }),
  oid4vciOfferByCode: (code: string) => call<{
    anoncreds_credential_offer: string
    credential_definition_id: string
    schema_id: string
    issuer_id: string
  }>(ssiConfig.orgUrl, `/oid4vci/offer-by-code/${encodeURIComponent(code)}`),
  oid4vciOffer: (attributes: Record<string, string>) => call<{
    credential_offer: Record<string, unknown>
    credential_offer_uri: string
    pre_authorized_code: string
    anoncreds_credential_offer: string
    credential_definition_id: string
    schema_id: string
    issuer_id: string
  }>(ssiConfig.orgUrl, '/oid4vci/offer', { body: { attributes } }),
  oid4vciToken: (code: string) =>
    call<{ access_token: string; c_nonce?: string }>(ssiConfig.orgUrl, '/token', {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:pre-authorized_code',
        'pre-authorized_code': code,
      }).toString(),
    }),
  oid4vciCredential: (accessToken: string, credDefId: string, anoncredsRequest: string) =>
    call<{ credential: string; schema_id: string; credential_definition_id: string; issuer_id: string }>(
      ssiConfig.orgUrl, '/credential', {
        headers: { authorization: `Bearer ${accessToken}` },
        body: { format: 'anoncreds-v1', credential_definition: { credDefId }, anoncreds_credential_request: anoncredsRequest },
      },
    ),
}

export const geo = {
  agentCard: () => call<{ name: string; did: string; credentialTypes: string[] }>(ssiConfig.geoUrl, '/.well-known/agent.json'),
  offer: (credentialType: string) => call<{
    credentialOfferJson: string
    credDefId: string
    schemaId: string
    issuerId: string
  }>(ssiConfig.geoUrl, '/credential/offer', { body: { credentialType } }),
  issue: (args: { credentialOfferJson: string; credentialRequestJson: string; attributes: Record<string, string> }) =>
    call<{ credentialJson: string }>(ssiConfig.geoUrl, '/credential/issue', { body: args }),
}

export const skill = {
  agentCard: () => call<{ name: string; did: string; credentialTypes: string[] }>(ssiConfig.skillUrl, '/.well-known/agent.json'),
  offer: (credentialType: string) => call<{
    credentialOfferJson: string
    credDefId: string
    schemaId: string
    issuerId: string
  }>(ssiConfig.skillUrl, '/credential/offer', { body: { credentialType } }),
  issue: (args: { credentialOfferJson: string; credentialRequestJson: string; attributes: Record<string, string> }) =>
    call<{ credentialJson: string }>(ssiConfig.skillUrl, '/credential/issue', { body: args }),
}

export interface VerifierRequestResponse {
  presentationRequest: Record<string, unknown> & { name: string; nonce: string }
  selection: { revealReferents: string[]; predicateReferents: string[] }
  verifierId: string
  verifierAddress: `0x${string}`
  signature: `0x${string}`
  label: string
}
export const verifier = {
  agentCard: () => call<{
    name: string; did: string; address: `0x${string}`
    credentialTypes: string[]; endpoints: Record<string, string>
  }>(ssiConfig.verifierUrl, '/.well-known/agent.json'),
  request: (credentialType: string) =>
    call<VerifierRequestResponse>(
      ssiConfig.verifierUrl,
      `/verify/${encodeURIComponent(credentialType)}/request`,
      { body: {} },
    ),
  check: (credentialType: string, args: { presentation: string; presentationRequest: Record<string, unknown> }) =>
    call<{ verified: boolean; reason?: string; replay?: boolean; revealedAttrs?: Record<string, string> }>(
      ssiConfig.verifierUrl,
      `/verify/${encodeURIComponent(credentialType)}/check`,
      { body: args },
    ),
}

export const family = {
  agentCard: () => call<{ name: string; did: string; credentialTypes: string[] }>(ssiConfig.familyUrl, '/.well-known/agent.json'),
  offer: (credentialType: string) => call<{
    credentialOfferJson: string
    credDefId: string
    schemaId: string
    issuerId: string
  }>(ssiConfig.familyUrl, '/credential/offer', { body: { credentialType } }),
  issue: (args: { credentialOfferJson: string; credentialRequestJson: string; attributes: Record<string, string> }) =>
    call<{ credentialJson: string }>(ssiConfig.familyUrl, '/credential/issue', { body: args }),
  guardianRequest: () => call<{
    presentationRequest: Record<string, unknown>
    verifierId: string
    verifierAddress: `0x${string}`
    signature: `0x${string}`
  }>(ssiConfig.familyUrl, '/verify/guardian/request'),
  guardianCheck: (args: { presentation: string; presentationRequest: Record<string, unknown> }) =>
    call<{ verified: boolean; reason?: string }>(ssiConfig.familyUrl, '/verify/guardian/check', { body: args }),
}
