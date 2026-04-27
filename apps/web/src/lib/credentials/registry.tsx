'use client'

import type { ComponentType } from 'react'
import { CREDENTIAL_KINDS, type CredentialKindDescriptor } from '@smart-agent/sdk'
import { OrgMembershipForm } from './forms/OrgMembershipForm'
import { GeoLocationForm } from './forms/GeoLocationForm'
import type { CredentialFormPropsWithHandle } from './forms/types'

/**
 * Web-side registry — pairs each `CredentialKindDescriptor` (from the
 * sdk) with the React form component that collects its issuance
 * attributes. Adding a new credential kind: add a descriptor to
 * `CREDENTIAL_KINDS`, add a form here.
 *
 * Kinds without a registered form aren't issuable from the web UI.
 * They're still verifiable (verifier-mcp's spec list is independent),
 * just no "Get {noun} credential" entry shows up in the dropdown.
 */

export type FormComponent = ComponentType<CredentialFormPropsWithHandle>

const FORMS: Record<string, FormComponent> = {
  OrgMembershipCredential: OrgMembershipForm,
  GeoLocationCredential:   GeoLocationForm,
  // GuardianOfMinorCredential — issuance UI not wired yet (verifier still
  // works because verifier-mcp's spec is separate).
}

export interface IssuableCredentialKind {
  descriptor: CredentialKindDescriptor
  Form: FormComponent
}

export function listIssuableKinds(args: { hasActiveHub: boolean }): IssuableCredentialKind[] {
  return CREDENTIAL_KINDS
    .filter(k => FORMS[k.credentialType])
    .filter(k => !k.requiresActiveHub || args.hasActiveHub)
    .map(k => ({ descriptor: k, Form: FORMS[k.credentialType] }))
}

export function findIssuableKind(credentialType: string): IssuableCredentialKind | null {
  const descriptor = CREDENTIAL_KINDS.find(k => k.credentialType === credentialType)
  if (!descriptor) return null
  const Form = FORMS[credentialType]
  if (!Form) return null
  return { descriptor, Form }
}
