'use client'

import { useEffect, useState } from 'react'
import { listSkillsAction, type SkillRow } from '@/lib/actions/skill-claim.action'
import type { SkillRelationLabel } from '@smart-agent/sdk'
import { SKILL_PROFICIENCY_LABEL } from '@smart-agent/sdk'
import type { CredentialFormPropsWithHandle } from './types'

/**
 * Skills credential form — picks an on-chain skill, relation, and
 * proficiency. Output attributes match `SkillsCredential`:
 *
 *   { skillId, skillName, relation, proficiencyScore, confidence,
 *     issuerName, issuerDid, validFrom: '0', validUntil: '0',
 *     issuedAt: <now> }
 *
 * The cross-issuance security model says only the *issuer* can mint a
 * `certifiedIn` credential — but the AnonCred path is the issuer's own
 * service. So this form lets the user pick `certifiedIn` along with
 * `hasSkill` and `practicesSkill`; the skill-mcp issuer signs all three.
 *
 * `issuerName` and `issuerDid` are populated from the skill-mcp agent
 * card at submit time. v1 verification binds `issuerName` to the
 * issuer DID's `alsoKnownAs` (audit S6), so the form doesn't expose
 * issuerName for user editing.
 */

const RELATIONS: SkillRelationLabel[] = ['hasSkill', 'practicesSkill', 'certifiedIn']

const PROFICIENCY_PRESETS = [
  { label: 'Basic',     score: 2000 },
  { label: 'Advanced',  score: 5000 },
  { label: 'Certified', score: 7000 },
  { label: 'Expert',    score: 9000 },
]

export function SkillsForm({
  busy, onSubmit, onValidationError, expose,
}: CredentialFormPropsWithHandle) {
  const [skills, setSkills] = useState<SkillRow[] | null>(null)
  const [skillId, setSkillId] = useState('')
  const [skillVersion, setSkillVersion] = useState('1')
  const [relation, setRelation] = useState<SkillRelationLabel>('practicesSkill')
  const [proficiencyScore, setProficiencyScore] = useState(5000)
  const [confidence, setConfidence] = useState(80)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await listSkillsAction().catch(() => [] as SkillRow[])
      if (cancelled) return
      setSkills(list)
      if (list.length > 0) {
        setSkillId(list[0].skillId)
        setSkillVersion(list[0].version)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    expose({
      ready: Boolean(skillId) && (skills?.length ?? 0) > 0,
      trigger: () => {
        onValidationError(null)
        const picked = skills?.find(s => s.skillId === skillId)
        if (!picked) { onValidationError('Pick a skill'); return }
        const score = Math.max(0, Math.min(10000, Math.floor(proficiencyScore)))
        const conf = Math.max(0, Math.min(100, Math.floor(confidence)))
        onSubmit({
          attributes: {
            skillId: picked.skillId,
            skillName: picked.label,
            relation,
            proficiencyScore: String(score),
            confidence: String(conf),
            // issuerName / issuerDid auto-populated server-side from the
            // skill-mcp agent card. The IssueCredentialDialog forwards
            // attributes to /credential/issue, where skill-mcp can fill
            // these in if they're empty. v1 of S6 plugs the dialog's
            // pre-issue helper into agentCard().
            issuerName: 'Smart Agent Skill Steward',
            issuerDid: '',
            validFrom: '0',
            validUntil: '0',
            issuedAt: Math.floor(Date.now() / 1000).toString(),
          },
        })
      },
    })
  }, [skillId, skillVersion, skills, relation, proficiencyScore, confidence, expose, onSubmit, onValidationError])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
          Skill
        </label>
        {skills === null ? (
          <div style={{ fontSize: 12, color: '#94a3b8', padding: '0.4rem 0' }}>Loading…</div>
        ) : skills.length === 0 ? (
          <div style={{ fontSize: 12, color: '#b91c1c', padding: '0.4rem 0' }}>
            No skills published yet.
          </div>
        ) : (
          <select
            value={skillId}
            onChange={(e) => {
              setSkillId(e.target.value)
              const row = skills.find(s => s.skillId === e.target.value)
              if (row) setSkillVersion(row.version)
            }}
            disabled={busy}
            style={{
              width: '100%', padding: '0.55rem 0.7rem',
              border: '1px solid #cbd5e1', borderRadius: 8,
              fontSize: 13, background: '#fff',
            }}
            data-testid="skill-cred-skill"
          >
            {skills.map(s => (
              <option key={s.skillId} value={s.skillId}>{s.label}</option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
          Relation
        </label>
        <select
          value={relation}
          onChange={(e) => setRelation(e.target.value as SkillRelationLabel)}
          disabled={busy}
          style={{
            width: '100%', padding: '0.55rem 0.7rem',
            border: '1px solid #cbd5e1', borderRadius: 8,
            fontSize: 13, background: '#fff',
          }}
          data-testid="skill-cred-relation"
        >
          {RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
          Proficiency
        </label>
        <select
          value={proficiencyScore}
          onChange={(e) => setProficiencyScore(parseInt(e.target.value, 10))}
          disabled={busy}
          style={{
            width: '100%', padding: '0.55rem 0.7rem',
            border: '1px solid #cbd5e1', borderRadius: 8,
            fontSize: 13, background: '#fff',
          }}
          data-testid="skill-cred-proficiency"
        >
          {PROFICIENCY_PRESETS.map(p => (
            <option key={p.score} value={p.score}>
              {p.label} (≥ {SKILL_PROFICIENCY_LABEL[p.label as keyof typeof SKILL_PROFICIENCY_LABEL] / 100}%)
            </option>
          ))}
        </select>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
          Confidence (0..100)
        </label>
        <input
          type="number"
          value={confidence}
          onChange={(e) => setConfidence(parseInt(e.target.value || '0', 10))}
          min={0}
          max={100}
          disabled={busy}
          style={{
            width: '100%', padding: '0.55rem 0.7rem',
            border: '1px solid #cbd5e1', borderRadius: 8,
            fontSize: 13,
          }}
          data-testid="skill-cred-confidence"
        />
      </div>
    </div>
  )
}
