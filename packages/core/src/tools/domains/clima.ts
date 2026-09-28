import { z } from "zod";
import { getWeather } from "../weather";
import { registerTools, type ToolDef } from "../registry";
import { settings } from "../../settings";

/**
 * Domínio: clima (Open-Meteo, sem chave).
 *
 * A cidade é OPCIONAL: sem ela, vale a da casa (Ajustes). Antes a tool exigia a
 * cidade, e "vai chover amanhã?" virava "de qual cidade?" toda vez, inclusive
 * no briefing da manhã, que não tem a quem perguntar.
 */
const Entrada = z.object({ cidade: z.string().max(120).optional().describe("Cidade. Vazio: a da casa.") });

export const previsao_tempo: ToolDef<typeof Entrada> = {
  name: "previsao_tempo",
  domain: "clima",
  description: "Previsão do tempo (temperatura, sensação, condição, mín/máx, chuva). Sem cidade, usa a da casa. Use no briefing \"bom dia\".",
  risk: "leitura",
  keywords: ["tempo", "clima", "chuva", "temperatura", "previsão", "frio", "calor", "guarda-chuva"],
  inputSchema: Entrada,
  run: async ({ cidade }) => {
    const alvo = cidade?.trim() || (await settings.get("casa.cidade")).trim();
    if (!alvo) return "Não sei a cidade da casa: pergunte ao dono e peça para ele cadastrar em Ajustes (Casa, cidade).";
    return getWeather(alvo);
  },
};

registerTools([previsao_tempo]);
