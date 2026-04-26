import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * /sign-in is no longer a standalone page. Authentication only makes
 * sense in the context of a specific hub (/h/{slug}), so we redirect to
 * the root hub picker. Anyone landing here from a stale link picks a
 * hub first, then onboards in that hub's context.
 */
export default function SignInPage() {
  redirect('/')
}
