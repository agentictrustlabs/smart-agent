'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  listSkillsAction,
  mintPublicSkillClaimAction,
  listMySkillClaimsAction,
  type SkillRow,
  type MySkillClaimRow,
} from '@/lib/actions/skill-claim.action'
import type { SkillRelationLabel } from '@smart-agent/sdk'

/**
 * Public on-chain skill publisher. Mirrors `AddGeoClaimPanel` for the
 * skill domain. v0 ships only the direct (self-attest) path:
 * `hasSkill` and `practicesSkill`. `certifiedIn` requires a
 * cross-issued endorsement (deferred to v1).
 *
 * proficiencyScore is captured as a 0–100 percent slider in the UI but
 * shipped to chain as 0–10000 basis-points so it composes continuously
 * with confidence and issuer-trust at scoring time.
 */

const SELF_RELATIONS: SkillRelationLabel[] = ['hasSkill', 'practicesSkill']

const PROF_PRESET = [
  { label: 'Basic',    value: 30 },
  { label: 'Advanced', value: 50 },
  { label: 'Cap (60)', value: 60 },  // self-attest hard cap
]

export function AddSkillClaimPanel() {
  const [skills, setSkills] = useState<SkillRow[] | null>(null)
  const [myClaims, setMyClaims] = useState<MySkillClaimRow[] | null>(null)
  const [skillId, setSkillId] = useState('')
  const [skillVersion, setSkillVersion] = useState('1')
  const [relation, setRelation] = useState<SkillRelationLabel>('practicesSkill')
  const [proficiencyPct, setProficiencyPct] = useState(50)  // 0..60 self-attest cap
  const [confidence, setConfidence] = useState(80)
  const [pending, start] = useTransition()
  const [info, setInfo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (skills && myClaims) return
    start(async () => {
      const [rows, mine] = await Promise.all([
        skills ? Promise.resolve(skills) : listSkillsAction(),
        listMySkillClaimsAction(),
      ])
      setSkills(rows)
      setMyClaims(mine)
      if (!skillId && rows.length > 0) {
        setSkillId(rows[0].skillId)
        setSkillVersion(rows[0].version)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function publishSkill() {
    setInfo(null); setErr(null)
    if (!skillId) { setErr('Pick a skill'); return }
    if (proficiencyPct > 60) { setErr('Self-attestation is capped at 60%. Higher proficiency requires a third-party issuer (v1).'); return }
    start(async () => {
      const r = await mintPublicSkillClaimAction({
        skillId: skillId as `0x${string}`,
        skillVersion: parseInt(skillVersion, 10) || 1,
        relation,
        proficiencyScore: Math.round(proficiencyPct * 100),  // 0..60 → 0..6000
        confidence,
      })
      if (r.success) {
        setInfo(`Public skill claim added (${r.claimId?.slice(0, 10)}…). Anyone reading the skill registry can now see this binding.`)
        const mine = await listMySkillClaimsAction()
        setMyClaims(mine)
      } else {
        setErr(r.error ?? 'failed')
      }
    })
  }

  return (
    <div style={{
      background: '#fff', border: '1px solid #ece6db', borderRadius: 12,
      padding: '1rem 1.25rem', marginBottom: '1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{
          fontSize: '0.7rem', fontWeight: 700, color: '#9a8c7e',
          textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0,
        }}>My Public Skills</h2>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          {myClaims === null
            ? 'loading…'
            : `${myClaims.length} skill${myClaims.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, color: '#64748b' }}>
          Pick a skill, claim type, and confidence. Self-attested
          claims are capped at 60% proficiency — for <code>certifiedIn</code> or
          higher proficiency, you need a third-party issuer to sign an
          endorsement (deferred to v1). Your claims are public and feed
          the trust-search skill column.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 100px', gap: 8 }}>
          <select
            value={skillId}
            onChange={e => {
              setSkillId(e.target.value)
              const row = skills?.find(s => s.skillId === e.target.value)
              if (row) setSkillVersion(row.version)
            }}
            style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
            data-testid="skill-claim-skill"
          >
            {skills === null && <option>Loading…</option>}
            {skills?.length === 0 && <option>No skills published</option>}
            {skills?.map(s => (
              <option key={s.skillId} value={s.skillId}>{s.label}</option>
            ))}
          </select>
          <select
            value={relation}
            onChange={e => setRelation(e.target.value as SkillRelationLabel)}
            style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
            data-testid="skill-claim-relation"
          >
            {SELF_RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select
            value={proficiencyPct}
            onChange={e => setProficiencyPct(parseInt(e.target.value, 10))}
            style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
            data-testid="skill-claim-proficiency"
            title="Self-attest cap is 60%"
          >
            {PROF_PRESET.map(p => (
              <option key={p.value} value={p.value}>{p.label} ({p.value}%)</option>
            ))}
          </select>
          <input
            type="number"
            value={confidence}
            onChange={e => setConfidence(parseInt(e.target.value || '0', 10))}
            min={0}
            max={100}
            style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
            data-testid="skill-claim-confidence"
            title="Confidence 0..100"
          />
          <button
            type="button"
            onClick={publishSkill}
            disabled={pending || !skillId}
            style={{
              padding: '0.4rem 0.8rem',
              background: '#3f6ee8', color: '#fff',
              border: 'none', borderRadius: 6,
              fontSize: 12, fontWeight: 600,
              cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
            data-testid="skill-claim-publish"
            title="Public on-chain skill claim"
          >
            {pending ? '…' : 'Add'}
          </button>
        </div>
        {info && <span style={{ fontSize: 11, color: '#15803d' }}>{info}</span>}
        {err && <span style={{ fontSize: 11, color: '#b91c1c' }}>{err}</span>}

        {myClaims !== null && myClaims.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px dashed #e5e7eb' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {myClaims.map(c => (
                <div
                  key={c.claimId}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr auto',
                    gap: 10,
                    alignItems: 'center',
                    fontSize: 11,
                    padding: '0.4rem 0.6rem',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    background: c.revoked ? '#fef2f2' : '#fafafa',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{c.skillLabel}</span>
                  <span style={{ color: '#475569' }}>{c.relation}</span>
                  <span style={{ color: '#475569' }}>{c.proficiencyLabel} ({(c.proficiencyScore / 100).toFixed(0)}%)</span>
                  <span style={{ color: '#94a3b8' }}>conf {c.confidence}</span>
                  <span style={{ color: c.revoked ? '#b91c1c' : '#64748b', fontFamily: 'monospace' }}>
                    {c.revoked ? 'revoked' : c.visibility}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
