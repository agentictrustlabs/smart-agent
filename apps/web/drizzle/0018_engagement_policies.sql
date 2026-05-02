-- R13 — Governance shape: engagement_policies + policy_signers tables.
-- Credential, Organization, Church engagements: multi-party sign-off.
--
-- Spec: docs/specs/engagement-shapes-plan.md §6 R13

CREATE TABLE `engagement_policies` (
  `id` text PRIMARY KEY NOT NULL,
  `engagement_id` text NOT NULL UNIQUE,
  -- Optional URL pointing at the policy doc / charter / charter draft.
  `policy_doc_uri` text,
  -- One-line description of what's being approved.
  `policy_summary` text,
  `current_state` text NOT NULL DEFAULT 'draft',
  `required_signers` integer NOT NULL DEFAULT 1,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`engagement_id`) REFERENCES `entitlements`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ep_engagement_idx` ON `engagement_policies` (`engagement_id`);
--> statement-breakpoint

CREATE TABLE `policy_signers` (
  `id` text PRIMARY KEY NOT NULL,
  `policy_id` text NOT NULL,
  -- Lowercased agent address.
  `agent` text NOT NULL,
  -- Free-form role label: 'Board Chair', 'Treasurer', 'GMCN Officer'.
  `role` text NOT NULL,
  `signed_at` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`policy_id`) REFERENCES `engagement_policies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ps_policy_idx` ON `policy_signers` (`policy_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `ps_policy_agent_uniq` ON `policy_signers` (`policy_id`, `agent`);
