# LocalStack KMS — Local Dev Runbook (Task #122)

This doc covers running the smart-agent stack with `A2A_KMS_BACKEND=aws-kms`
on a developer workstation, against the open-source [LocalStack](https://github.com/localstack/localstack)
KMS emulator. The purpose is to validate the production AWS KMS code path
end-to-end without a real AWS account.

The companion production runbook is `docs/operations/kms-signer-setup.md`.
The two are **the same code path** in every dimension that matters
(SDK, commands, response handling, error mapping, signature derivation,
EncryptionContext binding). The only differences are documented in the
"Dev-only divergences" section below.

## TL;DR

```bash
./scripts/fresh-start.sh --with-kms
```

The flag is composable with the other fresh-start flags
(`--minimal`, `--keep-contracts`, `--no-services`, `--no-wait`).

## What `--with-kms` does

1. Boots `localstack/localstack:3.8.1` Community Edition in Docker,
   listening on `:4566` with only the KMS service enabled.
2. Waits for the `/_localstack/health` endpoint to report
   `"kms": "available"`.
3. Runs `scripts/provision-localstack-kms.sh`, which:
   - Creates one symmetric AES envelope key (K2).
   - Creates one ECC_SECG_P256K1 master-signer key (K4 PR-2).
   - Creates four ECC_SECG_P256K1 tool-executor keys (K5: round-awards,
     disbursement, pool-lifecycle, grant-awards).
   - Creates nine HMAC_256 keys (K3-extension: one per
     `MacKeyId` in `packages/sdk/src/key-custody/mac-provider-factory.ts`
     — `web-to-a2a` + seven `a2a-to-<mcp>` + `oauth-salt`).
   - Writes `A2A_KMS_BACKEND=aws-kms`, `AWS_ENDPOINT_URL=http://localhost:4566`,
     dummy `AWS_ACCESS_KEY_ID=test` / `AWS_SECRET_ACCESS_KEY=test`,
     and every KMS key ID into the relevant
     `apps/{a2a-agent,web,*-mcp}/.env` files.
   - Strips the legacy `local-aes` dev-shim private/HMAC keys
     (`A2A_MASTER_PRIVATE_KEY`, `TOOL_EXECUTOR_*_PRIVATE_KEY`,
     `A2A_INTERSERVICE_HMAC_KEY_*`, `WEB_TO_A2A_HMAC_KEY`,
     `OAUTH_SALT_HMAC_KEY`) from those .env files. The aws-kms code path
     does NOT read them — they exist only as a dev-only shim under
     `local-aes` and leaving them on disk would violate the
     "no private keys in .env" invariant the LocalStack story is supposed
     to close.
4. Proceeds with `deploy-local.sh`. The deploy script invokes
   `scripts/master-signer-address.ts` which, under
   `A2A_KMS_BACKEND=aws-kms`, calls `kms:GetPublicKey` against LocalStack
   and returns the derived EVM address. That address becomes the
   `AgentAccountFactory` `serverSigner` constructor argument, exactly as
   it would against real AWS.
5. After deploy completes, re-runs the strip step
   (`provision-localstack-kms.sh --strip-only`) because `deploy-local.sh`
   re-writes the dev-shim private keys to .env as part of its
   default-path behaviour.
6. Starts every backend service and the web app normally. Each picks up
   the aws-kms env from its `.env` file and routes ALL session-envelope
   encryption, master-EOA signing, per-tool executor signing, and
   inter-service HMAC operations through the LocalStack KMS.

## What it does NOT do

- **No OIDC enforcement.** LocalStack accepts `AWS_ACCESS_KEY_ID=test` /
  `AWS_SECRET_ACCESS_KEY=test` directly and does not perform
  `AssumeRoleWithWebIdentity`. The production path uses
  `@vercel/oidc-aws-credentials-provider` to trade a Vercel-issued OIDC
  token for AWS STS temporary credentials; LocalStack has no OIDC
  issuer.

- **No IAM enforcement.** LocalStack Community ignores the IAM service
  entirely. The production runbook's per-key IAM scoping
  (one `kms:Sign` allow statement per tool key, one
  `kms:GenerateDataKey + kms:Decrypt` pair on the envelope key, etc.)
  is documented but cannot be exercised here. Defense-in-depth
  validation against real AWS must happen in CI or against a staging
  account before any production deployment.

- **No CloudTrail audit.** LocalStack does not emit audit events. The
  per-call `audit` callback in
  `packages/sdk/src/key-custody/aws-kms-signer.ts` still fires and
  hands events to `apps/a2a-agent/src/auth/a2a-signer.ts`, which
  writes them to the `execution_audit` SQLite table; that is the
  internal audit channel and it works identically in dev and prod.

- **Keys do not persist across container restarts.** LocalStack Community
  uses in-memory storage. Re-running `fresh-start.sh --with-kms` is
  always required after a container restart. There is no scenario in
  which a previously-provisioned key id remains valid; the provisioning
  step recreates everything from scratch.

## Dev-only divergences from production

There is exactly one allowed divergence in the runtime code path:

1. **Credential provider selection.** In
   `packages/sdk/src/key-custody/aws-kms-client-config.ts`,
   the `KMSClient` is constructed without an explicit `credentials`
   field whenever `AWS_ENDPOINT_URL` is set in the env. This delegates
   to the AWS SDK's default credential chain (env vars first), which
   is what LocalStack's dummy `test/test` pair satisfies. In production
   the same helper attaches `awsCredentialsProvider({ roleArn })`
   from `@vercel/oidc-aws-credentials-provider`.

   Every other dimension of the code path is identical: same SDK
   commands, same response parsing, same error mapping, same
   `EncryptionContext` binding, same DER → (r, s, v) decode, same
   low-s normalization, same recovery-id derivation.

   This is the ONLY dev-only branch. Anything else that does not
   behave identically in dev vs prod is a bug, not a feature.

## Verifying the path is live

After `fresh-start.sh --with-kms` completes:

```bash
# 1. LocalStack is up and KMS is available
curl -s http://localhost:4566/_localstack/health | grep '"kms"'
#   → "kms": "available"

# 2. The a2a-agent .env file has aws-kms wiring (and NO private keys)
grep '^A2A_KMS_BACKEND=' apps/a2a-agent/.env
#   → A2A_KMS_BACKEND=aws-kms
grep '^AWS_KMS_SIGNER_KEY_ID=' apps/a2a-agent/.env
#   → AWS_KMS_SIGNER_KEY_ID=<uuid>
grep '^A2A_MASTER_PRIVATE_KEY=' apps/a2a-agent/.env || echo "absent (expected)"
#   → absent (expected)

# 3. The master signer address derived through KMS matches the
#    factory's serverSigner (asserted at deploy time by deploy-local.sh)
set -a; . apps/a2a-agent/.env; set +a
pnpm exec tsx scripts/master-signer-address.ts
#   → 0x<40-hex-chars>  (stable for the lifetime of the LocalStack container)
```

If any of these checks fails, look at `tmp/logs/provision-localstack-kms.log`
and `tmp/logs/anvil.log` first.

## Switching back to the default `local-aes` path

Just re-run `./scripts/fresh-start.sh` without `--with-kms`. The default
profile uses the in-process `local-aes` provider (envelope) and the
in-process secp256k1 signer (master + tool executors), reading
`A2A_MASTER_PRIVATE_KEY` + `TOOL_EXECUTOR_*_PRIVATE_KEY` + the
per-MCP `A2A_INTERSERVICE_HMAC_KEY_*` static secrets that
`deploy-local.sh` writes back into the .env files.

## Production deployment

LocalStack is dev-only. Production AWS deployment is covered in
`docs/operations/kms-signer-setup.md`. The two paths share 100% of the
runtime code; the only deltas at deployment time are:

- Real AWS account + real KMS keys provisioned via console or Terraform.
- Vercel OIDC federation configured per the production runbook's
  Steps 1-3.
- Per-key IAM scoping enforced (see § "AWS_*_KEY_ID separation" in the
  production runbook).
- `AWS_ENDPOINT_URL` is **never** set in the production environment —
  its presence is the canonical signal that LocalStack is in use
  (see `aws-kms-client-config.ts`).
