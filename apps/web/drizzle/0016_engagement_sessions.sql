-- R10 — Cadence shape: engagement_sessions table.
-- Sessions can be scheduled, logged after-the-fact, or both. The session
-- timeline reads this as the primary surface for Worker / Skill / Prayer /
-- Curriculum / Venue (recurring) engagements.
--
-- Spec: docs/specs/engagement-shapes-plan.md §6 R10

CREATE TABLE `engagement_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `engagement_id` text NOT NULL,
  -- When the session is/was planned. Nullable so log-after-the-fact sessions
  -- with no prior schedule are valid.
  `scheduled_for` text,
  -- When the session actually happened. Nullable so upcoming-but-not-yet
  -- sessions are valid.
  `occurred_at` text,
  -- Free-text notes captured at log time. Hidden in quiet-mode subtypes.
  `notes` text,
  -- Who logged the session (person agent, lower-cased).
  `logged_by` text,
  -- Optional link to the activity_logs row that this session projects from.
  -- Used by R10 backfill so existing activities show on the timeline immediately.
  `source_activity_id` text,
  -- 'scheduled' | 'occurred' | 'cancelled'. Computed from timestamps + cancel flag.
  `status` text DEFAULT 'scheduled' NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`engagement_id`) REFERENCES `entitlements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `es_engagement_idx` ON `engagement_sessions` (`engagement_id`, `scheduled_for`);
--> statement-breakpoint
CREATE INDEX `es_engagement_occurred_idx` ON `engagement_sessions` (`engagement_id`, `occurred_at`);
--> statement-breakpoint
-- Idempotent backfill: at most one session per source activity.
CREATE UNIQUE INDEX `es_source_activity_idx` ON `engagement_sessions` (`source_activity_id`) WHERE `source_activity_id` IS NOT NULL;
