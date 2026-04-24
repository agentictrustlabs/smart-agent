import { ssiConfig } from './config'

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

export const person = {
  callTool: <T>(name: string, args: unknown) =>
    call<T>(ssiConfig.personUrl, `/tools/${name}`, { body: { tool: name, args } }),
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
  guardianRequest: () => call<{ presentationRequest: Record<string, unknown> }>(ssiConfig.familyUrl, '/verify/guardian/request'),
  guardianCheck: (args: { presentation: string; presentationRequest: Record<string, unknown> }) =>
    call<{ verified: boolean; reason?: string }>(ssiConfig.familyUrl, '/verify/guardian/check', { body: args }),
}
