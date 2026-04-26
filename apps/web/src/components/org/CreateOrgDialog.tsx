'use client'

import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createOrgInHub } from '@/lib/actions/onboarding/org-onboard.action'
import { fetchTemplatesForHub, type OrgTemplateOption } from '@/lib/actions/onboarding/template-list.action'

interface CreateOrgDialogProps {
  /** Hub the new org will be added to (HAS_MEMBER edge subject=hub, object=org). */
  hubAddress: string
  /** Hub label shown in the dialog title; e.g. "Catalyst NoCo Network". */
  hubName: string
  /**
   * Internal hub id (catalyst | cil | global-church | generic). Drives the
   * template picker — only templates registered to this hub are listed.
   */
  hubId: 'catalyst' | 'cil' | 'global-church' | 'generic'
  /** Called after the org is created on-chain. orgAddress is the new address. */
  onCreated: (orgAddress: string) => void
  /** Called when the user cancels (clicks backdrop or Cancel button). */
  onCancel: () => void
}

/**
 * Inline org-creation modal. Used by HubOnboardClient's `org` step and by
 * the "Create organization" surfaces on the hub dropdown / hub home.
 *
 * Three required fields: template, name, description. Governance defaults
 * to 1/1 (single owner, single signer); users who need richer config tune
 * that from the org dashboard after creation.
 */
export function CreateOrgDialog({ hubAddress, hubName, hubId, onCreated, onCancel }: CreateOrgDialogProps) {
  const [templates, setTemplates] = useState<OrgTemplateOption[] | null>(null)
  const [templateId, setTemplateId] = useState<string>('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await fetchTemplatesForHub(hubId).catch(() => [] as OrgTemplateOption[])
      if (cancelled) return
      setTemplates(list)
      if (list.length > 0) setTemplateId(list[0].id)
    })()
    return () => { cancelled = true }
  }, [hubId])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!templateId) { setErr('Pick an organization type'); return }
    if (!name.trim()) { setErr('Organization name required'); return }
    start(async () => {
      const r = await createOrgInHub({
        hubAddress,
        name: name.trim(),
        description: description.trim(),
        templateId,
      })
      if (!r.success || !r.orgAddress) { setErr(r.error ?? 'Create failed'); return }
      onCreated(r.orgAddress)
    })
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 16,
          boxShadow: '0 24px 80px rgba(15, 23, 42, 0.30)',
          width: '100%', maxWidth: 480, padding: '1.25rem 1.25rem 1.5rem',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#171c28', margin: '0 0 4px' }}>
          Create an organization
        </h2>
        <p style={{ fontSize: 13, color: '#5d6478', margin: '0 0 16px' }}>
          New org under <b>{hubName || 'this hub'}</b>. You'll be added as a founding member.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
              Organization type
            </label>
            {templates === null ? (
              <div style={{ fontSize: 12, color: '#94a3b8', padding: '0.4rem 0' }}>Loading types…</div>
            ) : templates.length === 0 ? (
              <div style={{ fontSize: 12, color: '#b91c1c', padding: '0.4rem 0' }}>
                No org templates registered for this hub.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {templates.map(t => (
                  <label
                    key={t.id}
                    style={{
                      display: 'flex', gap: 10, alignItems: 'flex-start',
                      padding: '0.55rem 0.7rem',
                      border: `2px solid ${templateId === t.id ? t.color : '#e2e8f0'}`,
                      borderRadius: 8, cursor: 'pointer',
                      background: templateId === t.id ? `${t.color}10` : '#fff',
                    }}
                  >
                    <input
                      type="radio"
                      name="org-template"
                      value={t.id}
                      checked={templateId === t.id}
                      onChange={() => setTemplateId(t.id)}
                      style={{ marginTop: 2 }}
                    />
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: '#171c28' }}>{t.name}</span>
                        {t.featured && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            color: t.color, background: `${t.color}15`,
                            padding: '1px 6px', borderRadius: 999,
                          }}>
                            Recommended
                          </span>
                        )}
                      </span>
                      <span style={{ display: 'block', fontSize: 12, color: '#64748b', marginTop: 2 }}>{t.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <Input
            label="Organization name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Iglesia Esperanza"
            required
            data-testid="create-org-name"
          />
          <Input
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this org do?"
            data-testid="create-org-description"
          />

          {err && (
            <div role="alert" style={{
              padding: '0.55rem 0.75rem', background: '#fef2f2',
              border: '1px solid #fecaca', color: '#b91c1c',
              borderRadius: 8, fontSize: 12,
            }}>
              {err}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <Button type="button" variant="outlined" onClick={onCancel} disabled={pending} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !templateId} className="flex-1" data-testid="create-org-submit">
              {pending ? 'Creating…' : 'Create organization'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
