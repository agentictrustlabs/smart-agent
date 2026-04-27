'use client'

import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { getJoinableOrgsForHub, type JoinableOrg } from '@/lib/actions/onboarding/org-onboard.action'
import type { CredentialFormPropsWithHandle } from './types'

/**
 * Org membership form — picks an org from the active hub's joinable list
 * and lets the user enter a role label. Output attributes match the
 * `OrgMembershipCredential` schema:
 *
 *   { membershipStatus: 'active', role, joinedYear: <currentYear>, circleId }
 *
 * `extraIssueArgs.targetOrgAddress` is set so person-mcp's
 * `/credentials/store` records the credential against the right org for
 * display in `HeldCredentialsPanel`.
 */
export function OrgMembershipForm({
  busy, context, onSubmit, onValidationError, expose,
}: CredentialFormPropsWithHandle) {
  const [orgs, setOrgs] = useState<JoinableOrg[] | null>(null)
  const [orgAddress, setOrgAddress] = useState<string>('')
  const [role, setRole] = useState('member')
  const hubAddress = context.hubAddress

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!hubAddress) { setOrgs([]); return }
      const list = await getJoinableOrgsForHub(hubAddress).catch(() => [] as JoinableOrg[])
      if (cancelled) return
      setOrgs(list)
      if (list.length > 0) setOrgAddress(list[0].address)
    })()
    return () => { cancelled = true }
  }, [hubAddress])

  // Expose a stable handle to the parent so its submit button can
  // trigger us. Re-register whenever the resolved values change.
  useEffect(() => {
    expose({
      ready: Boolean(orgAddress) && (orgs?.length ?? 0) > 0,
      trigger: () => {
        onValidationError(null)
        const picked = orgs?.find(o => o.address === orgAddress)
        if (!picked) { onValidationError('Pick an organization'); return }
        onSubmit({
          attributes: {
            membershipStatus: 'active',
            role: role.trim() || 'member',
            joinedYear: String(new Date().getFullYear()),
            circleId: picked.primaryName || `0x${picked.address.slice(2, 10)}`,
          },
          extraIssueArgs: { targetOrgAddress: picked.address },
        })
      },
    })
  }, [orgAddress, orgs, role, expose, onSubmit, onValidationError])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
          Organization
        </label>
        {orgs === null ? (
          <div style={{ fontSize: 12, color: '#94a3b8', padding: '0.4rem 0' }}>Loading…</div>
        ) : !hubAddress ? (
          <div style={{ fontSize: 12, color: '#b91c1c', padding: '0.4rem 0' }}>
            No active hub.
          </div>
        ) : orgs.length === 0 ? (
          <div style={{ fontSize: 12, color: '#b91c1c', padding: '0.4rem 0' }}>
            No orgs in this hub yet — create one first.
          </div>
        ) : (
          <select
            value={orgAddress}
            onChange={(e) => setOrgAddress(e.target.value)}
            disabled={busy}
            style={{
              width: '100%', padding: '0.55rem 0.7rem',
              border: '1px solid #cbd5e1', borderRadius: 8,
              fontSize: 13, background: '#fff',
            }}
            data-testid="org-cred-org-picker"
          >
            {orgs.map(o => (
              <option key={o.address} value={o.address}>
                {o.displayName}{o.primaryName ? ` — ${o.primaryName}` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      <Input
        label="Role"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        placeholder="member"
        disabled={busy}
        data-testid="org-cred-role"
      />
    </div>
  )
}
