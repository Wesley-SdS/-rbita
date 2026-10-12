import { and, eq, inArray } from "drizzle-orm";
import { db } from "@orbita/db";
import { actionQueue } from "@orbita/db/action-schema";
import { controleSessao } from "@orbita/db/controle-schema";
import { job } from "@orbita/db/job-schema";
import { cancelJob } from "../jobs/queue";
import { events } from "../events/index";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { listRegisteredTools } from "../tools/registry";
import { ehToolSensivel } from "./dominios";
import { espelhar, type ResultadoDoEspelho } from "./espelho";
import { EVENTO, sessaoAtual, terminarSessao } from "./sessao";

/**
 * PARAR (PRD F6): de qualquer lugar, tudo, na hora.
 *
 * O aviso às mãos sai PRIMEIRO e em paralelo com o banco: são elas que matam
 * o processo do terminal e soltam o `chrome.debugger`, e esperar o banco para
 * isso seria gastar o tempo que o dono não tem. Depois, toda sessão ativa ou
 * pausada vira `parada` (não volta), e as propostas do controle ainda na fila
 * são canceladas: um "Enviar" pendente não pode ser aprovado depois do "para".
 *
 * Quem chama: o botão (tela e cartão, `POST /api/controle/parar`), a frase do
 * dono pela voz e pelo WhatsApp "Eu" (`pararPorFrase`, decidida pelo CÓDIGO,
 * nunca por tool) e as próprias mãos depois do atalho global ou do mouse real.
 */

export interface ResultadoDoParar {
  sessoes: number;
  propostas: number;
  /** trabalhos do PC em segundo plano (comando de terminal, tarefa delegada) com a parada pedida */
  trabalhos: number;
  maos: ResultadoDoEspelho[];
}

/**
 * O que roda no PC em SEGUNDO PLANO, fora de uma sessão: o comando de terminal
 * que passou do tempo de espera vira `terminal.comando`, e as tarefas
 * delegadas viram trabalho. As mãos matam o processo pelo "parar"; o trabalho
 * que acompanhava precisa do pedido de parada para não ficar esperando.
 */
const TRABALHOS_DO_PC = ["terminal.comando", "computador.tarefa", "navegador.tarefa"];

async function trabalhosDoPcVivos(userId: string): Promise<{ id: string }[]> {
  return db
    .select({ id: job.id })
    .from(job)
    .where(and(eq(job.userId, userId), inArray(job.kind, TRABALHOS_DO_PC), inArray(job.status, ["pendente", "rodando"])));
}

export async function pararTudo(userId: string, origem: string): Promise<ResultadoDoParar> {
  const prazo = await settings.get("controle.espelhoTimeoutMs").catch(() => 1500);
  const aviso = espelhar({ tipo: "parar", userId, origem }, prazo);

  const abertas = await db
    .select({ id: controleSessao.id })
    .from(controleSessao)
    .where(and(eq(controleSessao.userId, userId), inArray(controleSessao.status, ["ativa", "pausada"])));
  let sessoes = 0;
  for (const s of abertas) if (await terminarSessao(userId, s.id, "parada", `parada pelo dono (${origem})`)) sessoes++;

  let trabalhos = 0;
  for (const t of await trabalhosDoPcVivos(userId).catch(() => [])) if (await cancelJob(userId, t.id).catch(() => null)) trabalhos++;

  const kinds = listRegisteredTools().filter(ehToolSensivel).map((d) => d.name);
  const canceladas = kinds.length
    ? await db
        .update(actionQueue)
        .set({ status: "cancelled", result: "cancelada: o dono mandou parar" })
        .where(and(eq(actionQueue.userId, userId), eq(actionQueue.status, "pending"), inArray(actionQueue.kind, kinds)))
        .returning({ id: actionQueue.id })
    : [];

  const maos = await aviso;
  log.info("controle.parado", { userId, origem, sessoes, trabalhos, propostas: canceladas.length, maos: maos.map((m) => `${m.nome}:${m.ok ? "ok" : "falhou"}`) });
  await events.emit(EVENTO.parado, { origem, sessoes, propostas: canceladas.length }, { userId });
  return { sessoes, propostas: canceladas.length, trabalhos, maos };
}

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A fala INTEIRA é um pedido de parar? "Para!", "Órbita, para", "para, para"
 * sim; "manda para o João" e "para onde vai?" não. A palavra sozinha é uma
 * preposição em português, então só vale a frase completa da lista. Puro.
 */
export function ehFraseDeParar(fala: string, frases: readonly string[]): boolean {
  let f = normalizar(fala.slice(0, 120));
  f = f.replace(/^(ei |e )?orbita /, "").replace(/ orbita$/, "");
  // "para para para" é o mesmo pedido, dito com pressa
  f = f.split(" ").filter((w, i, a) => i === 0 || w !== a[i - 1]).join(" ");
  if (!f) return false;
  return frases.some((x) => normalizar(x) === f);
}

export interface RespostaDoParar {
  estado: "parado";
  texto: string;
}

/**
 * Para pela fala do DONO, só quando há sessão aberta OU algo do PC rodando em
 * segundo plano (um `pnpm build` avulso que passou do tempo de espera: antes,
 * sem sessão, o "para" ia para o modelo e o comando seguia, M15 da auditoria).
 * Sem nenhum dos dois, "para" é conversa e segue para o modelo. Quem chama
 * garante que o texto é fala do dono, como no "manda" (`actions/por-frase.ts`).
 */
export async function pararPorFrase(userId: string, canal: string, fala: string): Promise<RespostaDoParar | null> {
  const frases = await settings.get("controle.frasesParar").catch(() => [] as string[]);
  if (!ehFraseDeParar(fala, frases)) return null;
  const aberta = await sessaoAtual(userId, true);
  if (!aberta && !(await trabalhosDoPcVivos(userId).catch(() => [])).length) return null;
  const r = await pararTudo(userId, canal);
  const falhas = r.maos.filter((m) => !m.ok).map((m) => m.nome);
  const extra = r.propostas ? ` Cancelei ${r.propostas === 1 ? "a proposta que esperava" : `as ${r.propostas} propostas que esperavam`} aprovação.` : "";
  const aviso = falhas.length ? ` Não consegui confirmar com ${falhas.join(" e ")}: confira a tela.` : "";
  const rodando = r.trabalhos ? ` Parei também o que estava rodando no computador em segundo plano.` : "";
  return { estado: "parado", texto: `Parei. A Órbita não mexe mais no computador até você abrir outra sessão.${rodando}${extra}${aviso}` };
}
