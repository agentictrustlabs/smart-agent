-- I2 — Intent / BDI layer.
-- T-Box: docs/ontology/tbox/intents.ttl
-- SKOS:  docs/ontology/cbox/intent-types.ttl
-- SHACL: docs/ontology/cbox/intent-shapes.shacl.ttl

ALTER TABLE `activity_logs` ADD COLUMN `fulfills_intent_id` text;
--> statement-breakpoint
ALTER TABLE `activity_logs` ADD COLUMN `achieves_outcome_id` text;
--> statement-breakpoint

CREATE TABLE `intents` (
  `id` text PRIMARY KEY NOT NULL,
  `direction` text NOT NULL,
  `object` text NOT NULL,
  `topic` text,
  `intent_type` text NOT NULL,
  `intent_type_label` text NOT NULL,
  `expressed_by_agent` text NOT NULL,
  `expressed_by_user_id` text,
  `addressed_to` text NOT NULL,
  `hub_id` text NOT NULL,
  `title` text NOT NULL,
  `detail` text,
  `payload` text,
  `status` text DEFAULT 'expressed' NOT NULL,
  `priority` text DEFAULT 'normal' NOT NULL,
  `visibility` text DEFAULT 'public' NOT NULL,
  `expected_outcome` text,
  `projection_ref` text,
  `valid_until` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint

CREATE INDEX `intents_hub_status_idx` ON `intents` (`hub_id`, `status`);
--> statement-breakpoint
CREATE INDEX `intents_direction_object_idx` ON `intents` (`direction`, `object`);
--> statement-breakpoint
CREATE INDEX `intents_expressed_by_idx` ON `intents` (`expressed_by_agent`);
--> statement-breakpoint
CREATE INDEX `intents_addressed_to_idx` ON `intents` (`addressed_to`);
--> statement-breakpoint
CREATE INDEX `intents_projection_ref_idx` ON `intents` (`projection_ref`);
--> statement-breakpoint

CREATE TABLE `outcomes` (
  `id` text PRIMARY KEY NOT NULL,
  `intent_id` text NOT NULL,
  `description` text NOT NULL,
  `metric` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `observed_at` text,
  `observed_by` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`intent_id`) REFERENCES `intents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `outcomes_intent_idx` ON `outcomes` (`intent_id`);
--> statement-breakpoint

CREATE TABLE `orchestration_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `parent_intent_id` text NOT NULL,
  `author_agent` text NOT NULL,
  `blueprint` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`parent_intent_id`) REFERENCES `intents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `orchestration_parent_idx` ON `orchestration_plans` (`parent_intent_id`);
--> statement-breakpoint

CREATE TABLE `beliefs` (
  `id` text PRIMARY KEY NOT NULL,
  `held_by_agent` text NOT NULL,
  `assertion_id` text,
  `statement` text NOT NULL,
  `confidence` integer DEFAULT 75 NOT NULL,
  `informs_intent_id` text,
  `valid_until` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `beliefs_held_by_idx` ON `beliefs` (`held_by_agent`);
--> statement-breakpoint
CREATE INDEX `beliefs_intent_idx` ON `beliefs` (`informs_intent_id`);
