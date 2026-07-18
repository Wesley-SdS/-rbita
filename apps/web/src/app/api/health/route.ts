import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", db: "up", ts: new Date().toISOString() });
  } catch (e) {
    return Response.json(
      { status: "error", db: "down", error: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }
}
