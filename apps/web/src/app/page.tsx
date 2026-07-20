import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

/**
 * Raiz do app: não há landing page. Quem já tem sessão vai direto para o
 * console; quem não tem cai no login.
 */
export default async function Home() {
  const s = await getSession();
  redirect(s ? "/app" : "/login");
}
