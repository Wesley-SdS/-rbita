import { semearDaApi } from "@/lib/dados/servidor";
import { CacheSemeado } from "@/lib/dados/semeadura";
import { Conteudo } from "./conteudo";

/**
 * Gestão de gastos. A tela em si é cliente; esta camada de servidor só
 * adianta a leitura do período padrão.
 */
export default async function PaginaGestao() {
  const dados = await semearDaApi(["/api/gestao?periodo=semana"]);
  return (
    <CacheSemeado dados={dados}>
      <Conteudo />
    </CacheSemeado>
  );
}
