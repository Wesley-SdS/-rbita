import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";
import { settings } from "../../settings";
import { log } from "../../observability/logger";
import { paraHoraLocal } from "../../fuso";
import { calcularRota, cotar, duracaoLegivel, geocodificar, interpretarAtivo, resolverLugar, rotaComTransito, type Modo } from "../mundo";

/**
 * Domínio: o mundo lá fora (cotação e rota). Leitura, sem gate.
 */

const Cotacao = z.object({
  ativo: z.string().min(1).max(40).describe("Moeda ('dólar', 'euro', 'bitcoin', 'USD') ou ação ('PETR4', 'VALE3', 'AAPL')."),
});

export const cotacao: ToolDef<typeof Cotacao> = {
  name: "cotacao",
  domain: "mundo",
  description: "Cotação atual de moeda (em reais), cripto ou ação da bolsa, com a variação do dia. Use para 'quanto está o dólar?', 'como está a PETR4?'.",
  risk: "leitura",
  keywords: ["cotacao", "dolar", "euro", "bitcoin", "acao", "bolsa", "cambio", "preco", "moeda"],
  inputSchema: Cotacao,
  run: async ({ ativo }) => {
    const a = interpretarAtivo(ativo);
    if (!a) return `Não sei cotar "${ativo}". Diga a moeda (dólar, euro, bitcoin) ou o código da ação (PETR4).`;
    try {
      const c = await cotar(a);
      const preco = c.preco.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
      const variacao = c.variacaoPct === null ? "" : `, ${c.variacaoPct >= 0 ? "+" : ""}${c.variacaoPct.toFixed(2).replace(".", ",")}% no dia`;
      // o Yahoo dá a hora em UTC ("…T21:00Z"): o modelo leria 21h num fechamento às 18h de Brasília
      const quando = c.quando && /T\d{2}:\d{2}.*Z$/.test(c.quando) ? paraHoraLocal(new Date(c.quando), await settings.get("connectors.fusoHorario")) : c.quando;
      return `${c.ativo}: ${c.moeda === "BRL" ? "R$ " : `${c.moeda} `}${preco}${variacao} (fonte: ${c.fonte}${quando ? `, ${quando}` : ""}).`;
    } catch (e) {
      return e instanceof Error && e.message.startsWith("Não achei") ? e.message : "O serviço de cotação não respondeu agora. Tente de novo em instantes.";
    }
  },
};

const Rota = z.object({
  destino: z.string().min(2).max(200).describe("Endereço, ou o NOME de um lugar salvo (\"trabalho\", \"Adalink\", \"casa\")."),
  origem: z.string().max(200).optional().describe("De onde sai. Vazio: da casa (endereço em Ajustes)."),
  modo: z.enum(["carro", "a_pe", "bicicleta"]).optional().describe("Padrão: carro."),
});

export const rota: ToolDef<typeof Rota> = {
  name: "rota",
  domain: "mundo",
  description: "Distância e tempo de viagem entre dois lugares (de carro, a pé ou de bicicleta), com o trânsito de agora quando há serviço de trânsito. Sem a origem, sai de casa. Aceita o nome de um lugar salvo pelo dono. Repita ao dono se o tempo é com ou sem trânsito, como a ferramenta disser.",
  risk: "leitura",
  keywords: ["rota", "caminho", "distancia", "quanto tempo", "chegar", "ir", "transito", "km", "trajeto"],
  inputSchema: Rota,
  run: async ({ destino, origem, modo }) => {
    const [casaCfg, lugaresCfg] = await Promise.all([settings.get("casa.endereco"), settings.get("casa.lugares")]);
    const casa = (casaCfg ?? "").trim();
    const lugares = lugaresCfg ?? [];
    const de = origem?.trim() ? resolverLugar(origem, casa, lugares) : casa || null;
    const para = resolverLugar(destino, casa, lugares);
    if (!de || !para) return "Não sei o endereço da casa: peça para o dono cadastrar em Ajustes (Casa, endereço), ou use um endereço completo.";
    try {
      const [a, b] = await Promise.all([geocodificar(de), geocodificar(para)]);
      if (!a) return `Não achei o endereço de origem "${de}".`;
      if (!b) return `Não achei o endereço "${para}".`;
      const m = (modo ?? "carro") as Modo;
      const km = (n: number) => String(n).replace(".", ",");
      // de carro, o trânsito de agora quando há chave; falha nele cai no OSRM
      const t =
        m === "carro"
          ? await rotaComTransito(a, b).catch((e) => {
              // sem isto uma chave vencida do TomTom tirava o trânsito em silêncio
              log.warn("rota.transito_falhou", { erro: (e instanceof Error ? e.message : String(e)).slice(0, 120) });
              return null;
            })
          : null;
      if (t) {
        const atraso = t.atrasoMin > 0 ? `, ${duracaoLegivel(t.atrasoMin)} disso por causa do trânsito` : ", trânsito livre";
        return `${duracaoLegivel(t.minutos)} (${km(t.km)} km) de carro com o trânsito de agora${atraso}. De: ${a.nome}. Para: ${b.nome}.`;
      }
      const r = await calcularRota(a, b, m);
      return `${duracaoLegivel(r.minutos)} (${km(r.km)} km) ${m === "a_pe" ? "a pé" : m === "bicicleta" ? "de bicicleta" : "de carro"}, sem contar o trânsito de agora. De: ${a.nome}. Para: ${b.nome}.`;
    } catch (e) {
      return e instanceof Error && e.message.startsWith("Não encontrei") ? e.message : "O serviço de rotas não respondeu agora. Tente de novo em instantes.";
    }
  },
};

registerTools([cotacao, rota]);
