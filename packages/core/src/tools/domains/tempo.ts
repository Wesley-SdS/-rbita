import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";

/** Domínio: tempo (data e hora do sistema). */
export const hora_atual: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "hora_atual",
  domain: "tempo",
  description: "Retorna a data e a hora atuais do sistema.",
  risk: "leitura",
  keywords: ["hora", "data", "hoje", "agora", "dia"],
  inputSchema: z.object({}),
  run: async () => ({ agora: new Date().toLocaleString("pt-BR") }),
};

registerTools([hora_atual]);
