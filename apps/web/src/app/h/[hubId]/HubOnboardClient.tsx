'use client'

import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ensurePersonAgentRegistered,
  registerPersonalAgentName,
  joinHubAsPerson,
  markOnboardingComplete,
} from '@/lib/actions/onboarding/setup-agent.action'
import {
  getJoinableOrgsForHub,
  joinOrgAsPerson,
  type JoinableOrg,
} from '@/lib/actions/onboarding/org-onboard.action'
import { CreateOrgDialog } from '@/components/org/CreateOrgDialog'
import {
  prepareReAuthBootstrapAction,
  completeReAuthBootstrapAction,
} from '@/lib/actions/onboarding/repair-account.action'
import { getHubOnboardingState, type HubOnboardingState } from '@/lib/actions/onboarding/hub-onboard.action'
import { packWebAuthnSignature, parseAttestationObject } from '@smart-agent/sdk'

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
}

interface HubOnboardClientProps {
  hubSlug: string
  hubId: 'catalyst' | 'cil' | 'global-church' | 'generic'
  initialState: HubOnboardingState
  /** Hub theme color for the auth picker (matches /h/{slug} hero gradient). */
  accent: string
}

/**
 * Hub-context onboarding state machine.
 *
 *   connect → profile → register → name → join → done
 *
 * Each step refetches getHubOnboardingState() and renders the next slot.
 * The URL stays /h/{slug} for the entire flow. Google OAuth is the only
 * unavoidable redirect; we round-trip back to /h/{slug} via return_to.
 *
 * Mandatory bits (per product decision 2026-04-25):
 *   - .agent name has no "skip"
 *   - join step auto-runs (no "join hub" button)
 *   - hub identity is the URL — never asks the user to pick one
 */
export function HubOnboardClient({ hubSlug, hubId, initialState, accent }: HubOnboardClientProps) {
  const [state, setState] = useState<HubOnboardingState>(initialState)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  async function refresh() {
    setError(null)
    const next = await getHubOnboardingState(state.hub.address)
    setState(next)
    return next
  }

  // Auto-advance steps that don't require user input.
  useEffect(() => {
    if (state.step === 'register' || state.step === 'join' || state.step === 'done') {
      void runAutoStep(state.step)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.step])

  async function runAutoStep(step: 'register' | 'join' | 'done') {
    if (step === 'done') {
      // Mark the wizard complete (clears hub-intent cookie, sets onboardedAt)
      // and hard-nav so the layout re-fetches /api/user-context with fresh
      // membership.
      await markOnboardingComplete().catch(() => {})
      window.location.href = `/h/${hubSlug}/home`
      return
    }
    if (step === 'register') {
      // Pre-flight the server-as-owner check; trigger passkey repair only
      // when needed. For healthy accounts this is a single server hop.
      start(async () => {
        const repair = await prepareReAuthBootstrapAction()
        if (repair.success && repair.alreadyOwner) {
          const r = await ensurePersonAgentRegistered()
          if (!r.success) { setError(r.error ?? 'Registration failed'); return }
          await refresh()
          return
        }
        // Stuck-state account: prompt the user to authorize a re-auth UserOp
        // with their passkey. Surfaced via the 'register-needs-repair' state.
        setRegisterRepairNeeded(repair.success ? (repair.userOpHash ?? null) : null)
      })
      return
    }
    if (step === 'join') {
      start(async () => {
        const r = await joinHubAsPerson(state.hub.address)
        if (!r.success) { setError(r.error ?? 'Failed to join hub'); return }
        await refresh()
      })
    }
  }

  // Repair sub-state — handled inside the 'register' step's UI.
  const [registerRepairNeeded, setRegisterRepairNeeded] = useState<string | null>(null)
  const showRepair = state.step === 'register' && registerRepairNeeded !== null

  // ─── Render ─────────────────────────────────────────────────────────

  if (state.step === 'connect') {
    return (
      <ConnectStep
        hub={state.hub}
        accent={accent}
        hubSlug={hubSlug}
        error={error}
        setError={setError}
      />
    )
  }

  if (state.step === 'profile') {
    return (
      <Card title={`Tell us a bit about you to join ${state.hub.displayName || 'this hub'}`}>
        <ProfileForm
          initialName={state.currentName}
          initialEmail={state.currentEmail}
          onSaved={async () => { await refresh() }}
        />
        {error && <ErrorBox text={error} />}
      </Card>
    )
  }

  if (state.step === 'register') {
    return (
      <Card title="Setting up your agent">
        {!showRepair && (
          <ProgressLine label={pending ? 'Recording on-chain…' : 'Preparing…'} />
        )}
        {showRepair && (
          <RepairForm
            onCompleted={async () => { setRegisterRepairNeeded(null); await refresh() }}
            onError={setError}
          />
        )}
        {error && <ErrorBox text={error} />}
      </Card>
    )
  }

  if (state.step === 'name') {
    return (
      <Card title="Pick your .agent name">
        <NameStep
          hub={state.hub}
          onSaved={async () => { await refresh() }}
        />
        {error && <ErrorBox text={error} />}
      </Card>
    )
  }

  if (state.step === 'join') {
    return (
      <Card title={`Joining ${state.hub.displayName || 'hub'}`}>
        <ProgressLine label="Adding you as a member…" />
        {error && <ErrorBox text={error} />}
      </Card>
    )
  }

  if (state.step === 'org') {
    return (
      <Card title={`Pick your organization in ${state.hub.displayName || 'this hub'}`}>
        <OrgStep
          hub={state.hub}
          hubId={hubId}
          onJoined={async () => { await refresh() }}
          setError={setError}
        />
        {error && <ErrorBox text={error} />}
      </Card>
    )
  }

  // step === 'done' — auto-advances; show nothing visible.
  return <Card title="All set"><ProgressLine label="Taking you in…" /></Card>
}

// ─── Connect step (auth picker) ─────────────────────────────────────

function ConnectStep({ hub, accent, hubSlug, error, setError }: {
  hub: HubOnboardingState['hub']
  accent: string
  hubSlug: string
  error: string | null
  setError: (e: string | null) => void
}) {
  const [signupLabel, setSignupLabel] = useState('')
  const [signupCheck, setSignupCheck] = useState<{
    valid: boolean; available: boolean; reason?: string; fullName?: string; predictedAddress?: string | null
  } | null>(null)
  const [signinAgentName, setSigninAgentName] = useState('')
  const [mode, setMode] = useState<'signup' | 'signin'>('signup')
  const [pending, startPending] = useTransition()

  // Debounced availability check while the user is typing. The cleanup
  // sets `cancelled` so an already-fired fetch from a previous keystroke
  // doesn't overwrite state with a stale answer (e.g. you type "rich",
  // the check fires, you keep typing → "richp2", and the older "rich"
  // response races back and clobbers the UI with the wrong fullName).
  useEffect(() => {
    if (mode !== 'signup') return
    const label = signupLabel.toLowerCase().trim()
    if (!label) { setSignupCheck(null); return }
    let cancelled = false
    const ctrl = new AbortController()
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/auth/check-agent-name?label=${encodeURIComponent(label)}`, { signal: ctrl.signal })
        const data = await r.json()
        if (cancelled) return
        setSignupCheck(data)
      } catch (err) {
        if (cancelled) return
        // AbortError from the cleanup is expected; don't show as error.
        if ((err as Error).name === 'AbortError') return
        setSignupCheck({ valid: false, available: false, reason: 'check failed' })
      }
    }, 400)
    return () => { cancelled = true; ctrl.abort(); clearTimeout(id) }
  }, [signupLabel, mode])

  const googleHref = `/api/auth/google-start?return_to=${encodeURIComponent(`/h/${hubSlug}`)}`

  function onSiwe() {
    setError(null)
    const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum
    if (!eth) { setError('No injected wallet detected. Install MetaMask, Rabby, or Coinbase Wallet.'); return }
    startPending(async () => {
      try {
        const accounts = await eth.request({ method: 'eth_requestAccounts' }) as string[]
        const address = accounts[0]
        if (!address) { setError('Wallet returned no accounts'); return }
        const r = await fetch(`/api/auth/siwe-challenge?domain=${encodeURIComponent(window.location.host)}&address=${address}`, { cache: 'no-store' })
        const { message, token } = await r.json() as { message: string; token: string }
        const signature = await eth.request({
          method: 'personal_sign', params: [message, address],
        }) as `0x${string}`
        const verify = await fetch('/api/auth/siwe-verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: window.location.origin },
          body: JSON.stringify({ token, message, signature, address }),
        })
        const body = await verify.json()
        if (!verify.ok || !body.success) { setError(body.error ?? verify.statusText); return }
        // SIWE puts a placeholder name; the next state will be 'profile'.
        window.location.reload()
      } catch (err) { setError((err as Error).message) }
    })
  }

  function onPasskeySignup() {
    setError(null)
    if (!window.PublicKeyCredential) { setError('WebAuthn not supported in this browser.'); return }
    const label = signupLabel.toLowerCase().trim()
    if (!label) { setError('Pick your .agent name first.'); return }
    if (!signupCheck?.valid) { setError(signupCheck?.reason ?? 'invalid name format'); return }
    if (!signupCheck.available) { setError(`${signupCheck.fullName ?? label + '.agent'} is taken — try another`); return }
    const fullName = signupCheck.fullName ?? `${label}.agent`
    startPending(async () => {
      try {
        const challenge = crypto.getRandomValues(new Uint8Array(32))
        // Use the .agent name as the WebAuthn user.name + displayName so
        // the OS/password-manager labels the saved credential with the
        // user's chosen identity. At sign-in time the picker shows the
        // .agent name directly, no synthetic display name to remember.
        const cred = await navigator.credentials.create({
          publicKey: {
            rp: { name: 'Smart Agent', id: window.location.hostname },
            user: {
              id: crypto.getRandomValues(new Uint8Array(16)),
              name: fullName,
              displayName: fullName,
            },
            challenge,
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
            authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
            attestation: 'none',
            timeout: 60_000,
          },
        }) as PublicKeyCredential | null
        if (!cred) { setError('Cancelled.'); return }
        const resp = cred.response as AuthenticatorAttestationResponse
        const parsed = parseAttestationObject(new Uint8Array(resp.attestationObject))
        const r = await fetch('/api/auth/passkey-signup', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: window.location.origin },
          body: JSON.stringify({
            agentLabel: label,
            credentialIdBase64Url: parsed.credentialIdBase64Url,
            pubKeyX: parsed.pubKeyX.toString(),
            pubKeyY: parsed.pubKeyY.toString(),
          }),
        })
        const body = await r.json()
        if (!r.ok || !body.success) { setError(body.error ?? r.statusText); return }
        const known = JSON.parse(localStorage.getItem('smart-agent.passkeys.local') ?? '[]') as Array<{ id: string; name: string }>
        known.push({ id: parsed.credentialIdBase64Url, name: fullName })
        localStorage.setItem('smart-agent.passkeys.local', JSON.stringify(known))
        window.location.reload()
      } catch (err) { setError((err as Error).message) }
    })
  }

  function onPasskeySignin() {
    setError(null)
    if (!window.PublicKeyCredential) { setError('WebAuthn not supported in this browser.'); return }
    const enteredName = signinAgentName.trim()
    if (!enteredName) { setError('Enter your .agent name (e.g. richp.agent).'); return }
    startPending(async () => {
      try {
        const challResp = await fetch('/api/auth/passkey-challenge', { cache: 'no-store' })
        const { challenge, token } = await challResp.json() as { challenge: string; token: string }
        const challengeBytes = base64UrlDecode(challenge)
        const challengeAb = new ArrayBuffer(challengeBytes.length)
        new Uint8Array(challengeAb).set(challengeBytes)
        // No allowCredentials — the OS picker uses discoverable creds and
        // the user picks the matching passkey themselves. localStorage
        // hints below narrow the picker to passkeys this browser has seen
        // before, but only when present (fresh devices skip the hint).
        const known = JSON.parse(localStorage.getItem('smart-agent.passkeys.local') ?? '[]') as Array<{ id: string; name: string }>
        const allowCredentials = known.map(k => ({
          type: 'public-key' as const,
          id: base64UrlDecode(k.id).buffer.slice(0) as ArrayBuffer,
        }))
        const cred = await navigator.credentials.get({
          publicKey: {
            challenge: challengeAb, rpId: window.location.hostname,
            userVerification: 'preferred', timeout: 60_000,
            allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
          },
        }) as PublicKeyCredential | null
        if (!cred) { setError('Cancelled.'); return }
        const resp = cred.response as AuthenticatorAssertionResponse
        const credentialIdBase64Url = base64UrlEncode(new Uint8Array(cred.rawId))
        const verify = await fetch('/api/auth/passkey-verify', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: window.location.origin },
          body: JSON.stringify({
            // .agent name is the account discovery key — server resolves
            // it to a smart-account address via the universal name resolver
            // and runs isValidSignature on that address. No DB credential
            // mapping consulted on the server.
            name: enteredName,
            token, challenge,
            credentialIdBase64Url,
            authenticatorDataBase64Url: base64UrlEncode(new Uint8Array(resp.authenticatorData)),
            clientDataJSONBase64Url: base64UrlEncode(new Uint8Array(resp.clientDataJSON)),
            signatureBase64Url: base64UrlEncode(new Uint8Array(resp.signature)),
          }),
        })
        const body = await verify.json()
        if (!verify.ok || !body.success) { setError(body.error ?? verify.statusText); return }
        window.location.reload()
      } catch (err) { setError((err as Error).message) }
    })
  }

  return (
    <Card title={`Connect to ${hub.displayName || 'this hub'}`} accent={accent}>
      <p style={{ fontSize: 13, color: '#475569', marginBottom: 16 }}>
        One identity, three ways to sign in. Pick the one you have.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <a
          href={googleHref}
          style={authButtonStyle('#fff', '#1f2937', '1px solid #d1d5db')}
          data-testid="hub-onboard-google"
        >
          <span aria-hidden="true" style={{ fontWeight: 700, marginRight: 6 }}>G</span>
          Continue with Google
        </a>

        <button
          type="button"
          onClick={onSiwe}
          disabled={pending}
          style={authButtonStyle('#1f2937', '#fff')}
          data-testid="hub-onboard-metamask"
        >
          {pending ? 'Connecting…' : 'Continue with MetaMask'}
        </button>

        {mode === 'signup' ? (
          <>
            <Input
              label="Your .agent name"
              value={signupLabel}
              onChange={(e) => setSignupLabel(e.target.value.toLowerCase())}
              placeholder="e.g. richp"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
            />
            {/* Live availability hint. Dim while empty; green if free,
                red if taken or invalid. The predicted address shows the
                user the counterfactual smart-account they'll deploy at. */}
            <div style={{ fontSize: 11, color: '#475569', minHeight: 14 }}>
              {!signupLabel.trim() ? (
                <span style={{ color: '#94a3b8' }}>Pick the name your passkey will use to sign in.</span>
              ) : !signupCheck ? (
                <span style={{ color: '#94a3b8' }}>Checking…</span>
              ) : !signupCheck.valid ? (
                <span style={{ color: '#b91c1c' }}>{signupCheck.reason ?? 'invalid'}</span>
              ) : !signupCheck.available ? (
                <span style={{ color: '#b91c1c' }}>{signupCheck.fullName} is taken</span>
              ) : (
                <span style={{ color: '#047857' }}>
                  {signupCheck.fullName} is available
                  {signupCheck.predictedAddress ? (
                    <>
                      {' '}· will deploy at{' '}
                      <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10 }}>
                        {signupCheck.predictedAddress.slice(0, 6)}…{signupCheck.predictedAddress.slice(-4)}
                      </code>
                    </>
                  ) : null}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onPasskeySignup}
              disabled={pending || !signupCheck?.available}
              style={authButtonStyle(accent, '#fff')}
              data-testid="hub-onboard-passkey-signup"
            >
              {pending ? 'Setting up…' : 'Sign up with Passkey'}
            </button>
            <button
              type="button"
              onClick={() => setMode('signin')}
              style={linkStyle}
              disabled={pending}
            >
              Already have a passkey? Sign in
            </button>
          </>
        ) : (
          <>
            <Input
              label="Your .agent name"
              value={signinAgentName}
              onChange={(e) => setSigninAgentName(e.target.value)}
              placeholder="e.g. richp.agent"
            />
            <button
              type="button"
              onClick={onPasskeySignin}
              disabled={pending}
              style={authButtonStyle(accent, '#fff')}
              data-testid="hub-onboard-passkey-signin"
            >
              {pending ? 'Signing in…' : 'Sign in with Passkey'}
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              style={linkStyle}
              disabled={pending}
            >
              No passkey yet? Create one
            </button>
          </>
        )}
      </div>

      {error && <ErrorBox text={error} />}
    </Card>
  )
}

// ─── Profile form ───────────────────────────────────────────────────

function ProfileForm({ initialName, initialEmail, onSaved }: {
  initialName: string
  initialEmail: string
  onSaved: () => void | Promise<void>
}) {
  const [name, setName] = useState(initialName)
  const [email, setEmail] = useState(initialEmail)
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    if (!name.trim()) { setErr('Name required'); return }
    if (!email.trim() || !email.includes('@')) { setErr('Valid email required'); return }
    start(async () => {
      const r = await fetch('/api/auth/profile', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      })
      if (!r.ok) { setErr('Save failed'); return }
      await onSaved()
    })
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Input label="Display name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alice Smith" required />
      <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alice@example.com" required />
      {err && <ErrorBox text={err} />}
      <Button type="submit" disabled={pending} size="lg" className="w-full">
        {pending ? 'Saving…' : 'Continue'}
      </Button>
    </form>
  )
}

// ─── Register repair (passkey-signed UserOp re-auth) ────────────────

function RepairForm({ onCompleted, onError }: {
  onCompleted: () => void | Promise<void>
  onError: (e: string) => void
}) {
  const [pending, start] = useTransition()
  function run() {
    start(async () => {
      try {
        const prep = await prepareReAuthBootstrapAction()
        if (!prep.success || !prep.unsignedOp || !prep.userOpHash) { onError(prep.error ?? 'Prepare failed'); return }
        if (prep.alreadyOwner) {
          const reg = await ensurePersonAgentRegistered()
          if (!reg.success) { onError(reg.error ?? 'Registration failed'); return }
          await onCompleted(); return
        }
        const challengeBytes = hexToBytes(prep.userOpHash)
        const challengeAb = new ArrayBuffer(challengeBytes.length)
        new Uint8Array(challengeAb).set(challengeBytes)
        const cred = await navigator.credentials.get({
          publicKey: { challenge: challengeAb, rpId: window.location.hostname, userVerification: 'preferred', timeout: 60_000 },
        }) as PublicKeyCredential | null
        if (!cred) { onError('Cancelled'); return }
        const resp = cred.response as AuthenticatorAssertionResponse
        const credentialIdBytes = new Uint8Array(cred.rawId)
        const sig = packWebAuthnSignature({
          credentialIdBytes,
          authenticatorData: new Uint8Array(resp.authenticatorData),
          clientDataJSON: new Uint8Array(resp.clientDataJSON),
          derSignature: new Uint8Array(resp.signature),
        })
        const userOpSig = ('0x01' + sig.slice(2)) as `0x${string}`
        const submitted = await completeReAuthBootstrapAction({
          unsignedOp: prep.unsignedOp,
          passkeySignature: userOpSig,
          credentialIdBase64Url: base64UrlEncode(credentialIdBytes),
        })
        if (!submitted.success) { onError(submitted.error ?? 'Repair failed'); return }
        const reg = await ensurePersonAgentRegistered()
        if (!reg.success) { onError(reg.error ?? 'Registration failed'); return }
        await onCompleted()
      } catch (err) {
        onError((err as Error).message)
      }
    })
  }

  return (
    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', padding: '0.75rem', borderRadius: 8, fontSize: 12, lineHeight: 1.5 }}>
      Your account needs a one-time on-chain re-authorization. Tap to approve with your passkey.
      <Button onClick={run} disabled={pending} size="sm" className="w-full" style={{ marginTop: 10 }}>
        {pending ? 'Authorizing…' : 'Authorize with passkey'}
      </Button>
    </div>
  )
}

// ─── Name picker (mandatory) ────────────────────────────────────────

function NameStep({ hub, onSaved }: {
  hub: HubOnboardingState['hub']
  onSaved: () => void | Promise<void>
}) {
  // Default to 'hub' mode since the user is in a hub context. They can still
  // pick 'root' for a top-level .agent name if they prefer.
  const [mode, setMode] = useState<'root' | 'hub'>(hub.primaryName ? 'hub' : 'root')
  const [label, setLabel] = useState('')
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  const cleanLabel = label.toLowerCase().trim()
  const preview = !cleanLabel
    ? '—'
    : mode === 'root'
      ? `${cleanLabel}.agent`
      : `${cleanLabel}.${hub.primaryName || 'agent'}`

  function submit() {
    setErr(null)
    if (!cleanLabel) { setErr('Pick a label'); return }
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(cleanLabel)) {
      setErr('Letters, numbers, and hyphens only — no leading or trailing hyphens'); return
    }
    start(async () => {
      const parentName = mode === 'hub' && hub.primaryName ? hub.primaryName : undefined
      const r = await registerPersonalAgentName({ label: cleanLabel, parentName })
      if (!r.success) { setErr(r.error ?? 'Name registration failed'); return }
      await onSaved()
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 13, color: '#475569', margin: 0 }}>
        Your handle on the trust graph. This is required to join {hub.displayName || 'this hub'}.
      </p>

      {hub.primaryName && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={radioLabelStyle(mode === 'hub')}>
            <input type="radio" name="mode" checked={mode === 'hub'} onChange={() => setMode('hub')} />
            <span><b>Under {hub.displayName}</b> — <code>{cleanLabel || 'name'}.{hub.primaryName}</code></span>
          </label>
          <label style={radioLabelStyle(mode === 'root')}>
            <input type="radio" name="mode" checked={mode === 'root'} onChange={() => setMode('root')} />
            <span><b>Top-level .agent</b> — <code>{cleanLabel || 'name'}.agent</code></span>
          </label>
        </div>
      )}

      <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. joe" required />
      <div style={{ fontSize: 13, color: '#475569' }}>Preview: <code>{preview}</code></div>

      {err && <ErrorBox text={err} />}

      <Button type="button" onClick={submit} disabled={pending} size="lg" className="w-full">
        {pending ? 'Registering…' : 'Register name'}
      </Button>
    </div>
  )
}

// ─── Org step (mandatory) ───────────────────────────────────────────

function OrgStep({ hub, hubId, onJoined, setError }: {
  hub: HubOnboardingState['hub']
  hubId: 'catalyst' | 'cil' | 'global-church' | 'generic'
  onJoined: () => void | Promise<void>
  setError: (e: string | null) => void
}) {
  const [orgs, setOrgs] = useState<JoinableOrg[] | null>(null)
  const [pendingAddr, setPendingAddr] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await getJoinableOrgsForHub(hub.address).catch(() => [] as JoinableOrg[])
      if (!cancelled) setOrgs(list)
    })()
    return () => { cancelled = true }
  }, [hub.address])

  function joinExisting(orgAddr: string) {
    setError(null)
    setPendingAddr(orgAddr)
    start(async () => {
      const r = await joinOrgAsPerson(orgAddr)
      if (!r.success) { setError(r.error ?? 'Join failed'); setPendingAddr(null); return }
      await onJoined()
    })
  }

  if (orgs === null) {
    return <ProgressLine label="Loading organizations…" />
  }

  return (
    <>
      <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px' }}>
        Every {hub.displayName || 'hub'} member operates under an organization.
        Connect to one or create your own.
      </p>

      {orgs.filter(o => !o.alreadyMember).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
          {orgs.filter(o => !o.alreadyMember).map(o => {
            const active = pendingAddr === o.address
            return (
              <button
                key={o.address}
                type="button"
                disabled={pending}
                onClick={() => joinExisting(o.address)}
                style={{
                  textAlign: 'left',
                  padding: '0.65rem 0.8rem',
                  border: `1px solid ${active ? '#3f6ee8' : '#e2e8f0'}`,
                  borderRadius: 8,
                  background: active ? '#eff6ff' : '#fff',
                  cursor: pending ? 'wait' : 'pointer',
                  fontSize: 13,
                }}
                data-testid={`onboard-join-org-${o.primaryName || o.address.slice(2, 10)}`}
              >
                <div style={{ fontWeight: 600 }}>{o.displayName}</div>
                {o.primaryName && (
                  <code style={{ fontSize: 11, color: '#64748b' }}>{o.primaryName}</code>
                )}
                {o.description && (
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{o.description}</div>
                )}
                {active && pending && (
                  <span style={{ fontSize: 11, color: '#3f6ee8' }}>connecting…</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          disabled={pending}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '100%', padding: '0.65rem 0.8rem',
            border: '1px dashed #94a3b8', borderRadius: 8,
            background: 'transparent', color: '#3f6ee8',
            fontWeight: 600, fontSize: 13, cursor: 'pointer',
          }}
          data-testid="onboard-create-org"
        >
          + Create a new organization
        </button>
      </div>

      {showCreate && (
        <CreateOrgDialog
          hubAddress={hub.address}
          hubName={hub.displayName || 'this hub'}
          hubId={hubId}
          onCancel={() => setShowCreate(false)}
          onCreated={async () => { setShowCreate(false); await onJoined() }}
        />
      )}
    </>
  )
}

// ─── Shared atoms ────────────────────────────────────────────────────

function Card({ title, accent, children }: { title: string; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: '#fff', border: `1px solid ${accent ? accent + '20' : '#e5e7eb'}`,
      borderRadius: 16, padding: '1.25rem 1.25rem 1.5rem',
      boxShadow: '0 18px 40px rgba(40,52,89,0.08)',
      maxWidth: 460, margin: '0 auto',
    }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#171c28', marginTop: 0, marginBottom: 12 }}>{title}</h2>
      {children}
    </div>
  )
}

function ErrorBox({ text }: { text: string }) {
  return (
    <div role="alert" style={{ marginTop: 12, padding: '0.55rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 8, fontSize: 12 }}>
      {text}
    </div>
  )
}

function ProgressLine({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.5rem 0', fontSize: 13, color: '#475569' }}>
      <span style={{ width: 14, height: 14, border: '2px solid #cbd5e1', borderTopColor: '#3f6ee8', borderRadius: '50%', display: 'inline-block', animation: 'spin 0.9s linear infinite' }} />
      <span>{label}</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function authButtonStyle(bg: string, fg: string, border?: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '100%', padding: '0.75rem 1rem',
    background: bg, color: fg, border: border ?? 'none',
    borderRadius: 10, fontSize: 14, fontWeight: 600,
    cursor: 'pointer', textDecoration: 'none',
  }
}

const linkStyle: React.CSSProperties = {
  background: 'transparent', border: 'none',
  color: '#3f6ee8', fontSize: 12, fontWeight: 500,
  cursor: 'pointer', padding: '0.4rem 0', textAlign: 'center',
}

function radioLabelStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '0.65rem 0.75rem',
    border: `2px solid ${active ? '#3f6ee8' : '#e2e8f0'}`,
    borderRadius: 8, cursor: 'pointer',
    fontSize: 13,
  }
}

// ─── Encoding helpers ───────────────────────────────────────────────

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
