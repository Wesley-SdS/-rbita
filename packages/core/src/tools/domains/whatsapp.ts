import { z } from "zod";
import { sendWhatsApp } from "../../connectors/whatsapp";
import { registerTools, type ToolDef } from "../registry";

/** Domínio: WhatsApp (Cloud API da Meta, token cadastrado pela tela — CH.2). */
const Input = z.object({ para: z.string(), texto: z.string() });

export const enviar_whatsapp: ToolDef<typeof Input> = {
  name: "enviar_whatsapp",
  domain: "whatsapp",
  description: "Propõe enviar uma mensagem de WhatsApp (número internacional, ex: 5511999998888). Não envia direto: enfileira uma proposta para o usuário aprovar no painel 'Ações a confirmar'.",
  risk: "efeito_externo",
  keywords: ["whatsapp", "zap", "mensagem", "mandar", "avisar"],
  requires: { whatsapp: true },
  inputSchema: Input,
  summarize: ({ para, texto }) => `Enviar WhatsApp para ${para}: "${texto.slice(0, 60)}"`,
  run: async ({ para, texto }, { userId }) => {
    const r = await sendWhatsApp(userId, para, texto);
    return `WhatsApp enviado (id ${r.id}).`;
  },
};

registerTools([enviar_whatsapp]);
