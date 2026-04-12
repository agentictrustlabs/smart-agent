-- General-purpose activity logging and CPM generational mapping tables
-- Activity logs are a base platform capability; gen_map_nodes support the CPM use case

CREATE TABLE `activity_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`org_address` text NOT NULL,
	`user_id` text NOT NULL,
	`activity_type` text DEFAULT 'other' NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`participants` integer DEFAULT 0 NOT NULL,
	`location` text,
	`lat` text,
	`lng` text,
	`duration_minutes` integer,
	`related_entity` text,
	`activity_date` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `gen_map_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`network_address` text NOT NULL,
	`group_address` text,
	`parent_id` text,
	`generation` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`leader_name` text,
	`location` text,
	`health_data` text,
	`status` text DEFAULT 'active' NOT NULL,
	`started_at` text,
	`created_at` text NOT NULL
);
