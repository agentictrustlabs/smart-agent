-- General-purpose tables for revenue reporting, capital tracking, training, and governance
-- These support the Togo revenue-sharing pilot but are designed for any org template

CREATE TABLE `revenue_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`org_address` text NOT NULL,
	`submitted_by` text NOT NULL,
	`period` text NOT NULL,
	`gross_revenue` integer NOT NULL,
	`expenses` integer NOT NULL,
	`net_revenue` integer NOT NULL,
	`share_payment` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'XOF' NOT NULL,
	`notes` text,
	`verified_by` text,
	`verified_at` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `capital_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`treasury_agent` text NOT NULL,
	`direction` text NOT NULL,
	`counterparty` text NOT NULL,
	`amount` text NOT NULL,
	`currency` text DEFAULT 'ETH' NOT NULL,
	`purpose` text,
	`authorized_by` text,
	`tx_hash` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`authorized_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `training_modules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`program` text DEFAULT 'bdc' NOT NULL,
	`hours` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `training_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`module_id` text NOT NULL,
	`assessed_by` text,
	`score` integer,
	`notes` text,
	`completed_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`module_id`) REFERENCES `training_modules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assessed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`org_address` text NOT NULL,
	`proposer` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`action_type` text DEFAULT 'general' NOT NULL,
	`target_address` text,
	`quorum_required` integer DEFAULT 2 NOT NULL,
	`votes_for` integer DEFAULT 0 NOT NULL,
	`votes_against` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`executed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`proposer`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `votes` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL,
	`voter` text NOT NULL,
	`vote` text NOT NULL,
	`comment` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`voter`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
