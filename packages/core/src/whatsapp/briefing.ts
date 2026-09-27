import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { waSessao } from "@orbita/db/whatsapp-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { notifyUser, runPromptForUser } from "../routines/run";
import { FLUXO } from "../usage/registrar";
import { agoraLocal, briefingDevido } from "./horario";
import { avisarNoWhatsapp } from "./avisar";
import { sessaoDe } from "./sessao";

/**
 * O briefing da manhã pelo WhatsApp (item 2 da proativa): agenda, contas da
 * semana, tarefas e quanto dá para gastar hoje, na conversa "Eu".
 *
 * Quem monta é a própria Órbita com as ferramentas de LEITURA (todas, sem a
 * seleção por relevância: sem um pedido do dono, a seleção pegaria as primeiras
 * na ordem de registro e o financeiro ficaria de fora). Leitura só: o briefing
 * roda sozinho, sem ninguém olhando, e não tem por que escrever nada.
 *
 * Um por dia: o dia do último envio fica em `wa_sessao.ultimo_briefing`, e é
 * gravado ANTES de mandar. Se o envio falhar, perde-se o briefing do dia;
 * gravar depois arriscaria mandar dois se o processo reiniciasse no meio.
 */
export async function briefingSeDevido(userId: string, agora = new Date()): Promise<"enviado" | "fora_de_hora" | "sem_whatsapp" | "falhou"> {
  const cfg = await settings.getMany(["whatsapp.briefingAtivo", "whatsapp.briefingHorario", "whatsapp.briefingDias", "whatsapp.briefingPedido", "connectors.fusoHorario"]);
  const sessao = await sessaoDe(userId);
  if (!sessao || sessao.status !== "conectado") return "sem_whatsapp";
  const local = agoraLocal(agora, cfg["connectors.fusoHorario"]);
  if (!briefingDevido(local, { ativo: cfg["whatsapp.briefingAtivo"], horario: cfg["whatsapp.briefingHorario"], dias: cfg["whatsapp.briefingDias"] }, sessao.ultimoBriefing)) return "fora_de_hora";

  await db.update(waSessao).set({ ultimoBriefing: local.dia }).where(eq(waSessao.id, sessao.id));
  try {
    const texto = await runPromptForUser(userId, cfg["whatsapp.briefingPedido"], "\nVocê está montando o briefing da manhã, que vai pelo WhatsApp. Responda só com o texto do briefing.", {
      fluxo: FLUXO.briefing,
      referencia: local.dia,
      soLeitura: true,
      todas: true,
    });
    const r = await avisarNoWhatsapp(userId, "Bom dia", texto, { tipo: "briefing" });
    if (r === "enviado") return "enviado";
    // montou mas não saiu pelo WhatsApp: o briefing do dia não se perde, fica no app
    await notifyUser(userId, "Bom dia", texto, null, { destino: "/app", whatsapp: false }).catch(() => undefined);
    return "falhou";
  } catch (e) {
    log.warn("whatsapp.briefing_falhou", { erro: e instanceof Error ? e.message : String(e) });
    // o dia já foi marcado (para não repetir); o dono sabe que hoje não teve
    await notifyUser(userId, "Briefing de hoje", "Não consegui montar o briefing desta manhã (nenhum modelo respondeu).", null, { destino: "/app", whatsapp: false }).catch(() => undefined);
    return "falhou";
  }
}
