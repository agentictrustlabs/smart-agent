-- Agent index: minimal off-chain index into on-chain agents
-- Identity (name, description, type) from AgentAccountResolver
-- Relationships from AgentRelationship edges
-- This table only stores: user mappings + template IDs

CREATE TABLE `agent_index` (
	`smart_account_address` text PRIMARY KEY NOT NULL,
	`agent_kind` text NOT NULL,
	`user_id` text,
	`created_by` text,
	`operated_by` text,
	`template_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
