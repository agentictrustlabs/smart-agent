import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { resolveUserHomePath } from '@/lib/post-login-redirect'

/**
 * /catalyst is no longer a default landing page. The hub-specific dashboard
 * lives at /h/catalyst/home and only renders for users actually in the
 * Catalyst hub. Anyone hitting /catalyst (e.g. from a stale link) is sent
 * to their resolved home: their own hub if they have one, else /dashboard.
 */
export default async function CatalystLegacyRedirect() {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  redirect(await resolveUserHomePath(user.id))
}
