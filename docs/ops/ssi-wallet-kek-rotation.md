# SSI wallet KEK rotation runbook

The `ssi-wallet-mcp` encrypts every user's link secret + raw credentials
under a per-profile Data Encryption Key (DEK). Each DEK is itself envelope-
encrypted by a Key Encryption Key (KEK) derived from `SSI_ASKAR_KEY` via
scrypt. Rotating the KEK is a **planned maintenance** operation.

## When to rotate

- You suspect `SSI_ASKAR_KEY` was exposed (e.g., leaked in logs, CI, or a
  compromised operator machine).
- Scheduled: every 180 days as a routine precaution.
- After an operator off-boards.

## Prerequisites

- `ssi-wallet-mcp` is the only process with write access to the vault.
- Backup of `apps/ssi-wallet-mcp/askar-stores/vault.db` and
  `apps/ssi-wallet-mcp/ssi-wallet.db` before starting.
- New `SSI_ASKAR_KEY` generated from a CSPRNG (at least 32 random bytes,
  hex-encoded):

```bash
openssl rand -hex 32
```

## Procedure

1. **Stop the service.**
   ```bash
   pkill -f "ssi-wallet-mcp.*tsx"
   ```

2. **Backup the vault.**
   ```bash
   cd apps/ssi-wallet-mcp
   cp askar-stores/vault.db{,.bak.$(date +%s)}
   cp ssi-wallet.db{,.bak.$(date +%s)}
   ```

3. **Re-encrypt every DEK under the new KEK.** Run the KEK-rotation script
   (pseudo-code — see `scripts/rotate-ssi-kek.ts`, add per-operator):

   ```ts
   // For each row in `profiles`:
   //   dek = decrypt_with_kek(wrapped_dek, dek_iv, dek_tag, OLD_KEK, 'profile:'+name)
   //   (new_iv, new_wrapped, new_tag) = encrypt_with_kek(dek, NEW_KEK, 'profile:'+name)
   //   UPDATE profiles SET wrapped_dek=..., dek_iv=..., dek_tag=... WHERE name=...
   ```

   Every credential + link-secret row is left untouched — only the DEK wrappers
   change. AEAD-tag validation makes this a safe read-then-write loop.

4. **Update `.env`.**
   ```env
   SSI_ASKAR_KEY=<new hex>
   ```

5. **Restart the service.**
   ```bash
   pnpm --filter @smart-agent/ssi-wallet-mcp dev
   ```

6. **Smoke test.** Log in as any demo user, fetch `/wallet` — the credentials
   list must load (proves every DEK re-wrap worked). If any profile fails to
   unwrap, roll back from the `.bak.*` snapshot and investigate.

## Rollback

```bash
mv askar-stores/vault.db.bak.<ts> askar-stores/vault.db
mv ssi-wallet.db.bak.<ts>        ssi-wallet.db
# Restore old SSI_ASKAR_KEY in .env
```

## What this does NOT rotate

- **Link secrets.** The AnonCreds link secret itself doesn't rotate under
  this procedure — it's re-encrypted but unchanged. If you need to rotate
  the link secret (e.g., credential-level compromise), use the user-facing
  `RotateLinkSecret` flow (`/wallet` → "Rotate link secret" per context).

- **Privy EOAs.** The user's root identity is separate from the wallet
  service's encryption keys. A Privy EOA compromise requires a different
  recovery path (out of scope, see backlog).

- **Issuer keys.** Each issuer (`org-mcp`, `family-mcp`) has its own signing
  key for registry records. Rotating those is a separate procedure handled
  at the issuer service, not the wallet.

## Blast radius if skipped

If `SSI_ASKAR_KEY` leaks and rotation is *not* performed, an attacker with
filesystem access to `vault.db` can unwrap every DEK and decrypt every user's
link secret + stored credentials. AnonCreds proofs from that vault become
forgeable. The attacker still cannot forge NEW credentials without the
corresponding issuer's private key.
