-- R16 — Two-engagement split.
-- acceptMatch now mints a 'matching' engagement (closes immediately) plus a
-- 'delivery' engagement (the actual working relationship). The delivery
-- references the matching via parent_engagement_id.
--
-- The 'matching' is between the agent who expressed the intent and the agent
-- who was selected; deliverable = the assignment itself, achieved at accept.
-- The 'delivery' is between the *beneficiary* (often a person inside an org)
-- and the selected agent; runs the normal Cadence/Tranche/OneShot/Governance
-- cycle.
--
-- Spec: docs/specs/engagement-shapes-plan.md (R16 follow-on; matching is a
-- 5th workspace shape).

ALTER TABLE `entitlements` ADD COLUMN `parent_engagement_id` text;
--> statement-breakpoint
ALTER TABLE `entitlements` ADD COLUMN `engagement_kind` text DEFAULT 'delivery' NOT NULL;
--> statement-breakpoint
CREATE INDEX `ent_parent_engagement_idx` ON `entitlements` (`parent_engagement_id`);
--> statement-breakpoint
CREATE INDEX `ent_kind_idx` ON `entitlements` (`engagement_kind`, `status`);
