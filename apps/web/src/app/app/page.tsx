import { getSession } from "@/lib/session";
import { VisaoGeral } from "@/components/presenca/visao-geral";

export default async function PaginaInicio() {
  // O layout já garantiu a sessão; aqui ela só serve para o nome na saudação.
  const sessao = await getSession();
  return <VisaoGeral nomeUsuario={sessao?.user.name || "Você"} />;
}
