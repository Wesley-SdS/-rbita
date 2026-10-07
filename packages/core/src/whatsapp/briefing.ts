import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { waSessao } from "@orbita/db/whatsapp-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { notifyUser, runPromptForUser } from "../routines/run";
import { applyLlmSettings } from "../settings/apply";
import { discoverModels } from "@orbita/llm";
import { FLUXO } from "../usage/registrar";
import { agoraLocal, briefingDevido } from "./horario";
import { avisarNoWhatsapp } from "./avisar";
import { sessaoDe } from "./sessao";
import { contextoDoBomDia, trabalhoDoDia } from "./bom-dia";
import { enviarAudio } from "./enviar";
import { normalizarJid } from "./traduzir";

/**
 * O bom dia como NOTA DE VOZ na conversa "Eu". Falhou (sem conversão, ponte
 * fora, TTS fora do ar)? Devolve false e quem chama manda em texto: o dono
 * nunca fica sem o bom dia por causa do áudio.
 */
async function bomDiaEmAudio(userId: string, texto: string): Promise<boolean> {
  try {
    const sessao = await sessaoDe(userId);
    if (!sessao?.jid) return false;
    await enviarAudio(userId, normalizarJid(sessao.jid), texto, { aprovacaoHumana: true });
    return true;
  } catch (e) {
    log.warn("whatsapp.bom_dia_audio_falhou", { erro: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

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
export type ResultadoDoBriefing = "enviado" | "fora_de_hora" | "sem_canal" | "sem_modelo" | "falhou";

/**
 * O briefing vai para cada canal onde está DEVIDO: a conversa "Eu" do WhatsApp
 * e o Telegram da Órbita (se `telegram.briefing`). Montado UMA vez (uma chamada
 * de modelo), com o dia gravado em cada canal ANTES de mandar.
 */
export async function briefingSeDevido(userId: string, agora = new Date()): Promise<ResultadoDoBriefing> {
  const cfg = await settings.getMany(["whatsapp.briefingAtivo", "whatsapp.briefingHorario", "whatsapp.briefingDias", "whatsapp.briefingPedido", "whatsapp.briefingAudio", "casa.trabalhoPorDia", "telegram.briefing", "connectors.fusoHorario"]);
  const local = agoraLocal(agora, cfg["connectors.fusoHorario"]);
  const regra = { ativo: cfg["whatsapp.briefingAtivo"], horario: cfg["whatsapp.briefingHorario"], dias: cfg["whatsapp.briefingDias"] };

  const sessao = await sessaoDe(userId);
  const temWhatsapp = Boolean(sessao && sessao.status === "conectado");
  const tg = cfg["telegram.briefing"] ? await import("../telegram/store") : null;
  const [bot, donoTg] = tg ? await Promise.all([tg.botDe(userId), tg.donoNoTelegram(userId)]) : [null, null];
  const temTelegram = Boolean(bot && donoTg);
  if (!temWhatsapp && !temTelegram) return "sem_canal";

  const peloWhatsapp = temWhatsapp && briefingDevido(local, regra, sessao!.ultimoBriefing);
  const peloTelegram = temTelegram && briefingDevido(local, regra, bot!.ultimoBriefing);
  if (!peloWhatsapp && !peloTelegram) return "fora_de_hora";

  // Sem modelo descoberto ainda (o api acabou de subir e a lista esfria no
  // boot), NÃO marca o dia: tenta de novo no minuto seguinte. Antes o briefing
  // rodava 3 s depois de subir, falhava com "nenhum modelo" e o dia ficava
  // marcado como feito: o dono ficou sem briefing (28/09/2026).
  await applyLlmSettings().catch(() => undefined);
  if (!(await discoverModels().catch(() => [])).length) return "sem_modelo";

  if (peloWhatsapp) await db.update(waSessao).set({ ultimoBriefing: local.dia }).where(eq(waSessao.id, sessao!.id));
  if (peloTelegram) await tg!.marcarBriefing(userId, local.dia);
  try {
    // o dia e o trabalho do dia vêm do CÓDIGO (`bom-dia.ts`): o modelo deduzindo o
    // dia da semana e cruzando com uma memória errava o lugar do trânsito
    const audio = peloWhatsapp && cfg["whatsapp.briefingAudio"];
    const contexto = contextoDoBomDia({ diaDaSemana: local.diaDaSemana, dia: local.dia, trabalho: trabalhoDoDia(cfg["casa.trabalhoPorDia"], local.diaDaSemana), temTrabalhoCadastrado: cfg["casa.trabalhoPorDia"].length > 0, audio });
    const texto = await runPromptForUser(userId, cfg["whatsapp.briefingPedido"], `\nVocê está montando o briefing da manhã, que vai por mensagem (WhatsApp ou Telegram). Responda só com o texto do briefing.${contexto}`, {
      fluxo: FLUXO.briefing,
      referencia: local.dia,
      soLeitura: true,
      todas: true,
    });
    let entregue = false;
    if (peloWhatsapp) entregue = (audio && (await bomDiaEmAudio(userId, texto))) || (await avisarNoWhatsapp(userId, "Bom dia", texto, { tipo: "briefing" })) === "enviado" || entregue;
    if (peloTelegram) entregue = (await import("../telegram/enviar").then((m) => m.avisarNoTelegram(userId, "Bom dia", texto, { tipo: "briefing" }))) === "enviado" || entregue;
    if (entregue) return "enviado";
    // montou mas nenhum canal levou: o briefing do dia não se perde, fica no app
    await notifyUser(userId, "Bom dia", texto, null, { destino: "/app", whatsapp: false }).catch(() => undefined);
    return "falhou";
  } catch (e) {
    log.warn("whatsapp.briefing_falhou", { erro: e instanceof Error ? e.message : String(e) });
    // o dia já foi marcado (para não repetir); o dono sabe que hoje não teve
    await notifyUser(userId, "Briefing de hoje", "Não consegui montar o briefing desta manhã (nenhum modelo respondeu).", null, { destino: "/app", whatsapp: false }).catch(() => undefined);
    return "falhou";
  }
}
