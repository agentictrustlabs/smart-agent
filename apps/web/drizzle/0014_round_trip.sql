-- R1 — Round-trip & trust deposit: bilateral engagement + commitment thread.
-- Spec: docs/specs/round-trip-trust-deposit-plan.md
-- T-Box: docs/ontology/tbox/marketplace-lifecycle.ttl
--
-- No backcompat: drop linked_outcome_id (single-sided) in favor of holder + provider
-- outcome ids. Demo state is reconstructed via scripts/fresh-start.sh.

-- ─── Bilateral outcome columns + dual-confirm + trust deposit refs ─────────
ALTER TABLE `entitlements` ADD COLUMN `holder_outcome_id` text;
--> statement-breakpoint
ALTER TABLE `entitlements` ADD COLUMN `provider_outcome_id` text;
--> statement-breakpoint
ALTER TABLE `entitlements` ADD COLUMN `holder_confirmed_at` text;
--> statement-breakpoint
ALTER TABLE `entitlements` ADD COLUMN `provider_confirmed_at` text;
--> statement-breakpoint
ALTER TABLE `entitlements` ADD COLUMN `witness_agent` text;
--> statement-breakpoint
ALTER TABLE `entitlements` ADD COLUMN `witness_signed_at` text;
--> statement-breakpoint
ALTER TABLE `entitlements` ADD COLUMN `review_ids` text;
--> statement-breakpoint
ALTER TABLE `entitlements` ADD COLUMN `assertion_id` text;
--> statement-breakpoint
ALTER TABLE `entitlements` ADD COLUMN `evidence_bundle_hash` text;
--> statement-breakpoint
ALTER TABLE `entitlements` ADD COLUMN `evidence_pinned_at` text;
--> statement-breakpoint
ALTER TABLE `entitlements` ADD COLUMN `phase` text DEFAULT 'granted' NOT NULL;
--> statement-breakpoint

-- One-way carry-forward (preserves any existing demo links into the holder slot)
-- before dropping the old column.
UPDATE `entitlements` SET `holder_outcome_id` = `linked_outcome_id` WHERE `linked_outcome_id` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `entitlements` DROP COLUMN `linked_outcome_id`;
--> statement-breakpoint

-- ─── Commitment Thread — typed persistent backbone ────────────────────────
CREATE TABLE `commitment_thread_entries` (
  `id` text PRIMARY KEY NOT NULL,
  `engagement_id` text NOT NULL,
  `kind` text NOT NULL,
  `from_agent` text,
  `body` text NOT NULL,
  `attachment_uri` text,
  `hash_anchor` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`engagement_id`) REFERENCES `entitlements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cte_engagement_idx` ON `commitment_thread_entries` (`engagement_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `cte_kind_idx` ON `commitment_thread_entries` (`engagement_id`, `kind`);
