-- Agent metadata column on org_agents for structured data (health, generation, leader, etc.)
-- This replaces a separate circle_health table — metadata belongs ON the agent

ALTER TABLE `org_agents` ADD COLUMN `metadata` text;
--> statement-breakpoint
-- Demo edges: DB-level relationship edges for demo mode (no chain required)
-- Represents the same data as on-chain AgentRelationship edges
CREATE TABLE `demo_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_address` text NOT NULL,
	`object_address` text NOT NULL,
	`relationship_type` text NOT NULL,
	`roles` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
