CREATE TABLE "scout_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scout_id" uuid NOT NULL,
	"execution_id" uuid,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"urgency" text DEFAULT 'medium' NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "scout_notifications" ADD CONSTRAINT "scout_notifications_scout_id_scouts_id_fk" FOREIGN KEY ("scout_id") REFERENCES "public"."scouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scout_notifications" ADD CONSTRAINT "scout_notifications_execution_id_scout_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."scout_executions"("id") ON DELETE set null ON UPDATE no action;