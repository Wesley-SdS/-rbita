import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definida");

// Reaproveita a conexão em dev (evita esgotar conexões no hot-reload do Next).
const globalForDb = globalThis as unknown as { _pg?: ReturnType<typeof postgres> };
const client = globalForDb._pg ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb._pg = client;

export const db = drizzle(client, { schema });
export { schema };
