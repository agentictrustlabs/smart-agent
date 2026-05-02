-- R12 — Tranche shape: engagement_tranches table.
-- Vertical timeline of disbursements gated on reports. The TrancheSchedule
-- is the primary surface for Money engagements (NCF restricted grants etc.).
--
-- Spec: docs/specs/engagement-shapes-plan.md §6 R12

CREATE TABLE `engagement_tranches` (
  `id` text PRIMARY KEY NOT NULL,
  `engagement_id` text NOT NULL,
  -- Sequence number 1..N. Combined with engagement_id forms the natural key.
  `idx` integer NOT NULL,
  -- Amount in dollar cents (avoid float). $6,250 = 625000.
  `amount_cents` integer NOT NULL,
  `scheduled_for` text,
  `released_at` text,
  `report_required` integer NOT NULL DEFAULT 1,
  -- Soft FK to commitment_thread_entries.id when a report has been attached.
  `report_thread_entry_id` text,
  `state` text NOT NULL DEFAULT 'scheduled',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`engagement_id`) REFERENCES `entitlements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `et_engagement_idx_uniq` ON `engagement_tranches` (`engagement_id`, `idx`);
--> statement-breakpoint
CREATE INDEX `et_engagement_state_idx` ON `engagement_tranches` (`engagement_id`, `state`);
