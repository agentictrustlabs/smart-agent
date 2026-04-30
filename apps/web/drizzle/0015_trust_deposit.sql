-- R7 — Trust deposit artifacts. Off-chain mirror of the contracts in
-- packages/contracts (AgentReviewRecord, AgentSkillRegistry, AgentAssertion,
-- AgentValidationProfile). Stage 8 of the round-trip writes here on
-- dual-confirm cascade.
--
-- Spec: docs/specs/round-trip-trust-deposit-plan.md §4

CREATE TABLE `agent_review_records` (
  `id` text PRIMARY KEY NOT NULL,
  `reviewer_agent` text NOT NULL,
  `subject_agent` text NOT NULL,
  `engagement_id` text NOT NULL,
  `score` integer NOT NULL,
  `confidence` real NOT NULL,
  `narrative` text,
  `witness_lifted` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `arr_subject_idx` ON `agent_review_records` (`subject_agent`);
--> statement-breakpoint
CREATE INDEX `arr_reviewer_idx` ON `agent_review_records` (`reviewer_agent`);
--> statement-breakpoint
CREATE INDEX `arr_engagement_idx` ON `agent_review_records` (`engagement_id`);
--> statement-breakpoint

CREATE TABLE `agent_skill_claims` (
  `id` text PRIMARY KEY NOT NULL,
  `subject_agent` text NOT NULL,
  `skill_slug` text NOT NULL,
  `side` text NOT NULL,
  `attestor_agent` text NOT NULL,
  `engagement_id` text NOT NULL,
  `confidence` real NOT NULL,
  `witness_lifted` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `asc_subject_skill_idx` ON `agent_skill_claims` (`subject_agent`, `skill_slug`);
--> statement-breakpoint
CREATE INDEX `asc_engagement_idx` ON `agent_skill_claims` (`engagement_id`);
--> statement-breakpoint

CREATE TABLE `agent_assertions` (
  `id` text PRIMARY KEY NOT NULL,
  `engagement_id` text NOT NULL,
  `payload` text NOT NULL,
  `payload_hash` text NOT NULL,
  `witness_lifted` integer DEFAULT 0 NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `aa_engagement_idx` ON `agent_assertions` (`engagement_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `aa_payload_hash_idx` ON `agent_assertions` (`payload_hash`);
--> statement-breakpoint

CREATE TABLE `agent_validation_profiles` (
  `agent` text PRIMARY KEY NOT NULL,
  `engagements_count` integer DEFAULT 0 NOT NULL,
  `witnessed_count` integer DEFAULT 0 NOT NULL,
  `last_engagement_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
