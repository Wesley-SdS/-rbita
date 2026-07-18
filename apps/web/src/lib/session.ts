import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/** Sessão atual no servidor (Server Components / Route Handlers). */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}
