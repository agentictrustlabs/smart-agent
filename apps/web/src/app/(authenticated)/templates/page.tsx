import { getTemplateCount, getTemplate } from '@/lib/contracts'
import { roleName, relationshipTypeName } from '@smart-agent/sdk'

export default async function TemplatesPage() {
  const templates: Array<{
    id: number
    name: string
    description: string
    role: string
    relationshipType: string
    active: boolean
    createdBy: string
  }> = []

  try {
    const count = await getTemplateCount()
    for (let i = 0n; i < count; i++) {
      const t = await getTemplate(i)
      templates.push({
        id: Number(t.id),
        name: t.name,
        description: t.description,
        role: roleName(t.role, undefined, 'catalyst'),
        relationshipType: relationshipTypeName(t.relationshipType, undefined, 'catalyst'),
        active: t.active,
        createdBy: t.createdBy,
      })
    }
  } catch {
    // template contract may not be deployed
  }

  return (
    <div data-page="templates">
      <div data-component="page-header">
        <h1>Delegation Templates</h1>
        <p>
          DnS Descriptions mapping (relationshipType, role) pairs to permitted delegation
          patterns and caveat requirements. Templates define what a role means operationally.
        </p>
      </div>

      <div data-component="protocol-info">
        <h3>Protocol Contract</h3>
        <dl>
          <dt>AgentRelationshipTemplate</dt>
          <dd data-component="address">{process.env.AGENT_TEMPLATE_ADDRESS}</dd>
        </dl>
      </div>

      {templates.length === 0 ? (
        <div data-component="empty-state">
          <p>No templates registered. Run <code>scripts/seed-graph.sh</code> to create example templates.</p>
        </div>
      ) : (
        <div data-component="template-grid">
          {templates.map((t) => (
            <div key={t.id} data-component="template-full-card" data-active={t.active ? 'true' : 'false'}>
              <div data-component="template-full-header">
                <h3>{t.name}</h3>
                <span data-component="role-badge" data-status={t.active ? 'active' : 'proposed'}>
                  {t.active ? 'active' : 'inactive'}
                </span>
              </div>
              <p data-component="template-desc">{t.description}</p>
              <div data-component="template-meta">
                <dl>
                  <dt>Relationship Type</dt>
                  <dd><span data-component="role-badge">{t.relationshipType}</span></dd>
                  <dt>Role</dt>
                  <dd><span data-component="role-badge">{t.role}</span></dd>
                  <dt>Template ID</dt>
                  <dd>#{t.id}</dd>
                </dl>
              </div>
              <div data-component="template-meaning">
                <h4>What this means</h4>
                <p>
                  When an agent holds the <strong>{t.role}</strong> role in a
                  <strong> {t.relationshipType}</strong> relationship, this template defines
                  the delegation capabilities, required caveats, and constraints that apply.
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
