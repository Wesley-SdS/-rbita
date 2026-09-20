import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { settings } from "@orbita/core/settings/index";
import { Casca } from "@/components/presenca/casca";

/**
 * Casca do Presença: barra lateral, topo e a área de conteúdo.
 *
 * A sessão é conferida aqui, uma vez, em vez de em cada página: toda tela sob
 * `/app` exige login, e repetir a checagem por rota é como uma delas acaba
 * esquecendo.
 *
 * As preferências de interface vêm resolvidas do servidor para não haver um
 * salto visual: se o núcleo montasse na intensidade padrão e só depois lesse a
 * configuração, quem escolheu movimento reduzido veria justamente o movimento
 * que pediu para não ver.
 */
export default async function LayoutDoApp({ children }: { children: React.ReactNode }) {
  const sessao = await getSession();
  if (!sessao) redirect("/login");

  // Falha em silêncio de propósito: banco fora do ar não pode impedir o app de
  // abrir, e os padrões das chaves já são sensatos.
  //
  // As validades do cache de dados descem por aqui, junto com o resto: é o que
  // permite ao front não ter número de TTL chumbado (§5.6) sem pagar uma
  // requisição a mais só para descobri-los.
  const prefs = await settings
    .getMany([
      "presenca.focoMinutos",
      "presenca.intensidade",
      "presenca.movimentoReduzido",
      "cache.recursoTtlMs",
      "cache.recursoTtlLentoMs",
      "cache.offlineLeitura",
    ])
    .catch(() => ({
      "presenca.focoMinutos": 25,
      "presenca.intensidade": 85,
      "presenca.movimentoReduzido": false,
      "cache.recursoTtlMs": 20_000,
      "cache.recursoTtlLentoMs": 300_000,
      "cache.offlineLeitura": true,
    }));

  return (
    <Casca
      nomeUsuario={sessao.user.name || "Você"}
      focoMinutos={prefs["presenca.focoMinutos"]}
      intensidade={prefs["presenca.intensidade"]}
      reduzido={prefs["presenca.movimentoReduzido"]}
      cacheTtlMs={prefs["cache.recursoTtlMs"]}
      cacheTtlLentoMs={prefs["cache.recursoTtlLentoMs"]}
      offlineLeitura={prefs["cache.offlineLeitura"]}
    >
      {children}
    </Casca>
  );
}
