import { z } from "zod";
import { getWeather } from "../weather";
import { registerTools, type ToolDef } from "../registry";

/** Domínio: clima (Open-Meteo, sem chave). */
export const previsao_tempo: ToolDef<z.ZodObject<{ cidade: z.ZodString }>> = {
  name: "previsao_tempo",
  domain: "clima",
  description: "Previsão do tempo de uma cidade (temperatura, sensação, condição, mín/máx, chuva). Use no briefing 'bom dia'.",
  risk: "leitura",
  keywords: ["tempo", "clima", "chuva", "temperatura", "previsão", "frio", "calor", "guarda-chuva"],
  inputSchema: z.object({ cidade: z.string() }),
  run: async ({ cidade }) => getWeather(cidade),
};

registerTools([previsao_tempo]);
