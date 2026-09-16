import { z } from "zod";
import { sendWhatsApp, whatsappConfigured } from "../../connectors/whatsapp";
import { registerTools, type ToolDef } from "../registry";

/** Domínio: WhatsApp (token do app no .env; OAuth por usuário fica para a Onda 4). */
const Input = z.object({ para: z.string(), texto: z.string() });

export const enviar_whatsapp: ToolDef<typeof Input> = {
  name: "enviar_whatsapp",
  domain: "whatsapp",
  description: "Propõe enviar uma mensagem de WhatsApp (número internacional, ex: 5511999998888). Não envia direto: enfileira uma proposta para o usuário aprovar no painel 'Ações a confirmar'.",
  risk: "efeito_externo",
  keywords: ["whatsapp", "zap", "mensagem", "mandar", "avisar"],
  requires: { available: whatsappConfigured },
  inputSchema: Input,
  summarize: ({ para, texto }) => `Enviar WhatsApp para ${para}: "${texto.slice(0, 60)}"`,
  run: async ({ para, texto }) => {
    const r = await sendWhatsApp(para, texto);
    return `WhatsApp enviado (id ${r.id}).`;
  },
};

registerTools([enviar_whatsapp]);
