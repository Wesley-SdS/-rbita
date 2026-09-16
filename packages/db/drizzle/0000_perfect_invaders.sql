CREATE TABLE "meta" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meta_key_unique" UNIQUE("key")
);
