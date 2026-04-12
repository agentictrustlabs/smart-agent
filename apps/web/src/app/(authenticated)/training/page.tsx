import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName } from '@smart-agent/sdk'
import { BDC_MODULES, REQUIRED_HOURS, TOTAL_HOURS } from '@/lib/togo'
import { TrainingClient } from './TrainingClient'

export default async function TrainingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  if (!selectedOrg) {
    return (
      <div data-page="training">
        <div data-component="page-header">
          <h1>Training</h1>
          <p>Select an organization to view training progress.</p>
        </div>
      </div>
    )
  }

  const templateId = (selectedOrg as Record<string, unknown>).templateId as string | null

  // Load training modules from DB (or use BDC defaults)
  let modules = await db.select().from(schema.trainingModules)
  if (modules.length === 0) {
    // Seed from BDC_MODULES
    for (const m of BDC_MODULES) {
      const exists = await db.select().from(schema.trainingModules).where(eq(schema.trainingModules.id, m.id)).limit(1)
      if (exists.length === 0) {
        await db.insert(schema.trainingModules).values({
          id: m.id, name: m.name, description: m.description,
          program: 'bdc', hours: m.hours, sortOrder: m.sortOrder,
        })
      }
    }
    modules = await db.select().from(schema.trainingModules)
  }

  // Find users to show training for
  const allUsers = await db.select().from(schema.users)
  const allPersonAgents = await db.select().from(schema.personAgents)
  const allCompletions = await db.select().from(schema.trainingCompletions)

  // Determine which users to show based on template
  type TraineeView = { userId: string; name: string; completions: typeof allCompletions }
  const trainees: TraineeView[] = []

  // Detect if current user has reviewer/advisor role on this org
  const personAgent = allPersonAgents.find(p => p.userId === currentUser.id)
  const userRolesOnOrg: string[] = []
  if (personAgent && selectedOrg) {
    try {
      const edgeIds = await getEdgesByObject(selectedOrg.smartAccountAddress as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.subject.toLowerCase() !== personAgent.smartAccountAddress.toLowerCase()) continue
        if (edge.status < 2) continue
        const roles = await getEdgeRoles(edgeId)
        userRolesOnOrg.push(...roles.map(r => roleName(r)))
      }
    } catch { /* ignored */ }
  }
  const isAssessorOrAdvisor = userRolesOnOrg.some(r => ['reviewer', 'advisor'].includes(r))

  if (templateId === 'portfolio-business') {
    // Business: show the owner's training (visible to owner, advisors, and reviewers)
    // Find the business owner
    const personAddrsSet = new Set(allPersonAgents.map(p => p.smartAccountAddress.toLowerCase()))
    try {
      const edgeIds = await getEdgesByObject(selectedOrg!.smartAccountAddress as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.status < 2) continue
        if (!personAddrsSet.has(edge.subject.toLowerCase())) continue
        const roles = await getEdgeRoles(edgeId)
        if (roles.map(r => roleName(r)).includes('owner')) {
          const pa = allPersonAgents.find(p => p.smartAccountAddress.toLowerCase() === edge.subject.toLowerCase())
          if (pa) {
            const user = allUsers.find(u => u.id === pa.userId)
            if (user && !trainees.some(t => t.userId === user.id)) {
              trainees.push({
                userId: user.id, name: user.name,
                completions: allCompletions.filter(c => c.userId === user.id),
              })
            }
          }
        }
      }
    } catch { /* ignored */ }
    // If no owner found, fall back to current user
    if (trainees.length === 0) {
      trainees.push({
        userId: currentUser.id, name: currentUser.name,
        completions: allCompletions.filter(c => c.userId === currentUser.id),
      })
    }
  } else {
    // CIL / ILAD / OOC — show all portfolio business owners
    const portfolioOrgs = await db.select().from(schema.orgAgents)
    const portfolioBizOrgs = portfolioOrgs.filter(o => (o as Record<string, unknown>).templateId === 'portfolio-business')
    const personAddrs = new Set(allPersonAgents.map(p => p.smartAccountAddress.toLowerCase()))

    for (const biz of portfolioBizOrgs) {
      try {
        const edgeIds = await getEdgesByObject(biz.smartAccountAddress as `0x${string}`)
        for (const edgeId of edgeIds) {
          const edge = await getEdge(edgeId)
          if (edge.status < 2) continue
          if (!personAddrs.has(edge.subject.toLowerCase())) continue
          const roles = await getEdgeRoles(edgeId)
          if (roles.map(r => roleName(r)).includes('owner')) {
            const pa = allPersonAgents.find(p => p.smartAccountAddress.toLowerCase() === edge.subject.toLowerCase())
            if (pa) {
              const user = allUsers.find(u => u.id === pa.userId)
              if (user && !trainees.some(t => t.userId === user.id)) {
                trainees.push({
                  userId: user.id,
                  name: user.name,
                  completions: allCompletions.filter(c => c.userId === user.id),
                })
              }
            }
          }
        }
      } catch { /* ignored */ }
    }
  }

  const canAssess = ['field-agency'].includes(templateId ?? '') || isAssessorOrAdvisor
  const allUserNames: Record<string, string> = {}
  for (const u of allUsers) allUserNames[u.id] = u.name

  return (
    <div data-page="training">
      <div data-component="page-header">
        <h1>Training{selectedOrg ? ` — ${selectedOrg.name}` : ''}</h1>
        <p>
          {templateId === 'portfolio-business'
            ? 'Your BDC training progress and certifications.'
            : templateId === 'field-agency'
              ? 'Manage and assess BDC training for portfolio businesses.'
              : 'Training progress across portfolio businesses.'}
        </p>
      </div>

      <TrainingClient
        modules={modules.sort((a, b) => a.sortOrder - b.sortOrder)}
        trainees={trainees}
        canAssess={canAssess}
        userNames={allUserNames}
        requiredHours={REQUIRED_HOURS}
        totalHours={TOTAL_HOURS}
      />
    </div>
  )
}
