import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * /sign-up is no longer a standalone page. Account creation only makes
 * sense inside a specific hub (/h/{slug}), so we redirect to the root
 * hub picker.
 */
export default function SignUpPage() {
  redirect('/')
}
