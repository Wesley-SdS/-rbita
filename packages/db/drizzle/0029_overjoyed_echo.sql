CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"title" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input" text,
	"dedup_key" text,
	"progress_done" integer DEFAULT 0 NOT NULL,
	"progress_total" integer,
	"step" text,
	"result" jsonb,
	"error" text,
	"error_permanent" boolean DEFAULT false NOT NULL,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp DEFAULT now() NOT NULL,
	"locked_by" text,
	"heartbeat_at" timestamp,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guided_task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"person_id" uuid,
	"title" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"camera_id" uuid,
	"room_id" uuid,
	"status" text DEFAULT 'ativa' NOT NULL,
	"interval_seconds" integer NOT NULL,
	"last_look_at" timestamp,
	"last_observation" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guided_task" ADD CONSTRAINT "guided_task_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guided_task" ADD CONSTRAINT "guided_task_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guided_task" ADD CONSTRAINT "guided_task_camera_id_camera_id_fk" FOREIGN KEY ("camera_id") REFERENCES "public"."camera"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guided_task" ADD CONSTRAINT "guided_task_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_pronto_idx" ON "job" USING btree ("run_at") WHERE "job"."status" = 'pendente';--> statement-breakpoint
CREATE UNIQUE INDEX "job_dedup_idx" ON "job" USING btree ("dedup_key") WHERE "job"."dedup_key" is not null and "job"."status" in ('pendente', 'rodando');--> statement-breakpoint
CREATE INDEX "job_user_idx" ON "job" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "guided_task_ativa_idx" ON "guided_task" USING btree ("status","last_look_at");--> statement-breakpoint
CREATE INDEX "guided_task_user_idx" ON "guided_task" USING btree ("user_id","created_at");