CREATE TABLE "detached_members" (
	"id" text PRIMARY KEY NOT NULL,
	"org_principal" text NOT NULL,
	"display_name" text NOT NULL,
	"contact_info_encrypted" text,
	"tracked_since" text,
	"notes" text,
	"assigned_node_id" text,
	"role" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disbursements" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"round_id" text NOT NULL,
	"tranche_label" text NOT NULL,
	"amount" integer NOT NULL,
	"unit" text DEFAULT 'USD' NOT NULL,
	"recipient_agent_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"claimed_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"tx_hash" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"entitlement_id" text NOT NULL,
	"org_principal" text NOT NULL,
	"policy_type" text NOT NULL,
	"document_uri" text,
	"version" text,
	"signatures_required" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_provider_state" (
	"entitlement_id" text PRIMARY KEY NOT NULL,
	"org_principal" text NOT NULL,
	"capacity_remaining" integer,
	"provider_notes" text,
	"internal_assignee" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagement_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"entitlement_id" text NOT NULL,
	"org_principal" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"occurred_at" timestamp with time zone,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "engagement_tranches" (
	"id" text PRIMARY KEY NOT NULL,
	"entitlement_id" text NOT NULL,
	"org_principal" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"amount_cents" integer,
	"currency" text DEFAULT 'XOF' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"released_at" timestamp with time zone,
	"gated_on_report_id" text
);
--> statement-breakpoint
CREATE TABLE "org_activity_log_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_principal" text NOT NULL,
	"kind" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"performed_by_agent" text,
	"duration_min" integer,
	"geo" text,
	"participants" text,
	"fulfills_entitlement_id" text,
	"fulfills_need_id" text,
	"fulfills_intent_id" text,
	"payload" text,
	"evidence_uri" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_beliefs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_principal" text NOT NULL,
	"statement" text NOT NULL,
	"tags" text,
	"informs_intent_id" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_cross_delegation_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"org_principal" text NOT NULL,
	"grantee_agent" text NOT NULL,
	"scope" text NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"caveat_terms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "org_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_principal" text NOT NULL,
	"direction" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"kind" text NOT NULL,
	"addressed_to" text,
	"summary" text NOT NULL,
	"context" text,
	"status" text DEFAULT 'expressed' NOT NULL,
	"priority" text,
	"expires_at" timestamp with time zone,
	"on_chain_assertion_id" text,
	"live_acknowledgement_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_needs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_principal" text NOT NULL,
	"intent_id" text NOT NULL,
	"kind" text NOT NULL,
	"requirements" text,
	"status" text DEFAULT 'open' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"geo" text,
	"capacity_needed" integer,
	"on_chain_assertion_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_principal" text NOT NULL,
	"kind" text NOT NULL,
	"payload" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_offerings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_principal" text NOT NULL,
	"intent_id" text NOT NULL,
	"kind" text NOT NULL,
	"capabilities" text,
	"capacity" integer,
	"visibility" text DEFAULT 'private' NOT NULL,
	"geo" text,
	"time_window" text,
	"on_chain_assertion_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_principal" text NOT NULL,
	"intent_id" text NOT NULL,
	"metric" text NOT NULL,
	"target" text,
	"achieved" integer DEFAULT 0 NOT NULL,
	"achieved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_profiles_private" (
	"org_principal" text PRIMARY KEY NOT NULL,
	"internal_contact_email" text,
	"internal_contact_phone" text,
	"financial_contacts" text,
	"internal_notes" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_token_usage" (
	"jti" text PRIMARY KEY NOT NULL,
	"org_principal" text NOT NULL,
	"usage_count" integer DEFAULT 1 NOT NULL,
	"usage_limit" integer NOT NULL,
	"first_used_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_principal" text NOT NULL,
	"entitlement_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_activity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcome_attestations" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"milestone_label" text NOT NULL,
	"validator_agent_id" text NOT NULL,
	"status" text NOT NULL,
	"evidence" text,
	"attested_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_signers" (
	"id" text PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"signer_agent" text NOT NULL,
	"role" text,
	"signed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "revenue_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"org_principal" text NOT NULL,
	"period" text NOT NULL,
	"gross_revenue" integer,
	"expenses" integer,
	"net_revenue" integer,
	"share_payment" integer,
	"currency" text DEFAULT 'XOF' NOT NULL,
	"notes" text,
	"evidence_uri" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"submitted_by" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"verified_by" text,
	"verified_at" timestamp with time zone
);
