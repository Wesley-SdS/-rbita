CREATE TABLE "reuniao_importada" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"fonte" text NOT NULL,
	"external_id" text NOT NULL,
	"titulo" text NOT NULL,
	"inicio" timestamp,
	"situacao" text NOT NULL,
	"job_id" text,
	"criado_em" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reuniao_importada_user_fonte_ext" UNIQUE("user_id","fonte","external_id")
);
--> statement-breakpoint
ALTER TABLE "reuniao_importada" ADD CONSTRAINT "reuniao_importada_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;