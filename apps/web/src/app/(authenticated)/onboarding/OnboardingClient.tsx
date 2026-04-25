'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import {
  ensurePersonAgentRegistered,
  registerPersonalAgentName,
  markOnboardingComplete,
  startFreshAccount,
} from '@/lib/actions/onboarding/setup-agent.action'
import {
  prepareReAuthBootstrapAction,
  completeReAuthBootstrapAction,
} from '@/lib/actions/onboarding/repair-account.action'
import { packWebAuthnSignature } from '@smart-agent/sdk'

interface HubChoice {
  address: string
  primaryName: string
  displayName: string
  parentNode: `0x${string}`
}

type StepId = 'profile' | 'register' | 'name' | 'choose'

interface InitialStatus {
  authenticated: boolean
  via?: 'demo' | 'passkey' | 'siwe' | 'google' | null
  profileComplete: boolean
  agentRegistered: boolean
  hasAgentName: boolean
  primaryName?: string
  smartAccountAddress?: string | null
}

interface OnboardingClientProps {
  initialStatus: InitialStatus
  currentName: string
  currentEmail: string
  hubs: HubChoice[]
}

/**
 * Onboarding wizard for non-demo users.
 *
 *   profile  → register agent → pick .agent name → choose path
 *
 * Each step is gated by a server action that checks current state, so a
 * partial completion plus reload picks up where the user left off.
 *
 * Demo users have a shorter flow (profile → choose); the registry + name are
 * pre-seeded for demo accounts.
 */
export function OnboardingClient({ initialStatus, currentName, currentEmail, hubs }: OnboardingClientProps) {
  const router = useRouter()
  const isDemo = initialStatus.via === 'demo'

  // Decide the step to land on based on what's already complete.
  const initialStep: StepId =
    !initialStatus.profileComplete
      ? 'profile'
      : isDemo
        ? 'choose'
        : !initialStatus.agentRegistered
          ? 'register'
          : !initialStatus.hasAgentName
            ? 'name'
            : 'choose'

  const [step, setStep] = useState<StepId>(initialStep)
  // Captured from NameStep so ChooseStep can confirm the registration to the
  // user. Falls back to whatever the server already had cached on page load.
  const [registeredName, setRegisteredName] = useState<string | null>(initialStatus.primaryName ?? null)
  const [registeredWarnings, setRegisteredWarnings] = useState<string[]>([])

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-6">
        <StepIndicator step={step} demo={isDemo} />
        {step === 'profile' && (
          <ProfileStep
            initialName={currentName === 'Agent User' ? '' : currentName}
            initialEmail={currentEmail}
            onDone={() => setStep(isDemo ? 'choose' : 'register')}
          />
        )}
        {step === 'register' && (
          <RegisterStep onDone={() => setStep('name')} />
        )}
        {step === 'name' && (
          <NameStep
            hubs={hubs}
            onDone={(fullName, warnings) => {
              setRegisteredName(fullName)
              setRegisteredWarnings(warnings ?? [])
              setStep('choose')
            }}
            onSkip={() => setStep('choose')}
          />
        )}
        {step === 'choose' && (
          <ChooseStep
            displayName={currentName === 'Agent User' ? '' : currentName}
            registeredName={registeredName}
            registeredWarnings={registeredWarnings}
            smartAccountAddress={initialStatus.smartAccountAddress ?? null}
            onPick={async (target) => {
              // Mark complete BEFORE navigating so the (authenticated) layout
              // guard sees the flag on the destination page and doesn't bounce
              // back to /onboarding. Use a hard navigation so the destination
              // re-fetches /api/auth/profile fresh — the upper-right dropdown
              // picks up the newly-registered .agent name on its next mount.
              await markOnboardingComplete().catch(() => {})
              window.location.href = target
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}

// ─── Step indicator ───────────────────────────────────────────────────

function StepIndicator({ step, demo }: { step: StepId; demo: boolean }) {
  const steps: StepId[] = demo ? ['profile', 'choose'] : ['profile', 'register', 'name', 'choose']
  const idx = steps.indexOf(step)
  return (
    <div className="flex items-center gap-2 mb-5">
      {steps.map((s, i) => (
        <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <span
            style={{
              width: 28, height: 28, borderRadius: 999,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 600,
              background: i <= idx ? '#3f6ee8' : '#e2e8f0',
              color: i <= idx ? '#fff' : '#475569',
            }}
          >{i + 1}</span>
          {i < steps.length - 1 && (
            <span style={{ flex: 1, height: 2, background: i < idx ? '#3f6ee8' : '#e2e8f0' }} />
          )}
        </span>
      ))}
    </div>
  )
}

// ─── Step 1: Profile ──────────────────────────────────────────────────

function ProfileStep({ initialName, initialEmail, onDone }: {
  initialName: string; initialEmail: string; onDone: () => void
}) {
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (!email.trim() || !email.includes('@')) { setError('Valid email is required'); return }
    setSaving(true); setError('')
    const res = await fetch('/api/auth/profile', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), email: email.trim() }),
    })
    if (res.ok) onDone()
    else { setError('Failed to save profile'); setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h2 className="text-title-lg font-semibold text-on-surface mb-1">Your profile</h2>
        <p className="text-body-sm text-on-surface-variant">How should we address you?</p>
      </div>
      <Input label="Display Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alice Smith" required />
      <Input label="Email Address" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alice@example.com" required />
      {error && (
        <div className="rounded-sm bg-error-container p-3 text-body-md text-error" role="alert">{error}</div>
      )}
      <Button type="submit" disabled={saving} size="lg" className="w-full">
        {saving ? 'Saving…' : 'Continue'}
      </Button>
    </form>
  )
}

// ─── Step 2: Register agent on-chain ──────────────────────────────────

function RegisterStep({ onDone }: { onDone: () => void }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [needsRecovery, setNeedsRecovery] = useState(false)
  const [needsRepair, setNeedsRepair] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'registering' | 'awaiting-passkey' | 'submitting-repair' | 'done'>('idle')

  // Pre-flight the server-as-owner state. If the bootstrap server isn't in
  // _owners, the user must passkey-sign a repair UserOp before any
  // deployer-signed resolver writes can succeed.
  const checkAndRun = () => {
    setError(null)
    setPhase('registering')
    start(async () => {
      const repair = await prepareReAuthBootstrapAction()
      if (!repair.success) {
        setError(repair.error ?? 'Repair check failed')
        setPhase('idle')
        return
      }
      if (!repair.alreadyOwner) {
        // Stuck-state account; surface the passkey prompt.
        setNeedsRepair(true)
        setPhase('awaiting-passkey')
        return
      }
      // Server is an owner — register normally.
      const r = await ensurePersonAgentRegistered()
      if (r.success) { setPhase('done'); onDone() }
      else { setError(r.error ?? 'Registration failed'); setPhase('idle') }
    })
  }

  const runRepairAndRegister = () => {
    setError(null)
    setPhase('awaiting-passkey')
    start(async () => {
      try {
        // Re-fetch a fresh nonce snapshot to avoid replays of stale prepare.
        const prep = await prepareReAuthBootstrapAction()
        if (!prep.success) { setError(prep.error ?? 'Prepare failed'); setPhase('idle'); return }
        if (prep.alreadyOwner) {
          // Race: someone else already repaired.
          const r = await ensurePersonAgentRegistered()
          if (r.success) { setPhase('done'); onDone() }
          else { setError(r.error ?? 'Registration failed'); setPhase('idle') }
          return
        }
        if (!prep.userOpHash || !prep.unsignedOp) {
          setError('Invalid prepare response'); setPhase('idle'); return
        }

        // WebAuthn — challenge is the userOpHash. Constrain the OS picker to
        // credentials actually registered on this account. Server-side mirror
        // is the source of truth; localStorage is a legacy hint.
        const challengeBytes = hexToBytes(prep.userOpHash)
        const challengeAb = new ArrayBuffer(challengeBytes.length)
        new Uint8Array(challengeAb).set(challengeBytes)
        const serverKnown = prep.knownCredentialIds ?? []
        const localKnown = (() => {
          try {
            const arr = JSON.parse(localStorage.getItem('smart-agent.passkeys.local') ?? '[]') as Array<{ id: string }>
            return arr.map(k => k.id)
          } catch { return [] }
        })()
        const credentialIds = Array.from(new Set([...serverKnown, ...localKnown]))
        // Fall back to the unfiltered picker when we have no hints (legacy
        // accounts mirrored before the passkeys table existed). The submit
        // step will surface a clear error if the user picks one that isn't
        // registered on this account.
        const allowCredentials = credentialIds.length > 0
          ? credentialIds.map((id) => {
              const idBytes = base64UrlDecode(id)
              const idAb = new ArrayBuffer(idBytes.length)
              new Uint8Array(idAb).set(idBytes)
              return { type: 'public-key' as const, id: idAb }
            })
          : undefined
        const cred = await navigator.credentials.get({
          publicKey: {
            challenge: challengeAb,
            rpId: window.location.hostname,
            userVerification: 'preferred',
            timeout: 60_000,
            allowCredentials,
          },
        }) as PublicKeyCredential | null
        if (!cred) { setError('Cancelled'); setPhase('idle'); return }
        const resp = cred.response as AuthenticatorAssertionResponse
        const credentialIdBytes = new Uint8Array(cred.rawId)
        const credentialIdBase64Url = base64UrlEncode(credentialIdBytes)
        const passkeySig = packWebAuthnSignature({
          credentialIdBytes,
          authenticatorData: new Uint8Array(resp.authenticatorData),
          clientDataJSON: new Uint8Array(resp.clientDataJSON),
          derSignature: new Uint8Array(resp.signature),
        })
        // Tag with WebAuthn type byte so AgentAccount._validateSig dispatches
        // to the passkey verification path.
        const userOpSig = ('0x01' + passkeySig.slice(2)) as `0x${string}`

        setPhase('submitting-repair')
        const submitted = await completeReAuthBootstrapAction({
          unsignedOp: prep.unsignedOp,
          passkeySignature: userOpSig,
          credentialIdBase64Url,
        })
        if (!submitted.success) {
          if (submitted.error === 'PASSKEY_NOT_REGISTERED') {
            setNeedsRecovery(true)
            setError('The passkey you picked isn\'t registered on this account.')
          } else {
            setError(submitted.error ?? 'Repair submission failed')
          }
          setPhase('idle')
          return
        }

        // Server is now an owner — registration runs against a healthy account.
        const r = await ensurePersonAgentRegistered()
        if (r.success) { setPhase('done'); onDone() }
        else { setError(r.error ?? 'Registration failed'); setPhase('idle') }
      } catch (err) {
        setError((err as Error).message)
        setPhase('idle')
      }
    })
  }

  // Auto-run on mount; registration is idempotent.
  useEffect(() => {
    checkAndRun()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-title-lg font-semibold text-on-surface mb-1">Registering your agent</h2>
        <p className="text-body-sm text-on-surface-variant">
          Recording your smart account in the on-chain agent registry so others can discover and trust it.
        </p>
      </div>
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '1rem', fontSize: 13, color: '#475569', textAlign: 'center' }}>
        {phase === 'registering' && '⏳ Recording on-chain…'}
        {phase === 'awaiting-passkey' && needsRepair && '🔐 Authorize this device with your passkey'}
        {phase === 'submitting-repair' && '⏳ Re-authorizing on-chain…'}
        {phase === 'done' && '✓ Done'}
        {phase === 'idle' && !error && '✓ Ready'}
        {error && <span style={{ color: '#c62828' }}>✗ {error}</span>}
      </div>
      {needsRepair && phase === 'awaiting-passkey' && !needsRecovery && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', padding: '0.75rem', borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
          Your account previously had the bootstrap server removed. Tap the button below to
          re-authorize it with your passkey — this is a one-time on-chain repair so the
          name registry and resolver records can be written.
        </div>
      )}
      {needsRecovery && (
        <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e', padding: '0.75rem', borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
          The passkey you chose isn&apos;t registered on this smart account. Three options:
          <ul style={{ margin: '6px 0 0 0', paddingLeft: 18 }}>
            <li>Retry — pick a different passkey from the OS prompt.</li>
            <li>Open the <a href="/recover-device" style={{ color: '#92400e', fontWeight: 600, textDecoration: 'underline' }}>recovery flow</a> to add a fresh passkey via the timelock + guardian delegation.</li>
            <li>Abandon this account and start over with a brand-new smart account at a fresh deterministic address.</li>
          </ul>
          <div style={{ marginTop: 10 }}>
            <button
              onClick={async () => {
                if (!confirm('Abandon this smart account and start over? Your old account stays on-chain but unreferenced; you\'ll be signed out and your next Google sign-in will deploy a fresh account.')) return
                const r = await startFreshAccount()
                if (!r.success) { setError(r.error ?? 'Start-fresh failed'); return }
                // Sign out so the next sign-in picks up the new salt rotation.
                await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
                window.location.href = '/sign-in'
              }}
              style={{
                background: '#92400e', color: '#fff', border: 0,
                padding: '0.45rem 0.85rem', borderRadius: 6,
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
              data-testid="register-start-fresh"
            >
              Start fresh with a new account →
            </button>
          </div>
        </div>
      )}
      {needsRepair && (phase === 'awaiting-passkey' || phase === 'submitting-repair') && !pending && (
        <Button onClick={runRepairAndRegister} disabled={pending} size="lg" className="w-full">
          {needsRecovery ? 'Try a different passkey' : 'Authorize with passkey'}
        </Button>
      )}
      {error && !needsRecovery && (
        <Button onClick={needsRepair ? runRepairAndRegister : checkAndRun} disabled={pending} size="lg" className="w-full">
          Retry
        </Button>
      )}
      {phase === 'done' && (
        <Button onClick={onDone} size="lg" className="w-full">Continue</Button>
      )}
    </div>
  )
}

// ─── Step 3: Pick .agent name ─────────────────────────────────────────

function NameStep({ hubs, onDone, onSkip }: {
  hubs: HubChoice[]
  onDone: (fullName: string, warnings?: string[]) => void
  onSkip: () => void
}) {
  const [mode, setMode] = useState<'root' | 'hub'>('root')
  const [label, setLabel] = useState('')
  const [hub, setHub] = useState<string>(hubs[0]?.primaryName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const preview = !label.trim()
    ? '—'
    : mode === 'root'
      ? `${label.toLowerCase().trim()}.agent`
      : hub ? `${label.toLowerCase().trim()}.${hub}` : `${label.toLowerCase().trim()}.agent`

  function submit() {
    setError(null)
    if (!label.trim()) { setError('Pick a label'); return }
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label.toLowerCase().trim())) {
      setError('Letters, numbers, and hyphens only — no leading or trailing hyphens')
      return
    }
    start(async () => {
      const parentName = mode === 'hub' ? hub : undefined
      const r = await registerPersonalAgentName({ label: label.toLowerCase().trim(), parentName })
      if (r.success && r.fullName) onDone(r.fullName, r.warnings)
      else setError(r.error ?? 'Name registration failed')
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-title-lg font-semibold text-on-surface mb-1">Choose your <code>.agent</code> name</h2>
        <p className="text-body-sm text-on-surface-variant">Your human-readable handle on the trust graph. You can skip this and pick one later.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.75rem', border: `2px solid ${mode === 'root' ? '#3f6ee8' : '#e2e8f0'}`, borderRadius: 8, cursor: 'pointer' }}>
          <input type="radio" name="mode" checked={mode === 'root'} onChange={() => setMode('root')} />
          <span><b>Root</b> — <code>{label.toLowerCase().trim() || 'name'}.agent</code></span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.75rem', border: `2px solid ${mode === 'hub' ? '#3f6ee8' : '#e2e8f0'}`, borderRadius: 8, cursor: hubs.length === 0 ? 'not-allowed' : 'pointer', opacity: hubs.length === 0 ? 0.5 : 1 }}>
          <input type="radio" name="mode" checked={mode === 'hub'} disabled={hubs.length === 0} onChange={() => setMode('hub')} />
          <span><b>Under a hub</b> — <code>{label.toLowerCase().trim() || 'name'}.{hub || 'hub.agent'}</code></span>
        </label>
        {mode === 'hub' && hubs.length > 0 && (
          <select value={hub} onChange={(e) => setHub(e.target.value)} style={{ padding: '0.5rem', borderRadius: 8, border: '1px solid #cbd5e1' }}>
            {hubs.map(h => (
              <option key={h.address} value={h.primaryName}>{h.displayName} ({h.primaryName})</option>
            ))}
          </select>
        )}
      </div>

      <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. joe" required />
      <div style={{ fontSize: 13, color: '#475569' }}>Preview: <code>{preview}</code></div>

      {error && (
        <div className="rounded-sm bg-error-container p-3 text-body-md text-error" role="alert">{error}</div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="button" onClick={submit} disabled={pending} size="lg" className="flex-1">
          {pending ? 'Registering…' : 'Register name'}
        </Button>
        <Button type="button" variant="outlined" onClick={onSkip} disabled={pending} size="lg" className="flex-1">
          Skip for now
        </Button>
      </div>
    </div>
  )
}

// ─── Step 4: Choose path (existing UX) ────────────────────────────────

function ChooseStep({ displayName, registeredName, registeredWarnings, smartAccountAddress, onPick }: {
  displayName?: string
  registeredName: string | null
  registeredWarnings: string[]
  smartAccountAddress: string | null
  onPick: (target: string) => void
}) {
  const shortAddr = smartAccountAddress
    ? `${smartAccountAddress.slice(0, 6)}…${smartAccountAddress.slice(-4)}`
    : null
  const onChainPartial = registeredWarnings.length > 0

  return (
    <div className="text-center animate-fade-in">
      <div className="w-12 h-12 rounded-full bg-[#e8f5e9] flex items-center justify-center mx-auto mb-4">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="#2e7d32"/></svg>
      </div>
      <h2 className="text-headline-sm font-bold text-on-surface mb-1">Welcome{displayName ? `, ${displayName}` : ''}!</h2>

      {registeredName && (
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46',
            padding: '0.5rem 0.85rem', borderRadius: 999, marginTop: 6, marginBottom: 8,
            fontSize: 13, fontWeight: 600,
          }}
          data-testid="onboarding-registered-name"
        >
          <span>✓ Registered:</span>
          <code style={{ fontSize: 13 }}>{registeredName}</code>
        </div>
      )}
      {shortAddr && (
        <p className="text-body-sm text-on-surface-variant mb-1">
          Account <code>{shortAddr}</code>
        </p>
      )}
      {onChainPartial && (
        <div
          style={{
            margin: '8px auto 0', maxWidth: 420,
            background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e',
            padding: '0.55rem 0.75rem', borderRadius: 8, fontSize: 12, textAlign: 'left',
          }}
          data-testid="onboarding-warnings"
        >
          Some on-chain index records couldn&apos;t be written (your account no longer
          has the bootstrap server in its owner set). Your name is registered in the
          name registry and saved locally — Phase 4 will backfill the resolver entries.
        </div>
      )}

      <p className="text-body-lg text-on-surface-variant mt-4 mb-8">What would you like to do?</p>

      <div className="grid gap-3">
        <Card className="cursor-pointer hover:shadow-elevation-2 transition-all active:scale-[0.99]" onClick={() => onPick('/setup')}>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-md bg-primary-container flex items-center justify-center flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" className="fill-primary"/></svg>
              </div>
              <div className="text-left">
                <div className="text-title-md font-semibold text-on-surface">New Organization</div>
                <div className="text-body-sm text-on-surface-variant">Set up your organization with AI assistants</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-elevation-2 transition-all active:scale-[0.99]" onClick={() => onPick('/setup/join')}>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-md bg-secondary-container flex items-center justify-center flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" className="fill-secondary"/></svg>
              </div>
              <div className="text-left">
                <div className="text-title-md font-semibold text-on-surface">Join an Organization</div>
                <div className="text-body-sm text-on-surface-variant">I have an invitation</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-elevation-2 transition-all active:scale-[0.99]" onClick={() => onPick('/dashboard')}>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-md bg-surface-variant flex items-center justify-center flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" className="fill-on-surface-variant"/></svg>
              </div>
              <div className="text-left">
                <div className="text-title-md font-semibold text-on-surface">Explore</div>
                <div className="text-body-sm text-on-surface-variant">Browse the platform first</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function hexToBytes(hex: string): Uint8Array {
  const s = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (s.length & 3)) & 3)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
