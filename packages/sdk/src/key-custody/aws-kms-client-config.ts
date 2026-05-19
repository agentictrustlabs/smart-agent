/**
 * Shared AWS KMS client-construction helper.
 *
 * The three AWS-KMS factories (`aws-kms-provider`, `aws-kms-signer`,
 * `aws-kms-mac`) all build a `KMSClient`. In production they share the same
 * shape:
 *
 *     new KMSClient({
 *       region,
 *       credentials: awsCredentialsProvider({ roleArn }),
 *     })
 *
 * In LOCAL DEV against the LocalStack KMS emulator (Task #122), we need to
 * skip the Vercel OIDC credential provider entirely:
 *
 *   1. LocalStack runs at an explicit `AWS_ENDPOINT_URL` (e.g.
 *      `http://localhost:4566`). AWS SDK v3 (≥ 3.450) reads this env var
 *      automatically when no explicit `endpoint` is set on the client.
 *
 *   2. Vercel OIDC tokens do not exist in a developer workstation. The
 *      `awsCredentialsProvider({ roleArn })` call from
 *      `@vercel/oidc-aws-credentials-provider` performs
 *      `AssumeRoleWithWebIdentity` against STS; without a Vercel-issued
 *      token, that call fails before any KMS request is made.
 *
 *   3. LocalStack accepts ANY credentials (the canonical dummy pair is
 *      `AWS_ACCESS_KEY_ID=test` / `AWS_SECRET_ACCESS_KEY=test`). When we
 *      pass NO `credentials` field to `KMSClient`, the SDK falls back to
 *      the default credential chain, which picks those up from env.
 *
 * Therefore the rule is: when `AWS_ENDPOINT_URL` is set on the process env
 * (which is the canonical signal that LocalStack is in use), DO NOT
 * supply the OIDC credential provider — let the SDK's default chain
 * resolve credentials from env vars instead.
 *
 * This is the only allowable dev-only divergence from production: skipping
 * the OIDC federation step. Every other dimension of the signing /
 * encryption / MAC path runs the SAME code in dev (LocalStack) and prod
 * (real AWS KMS) — same SDK, same commands, same response shape, same
 * error mapping. The substrate-independence rule (P1) is preserved
 * because we still depend on the open KMS API, not on AWS or LocalStack
 * substrate.
 *
 * Why a tiny helper rather than inline if/else at each call site:
 *   The three factories independently constructed `KMSClient`. Sprinkling
 *   the LocalStack branch across three places risks drift (e.g. someone
 *   forgets the env-var check in `aws-kms-mac.ts`). One helper means one
 *   diff and the choice is uniform.
 */
import type { KMSClientConfig } from '@aws-sdk/client-kms'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'

/**
 * Build the `KMSClientConfig` for an AWS region + IAM role.
 *
 * Behaviour:
 *   - When `AWS_ENDPOINT_URL` is NOT set (or empty): include the Vercel
 *     OIDC credentials provider. This is the production path.
 *   - When `AWS_ENDPOINT_URL` IS set (LocalStack dev path): omit
 *     `credentials` so the SDK falls back to the env-var credential chain.
 *     The endpoint URL itself is read automatically by AWS SDK v3.450+ —
 *     we don't pass `endpoint` explicitly here.
 *
 * The `roleArn` parameter is read in BOTH branches by upstream env
 * validation (the AWS factories require it before reaching this helper),
 * but only USED in the production branch.
 *
 * @param region   AWS region the KMS key lives in.
 * @param roleArn  IAM role ARN to assume via OIDC federation (production only).
 * @param env      Process env, defaults to `process.env`. Override in tests.
 */
export function buildAwsKmsClientConfig(
  region: string,
  roleArn: string,
  env: { AWS_ENDPOINT_URL?: string } = process.env as { AWS_ENDPOINT_URL?: string },
): KMSClientConfig {
  // LocalStack-mode signal: any non-empty AWS_ENDPOINT_URL. We deliberately
  // do not check the URL pattern — operators who point this at a non-local
  // endpoint (a staging KMS gateway, a custom proxy) are knowingly taking
  // the credential-chain branch. The production-guard against this living
  // alongside NODE_ENV='production' sits in the factory caller (which
  // refuses `local-aes` in prod; `aws-kms` + LocalStack-URL in prod is an
  // operator error we surface upstream, not here).
  const useLocalStack =
    typeof env.AWS_ENDPOINT_URL === 'string' && env.AWS_ENDPOINT_URL.length > 0

  if (useLocalStack) {
    // No `credentials` field → SDK uses default chain (env vars, ~/.aws/credentials, IMDS, ...).
    // No `endpoint` field → SDK reads AWS_ENDPOINT_URL itself (v3.450+ behaviour).
    return { region }
  }

  return {
    region,
    credentials: awsCredentialsProvider({ roleArn }),
  }
}
