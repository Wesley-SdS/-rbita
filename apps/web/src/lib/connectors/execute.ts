import { getAccessToken } from "./store";
import { sendEmail, createEvent } from "./google";
import { postMessage } from "./slack";
import { sendWhatsApp } from "./whatsapp";

/**
 * Executa uma ação da fila (após aprovação humana). Recebe o kind + payload
 * enfileirados pela tool e chama a API real do conector. Só é invocado pelo
 * endpoint /api/actions (confirmação do usuário), nunca pelo LLM.
 */
export async function executeAction(userId: string, kind: string, payload: Record<string, unknown>): Promise<string> {
  switch (kind) {
    case "enviar_email": {
      const token = await getAccessToken("google", userId);
      if (!token) throw new Error("Google não conectado");
      const r = await sendEmail(token, String(payload.para), String(payload.assunto), String(payload.corpo));
      return `E-mail enviado (id ${r.id}).`;
    }
    case "criar_evento": {
      const token = await getAccessToken("google", userId);
      if (!token) throw new Error("Google não conectado");
      const e = await createEvent(token, {
        summary: String(payload.titulo),
        startISO: String(payload.inicio),
        endISO: String(payload.fim),
        description: payload.descricao ? String(payload.descricao) : undefined,
        location: payload.local ? String(payload.local) : undefined,
      });
      return `Evento criado: ${e.htmlLink}`;
    }
    case "enviar_slack": {
      const token = await getAccessToken("slack", userId);
      if (!token) throw new Error("Slack não conectado");
      const r = await postMessage(token, String(payload.canal), String(payload.texto));
      return `Mensagem postada no Slack (ts ${r.ts}).`;
    }
    case "enviar_whatsapp": {
      const r = await sendWhatsApp(String(payload.para), String(payload.texto));
      return `WhatsApp enviado (id ${r.id}).`;
    }
    default:
      throw new Error(`Ação desconhecida: ${kind}`);
  }
}
