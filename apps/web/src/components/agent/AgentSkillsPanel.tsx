import { listSkillsForAgentAction, type MySkillClaimRow } from '@/lib/actions/skill-claim.action'

/**
 * Read-only display of an agent's public skill claims. Used on the
 * agent viewer page (`/agents/<addr>`), parallel to the geo-locations
 * panel.
 *
 * v0 reads `AgentSkillRegistry.claimsBySubject` directly. Visibility
 * filter is implicit: only Public + PublicCoarse claims are returned
 * by the action. Private claims live in the holder's vault and never
 * surface here.
 */
export async function AgentSkillsPanel({ agentAddress }: { agentAddress: `0x${string}` }) {
  const claims = await listSkillsForAgentAction(agentAddress)
  const live = claims.filter(c => !c.revoked)

  if (live.length === 0) return null

  // Group by skill label for nicer display when an agent has multiple
  // claim types against the same skill (rare but possible — hasSkill +
  // practicesSkill from the same person).
  const bySkill = new Map<string, MySkillClaimRow[]>()
  for (const c of live) {
    const key = c.skillLabel
    const arr = bySkill.get(key) ?? []
    arr.push(c)
    bySkill.set(key, arr)
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
        }}>Skills</h2>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          {live.length} skill{live.length === 1 ? '' : 's'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {Array.from(bySkill.entries()).map(([label, rows]) => (
          <div
            key={label}
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr 1fr',
              gap: 10,
              alignItems: 'center',
              fontSize: 11,
              padding: '0.4rem 0.6rem',
              border: '1px solid #e5e7eb',
              borderRadius: 6,
              background: '#fafafa',
            }}
          >
            <span style={{ fontWeight: 600 }}>{label}</span>
            <span style={{ color: '#475569' }}>{rows.map(r => r.relation).join(', ')}</span>
            <span style={{ color: '#475569' }}>
              {rows[0].proficiencyLabel} ({(rows[0].proficiencyScore / 100).toFixed(0)}%)
            </span>
            <span style={{ color: '#94a3b8' }}>conf {rows[0].confidence}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
