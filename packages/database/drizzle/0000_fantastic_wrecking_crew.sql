CREATE TABLE "scout_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scout_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text,
	"description" text,
	"goal" text,
	"search_queries" jsonb DEFAULT '[]'::jsonb,
	"location" jsonb,
	"frequency" text,
	"is_active" boolean DEFAULT false,
	"last_run_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scout_execution_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"step_number" integer NOT NULL,
	"step_type" text NOT NULL,
	"description" text NOT NULL,
	"input_data" jsonb,
	"output_data" jsonb,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scout_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scout_id" uuid NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"error_message" text,
	"results_summary" jsonb,
	"summary_text" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "propositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scout_id" uuid NOT NULL,
	"execution_id" uuid,
	"content" text NOT NULL,
	"source_url" text NOT NULL,
	"dom_selector" text,
	"confidence" real DEFAULT 1,
	"embedding" vector(1536),
	"status" text DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scent_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scout_id" uuid NOT NULL,
	"drift_score" real NOT NULL,
	"volatility_factor" real NOT NULL,
	"base_interval_minutes" integer NOT NULL,
	"computed_interval_minutes" integer NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "veracity_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scout_id" uuid,
	"execution_id" uuid,
	"claim" text NOT NULL,
	"overall_confidence" real NOT NULL,
	"independent_sources_count" integer NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"has_contradiction" boolean DEFAULT false,
	"contradiction_details" text,
	"audit_passed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "firecrawl_usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scout_id" uuid,
	"execution_id" uuid,
	"used_fallback" boolean DEFAULT false NOT NULL,
	"fallback_reason" text,
	"api_calls_count" integer DEFAULT 1,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"location" jsonb,
	"firecrawl_api_key" text,
	"firecrawl_custom_api_key" text,
	"firecrawl_key_status" text DEFAULT 'pending',
	"firecrawl_key_created_at" timestamp with time zone,
	"firecrawl_key_error" text,
	"last_test_email_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "user_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "scout_messages" ADD CONSTRAINT "scout_messages_scout_id_scouts_id_fk" FOREIGN KEY ("scout_id") REFERENCES "public"."scouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_execution_steps" ADD CONSTRAINT "scout_execution_steps_execution_id_scout_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."scout_executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_executions" ADD CONSTRAINT "scout_executions_scout_id_scouts_id_fk" FOREIGN KEY ("scout_id") REFERENCES "public"."scouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propositions" ADD CONSTRAINT "propositions_scout_id_scouts_id_fk" FOREIGN KEY ("scout_id") REFERENCES "public"."scouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "propositions" ADD CONSTRAINT "propositions_execution_id_scout_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."scout_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scent_metrics" ADD CONSTRAINT "scent_metrics_scout_id_scouts_id_fk" FOREIGN KEY ("scout_id") REFERENCES "public"."scouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veracity_audits" ADD CONSTRAINT "veracity_audits_scout_id_scouts_id_fk" FOREIGN KEY ("scout_id") REFERENCES "public"."scouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veracity_audits" ADD CONSTRAINT "veracity_audits_execution_id_scout_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."scout_executions"("id") ON DELETE cascade ON UPDATE no action;