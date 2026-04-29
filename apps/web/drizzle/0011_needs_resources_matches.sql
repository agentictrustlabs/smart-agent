-- N2 — Needs / Resources / Matches Discover layer.
-- T-Box: docs/ontology/tbox/{needs,resources,matches}.ttl
-- Vocabulary: docs/ontology/cbox/resource-types.ttl

ALTER TABLE `activity_logs` ADD COLUMN `fulfills_need_id` text;
--> statement-breakpoint
ALTER TABLE `activity_logs` ADD COLUMN `uses_offering_id` text;
--> statement-breakpoint

CREATE TABLE `needs` (
  `id` text PRIMARY KEY NOT NULL,
  `need_type` text NOT NULL,
  `need_type_label` text NOT NULL,
  `needed_by_agent` text NOT NULL,
  `needed_by_user_id` text,
  `hub_id` text NOT NULL,
  `title` text NOT NULL,
  `detail` text,
  `priority` text DEFAULT 'normal' NOT NULL,
  `status` text DEFAULT 'open' NOT NULL,
  `requirements` text,
  `valid_until` text,
  `created_by` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint

CREATE INDEX `needs_hub_status_idx` ON `needs` (`hub_id`, `status`);
--> statement-breakpoint

CREATE INDEX `needs_needed_by_idx` ON `needs` (`needed_by_agent`);
--> statement-breakpoint

CREATE TABLE `resource_offerings` (
  `id` text PRIMARY KEY NOT NULL,
  `offered_by_agent` text NOT NULL,
  `offered_by_user_id` text,
  `hub_id` text NOT NULL,
  `resource_type` text NOT NULL,
  `resource_type_label` text NOT NULL,
  `title` text NOT NULL,
  `detail` text,
  `status` text DEFAULT 'available' NOT NULL,
  `capacity` text,
  `geo` text,
  `time_window` text,
  `capabilities` text,
  `valid_until` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint

CREATE INDEX `offerings_hub_status_idx` ON `resource_offerings` (`hub_id`, `status`);
--> statement-breakpoint

CREATE INDEX `offerings_agent_idx` ON `resource_offerings` (`offered_by_agent`);
--> statement-breakpoint

CREATE INDEX `offerings_type_idx` ON `resource_offerings` (`resource_type`);
--> statement-breakpoint

CREATE TABLE `need_resource_matches` (
  `id` text PRIMARY KEY NOT NULL,
  `need_id` text NOT NULL,
  `offering_id` text NOT NULL,
  `matched_agent` text NOT NULL,
  `status` text DEFAULT 'proposed' NOT NULL,
  `score` integer NOT NULL,
  `reason` text NOT NULL,
  `satisfies` text,
  `misses` text,
  `generated_by_activity` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`need_id`) REFERENCES `needs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`offering_id`) REFERENCES `resource_offerings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint

CREATE INDEX `matches_need_idx` ON `need_resource_matches` (`need_id`);
--> statement-breakpoint

CREATE INDEX `matches_agent_status_idx` ON `need_resource_matches` (`matched_agent`, `status`);
--> statement-breakpoint

CREATE TABLE `role_assignments` (
  `id` text PRIMARY KEY NOT NULL,
  `bearer_agent` text NOT NULL,
  `role_played` text NOT NULL,
  `context_entity` text NOT NULL,
  `target_agent` text,
  `source_match_id` text,
  `starts_at` text,
  `ends_at` text,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint

CREATE INDEX `role_assignments_bearer_idx` ON `role_assignments` (`bearer_agent`);
--> statement-breakpoint

CREATE INDEX `role_assignments_context_idx` ON `role_assignments` (`context_entity`);
