-- E2 — Entitlement & Fulfillment layer.
-- T-Box:  docs/ontology/tbox/entitlements.ttl
-- SKOS:   docs/ontology/cbox/capacity-units.ttl
-- SHACL:  docs/ontology/cbox/entitlement-shapes.shacl.ttl

ALTER TABLE `activity_logs` ADD COLUMN `fulfills_entitlement_id` text;
--> statement-breakpoint

ALTER TABLE `role_assignments` ADD COLUMN `source_entitlement_id` text;
--> statement-breakpoint

CREATE TABLE `entitlements` (
  `id` text PRIMARY KEY NOT NULL,
  `source_match_id` text NOT NULL,
  `holder_intent_id` text NOT NULL,
  `provider_intent_id` text NOT NULL,
  `holder_agent` text NOT NULL,
  `provider_agent` text NOT NULL,
  `hub_id` text NOT NULL,
  `terms` text NOT NULL,
  `capacity_unit` text NOT NULL,
  `capacity_granted` integer NOT NULL,
  `capacity_remaining` integer NOT NULL,
  `cadence` text DEFAULT 'weekly' NOT NULL,
  `linked_outcome_id` text,
  `status` text DEFAULT 'granted' NOT NULL,
  `valid_from` text NOT NULL,
  `valid_until` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint

CREATE INDEX `ent_source_match_idx` ON `entitlements` (`source_match_id`);
--> statement-breakpoint
CREATE INDEX `ent_holder_idx` ON `entitlements` (`holder_agent`, `status`);
--> statement-breakpoint
CREATE INDEX `ent_provider_idx` ON `entitlements` (`provider_agent`, `status`);
--> statement-breakpoint
CREATE INDEX `ent_holder_intent_idx` ON `entitlements` (`holder_intent_id`);
--> statement-breakpoint
CREATE INDEX `ent_hub_status_idx` ON `entitlements` (`hub_id`, `status`);
--> statement-breakpoint

CREATE TABLE `fulfillment_work_items` (
  `id` text PRIMARY KEY NOT NULL,
  `entitlement_id` text NOT NULL,
  `assignee_agent` text NOT NULL,
  `task_kind` text NOT NULL,
  `title` text NOT NULL,
  `detail` text,
  `cadence` text DEFAULT 'one-shot' NOT NULL,
  `due_at` text,
  `resolved_by_activity_id` text,
  `status` text DEFAULT 'open' NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`entitlement_id`) REFERENCES `entitlements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wi_entitlement_idx` ON `fulfillment_work_items` (`entitlement_id`);
--> statement-breakpoint
CREATE INDEX `wi_assignee_status_idx` ON `fulfillment_work_items` (`assignee_agent`, `status`);
