import { redirect } from 'next/navigation'

// Dashboard redirects to the hub home — all navigation is hub-driven
export default function DashboardPage() {
  redirect('/catalyst')
}
