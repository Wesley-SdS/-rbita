import { getSession } from "@/lib/session";
import { Preferencias } from "./preferencias";

export default async function PaginaAjustes({ searchParams }: { searchParams: Promise<{ aba?: string | string[] }> }) {
  // O painel de privacidade pede o e-mail para confirmar o apagar da conta.
  const [sessao, params] = await Promise.all([getSession(), searchParams]);
  // `?aba=controle`: o cartão "Órbita no controle" abre direto na trilha
  const aba = typeof params.aba === "string" ? params.aba.slice(0, 40) : undefined;
  return <Preferencias email={sessao?.user.email ?? ""} aba={aba} />;
}
