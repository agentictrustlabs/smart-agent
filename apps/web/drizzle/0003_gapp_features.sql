-- GAPP-matching features: detached members, pinned items, activity chaining
-- activity_logs.chained_from column for linking activities in sequence

CREATE TABLE `detached_members` (
	`id` text PRIMARY KEY NOT NULL,
	`org_address` text NOT NULL,
	`name` text NOT NULL,
	`assigned_node_id` text,
	`role` text,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pinned_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
