import { semearDaApi } from "@/lib/dados/servidor";
import { CacheSemeado } from "@/lib/dados/semeadura";
import { Conteudo } from "./conteudo";

/**
 * A tela em si é cliente (`conteudo.tsx`); esta camada de servidor existe só
 * para ADIANTAR as leituras da primeira aba.
 *
 * Sem isto, a sequência era: payload da rota, depois o JavaScript do painel,
 * depois a busca. Agora a busca acontece enquanto o JavaScript baixa, e o
 * painel monta já preenchido. Falha aqui não quebra nada: o painel busca
 * sozinho, como antes.
 *
 * Só a primeira aba é adiantada. Adiantar as outras seria pagar por dados que
 * ninguém pediu, que é exatamente o problema que este trabalho veio resolver.
 */
export default async function PaginaRotinas() {
  const dados = await semearDaApi([
    "/api/routines",
    "/api/notifications",
  ]);
  return (
    <CacheSemeado dados={dados}>
      <Conteudo />
    </CacheSemeado>
  );
}
