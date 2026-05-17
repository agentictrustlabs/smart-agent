-- KMS migration K0+K1 — session-envelope-encryption columns.
-- See KMS-IMPLEMENTATION-PLAN.md §4.
--
-- This file documents the intended schema delta. The a2a-agent runtime
-- applies the same delta idempotently via best-effort ALTER TABLE blocks
-- in `apps/a2a-agent/src/db/index.ts` (which is the live mechanism today
-- — no `drizzle-kit migrate` step is wired into the boot path). When
-- drizzle-kit migrations become the canonical mechanism, this file can
-- be re-generated via `pnpm drizzle-kit generate` and applied directly.
--
-- Existing rows are stamped `key_version='legacy'` so the rollback decrypt
-- path in `apps/a2a-agent/src/auth/encryption.ts` can still open them.
-- After T+30 days the legacy path is removed (see plan §7).

ALTER TABLE sessions ADD COLUMN encrypted_data_key TEXT;
ALTER TABLE sessions ADD COLUMN key_version TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE sessions ADD COLUMN kms_key_id TEXT;
