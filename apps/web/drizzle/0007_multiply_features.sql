CREATE TABLE IF NOT EXISTS `circles` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `person_name` text NOT NULL,
  `proximity` integer NOT NULL DEFAULT 3,
  `response` text NOT NULL DEFAULT 'curious',
  `planned_conversation` integer NOT NULL DEFAULT 0,
  `notes` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `prayers` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `title` text NOT NULL,
  `notes` text,
  `schedule` text NOT NULL DEFAULT 'daily',
  `last_prayed` text,
  `answered` integer NOT NULL DEFAULT 0,
  `answered_at` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `training_progress` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `module_key` text NOT NULL,
  `program` text NOT NULL,
  `track` text,
  `completed` integer NOT NULL DEFAULT 0,
  `completed_at` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `coach_relationships` (
  `id` text PRIMARY KEY NOT NULL,
  `disciple_id` text NOT NULL,
  `coach_id` text NOT NULL,
  `share_permissions` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'active',
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_preferences` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL UNIQUE,
  `language` text NOT NULL DEFAULT 'en',
  `home_church` text,
  `location` text,
  `created_at` text NOT NULL
);
