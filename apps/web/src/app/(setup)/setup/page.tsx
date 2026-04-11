import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { SetupWizardClient } from './SetupWizardClient'
import { ORG_TEMPLATES } from '@/lib/org-templates.data'

export default async function SetupPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  return (
    <div data-page="setup">
      <SetupWizardClient templates={ORG_TEMPLATES} />
    </div>
  )
}
