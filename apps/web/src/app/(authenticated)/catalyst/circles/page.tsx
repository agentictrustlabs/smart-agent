import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getCircles } from '@/lib/actions/circles.action'
import { CirclesClient } from './CirclesClient'

export default async function CatalystCirclesPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const circles = await getCircles(currentUser.id)

  return <CirclesClient circles={circles} />
}
