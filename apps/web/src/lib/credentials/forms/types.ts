/**
 * Per-credential-kind form contract. Each form collects user input and
 * returns:
 *   • `attributes`     — must match the descriptor's `attributeNames`,
 *                        all stringified (AnonCreds requirement).
 *   • `extraIssueArgs` — optional passthrough for credential-kind-specific
 *                        issue parameters (e.g. `targetOrgAddress` for
 *                        org membership).
 *
 * The generic dialog reads these via `onSubmit` and dispatches the
 * standard prepare/sign/submit flow.
 */

export interface FormSubmissionResult {
  attributes: Record<string, string>
  extraIssueArgs?: { targetOrgAddress?: string }
}

export interface CredentialFormContext {
  hubAddress?: string
  hubName?: string
}

export interface CredentialFormProps {
  /** True while the parent dialog is running the issuance flow. */
  busy: boolean
  /** Optional hub context — populated from HubLayout when available. */
  context: CredentialFormContext
  /** Called when the user clicks the parent's submit button via `formRef`. */
  onSubmit: (result: FormSubmissionResult) => void
  /** Inline error from the form (validation) — bubbled up. */
  onValidationError: (msg: string | null) => void
}

/**
 * Some forms have async data they need to fetch (joinable orgs, .geo
 * features). They hand the parent dialog a "submit handle" via the
 * `expose` prop so the parent's button can trigger the form's submit.
 *
 * Pattern: parent renders `<Form ... expose={s => (formApiRef.current = s)} />`.
 */
export interface FormHandle {
  /** Parent calls this to trigger validation + onSubmit. */
  trigger(): void
  /** Whether the form is in a submittable state. */
  ready: boolean
}

export type CredentialFormPropsWithHandle = CredentialFormProps & {
  expose: (handle: FormHandle) => void
}
