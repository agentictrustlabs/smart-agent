CREATE TABLE `ai_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`agent_type` text DEFAULT 'custom' NOT NULL,
	`created_by` text NOT NULL,
	`operated_by` text,
	`smart_account_address` text NOT NULL,
	`chain_id` integer NOT NULL,
	`salt` text NOT NULL,
	`implementation_type` text DEFAULT 'hybrid' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`agent_address` text NOT NULL,
	`agent_name` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`accepted_by` text,
	`accepted_at` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_code_unique` ON `invites` (`code`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`link` text,
	`read` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `org_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_by` text NOT NULL,
	`smart_account_address` text NOT NULL,
	`chain_id` integer NOT NULL,
	`salt` text NOT NULL,
	`implementation_type` text DEFAULT 'hybrid' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `person_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Person Agent' NOT NULL,
	`user_id` text NOT NULL,
	`smart_account_address` text NOT NULL,
	`chain_id` integer NOT NULL,
	`salt` text NOT NULL,
	`implementation_type` text DEFAULT 'hybrid' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `person_agents_user_id_unique` ON `person_agents` (`user_id`);--> statement-breakpoint
CREATE TABLE `review_delegations` (
	`id` text PRIMARY KEY NOT NULL,
	`reviewer_agent_address` text NOT NULL,
	`subject_agent_address` text NOT NULL,
	`edge_id` text NOT NULL,
	`delegation_json` text NOT NULL,
	`salt` text NOT NULL,
	`expires_at` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `review_records` (
	`id` text PRIMARY KEY NOT NULL,
	`on_chain_review_id` integer,
	`reviewer_user_id` text NOT NULL,
	`reviewer_agent_address` text NOT NULL,
	`subject_address` text NOT NULL,
	`review_type` text NOT NULL,
	`recommendation` text NOT NULL,
	`overall_score` integer NOT NULL,
	`comment` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`name` text NOT NULL,
	`wallet_address` text NOT NULL,
	`privy_user_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_wallet_address_unique` ON `users` (`wallet_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_privy_user_id_unique` ON `users` (`privy_user_id`);