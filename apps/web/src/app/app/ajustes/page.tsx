import { getSession } from "@/lib/session";
import { Preferencias } from "./preferencias";

export default async function PaginaAjustes() {
  // O painel de privacidade pede o e-mail para confirmar o apagar da conta.
  const sessao = await getSession();
  return <Preferencias email={sessao?.user.email ?? ""} />;
}
