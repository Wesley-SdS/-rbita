import { and, asc, eq, lt, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { conversation, message } from "@orbita/db/chat-schema";
import { document } from "@orbita/db/knowledge-schema";
import { ingestPaginas } from "../rag/ingest";
import { settings } from "../settings";
import { log } from "../observability/logger";

/**
 * A CONVERSA DE OUTRO DIA VIRA CONTEXTO DE HOJE.
 *
 * Isto não é memória. Memória é um fato curto que a Órbita carrega sempre
 * ("o Wesley não come glúten"). Isto é ACESSO AO QUE JÁ FOI DITO: você volta
 * semanas depois, diz "aquele papo sobre realtime", e a Órbita busca a
 * conversa inteira como busca qualquer documento.
 *
 * Por que arquivar em vez de só consultar a tabela `message`: a busca do chat
 * é semântica, e ela roda sobre `chunk`. Uma conversa que não foi recortada e
 * vetorizada é invisível para ela, por mais que esteja no banco. Em 22/09/2026
 * havia 110 conversas e 4 documentos: praticamente tudo que o dono já falou
 * com a Órbita era inalcançável.
 */

/** Uma mensagem, do jeito que interessa aqui. */
export interface MensagemArquivavel {
  role: string;
  content: string;
}

/**
 * Quantas mensagens uma conversa precisa ter para valer a pena arquivar.
 *
 * Um "oi" seguido de "olá" não é conhecimento, é ruído: arquivar tudo encheria
 * a busca de trechos vazios e pioraria as respostas. O valor é default de
 * engenharia e vem da config (§5.6).
 */
export const MINIMO_DE_MENSAGENS = 4;

const ROTULO: Record<string, string> = { user: "Wesley", assistant: "Órbita" };

/**
 * Transforma a conversa em páginas de texto.
 *
 * Uma página por PAR de fala (pergunta e resposta), não uma página por
 * mensagem: o corte do RAG respeita limites de página, e separar a pergunta da
 * resposta produziria trechos que respondem sem dizer a que. Mensagem de
 * sistema fica fora, porque é instrução nossa, não conversa.
 */
export function paginasDaConversa(mensagens: MensagemArquivavel[]): string[] {
  const uteis = mensagens.filter((m) => m.role !== "system" && m.content.trim());
  const paginas: string[] = [];
  let atual: string[] = [];

  for (const m of uteis) {
    // uma pergunta nova começa página nova, levando junto a resposta anterior
    if (m.role === "user" && atual.length) {
      paginas.push(atual.join("\n\n"));
      atual = [];
    }
    atual.push(`${ROTULO[m.role] ?? m.role}: ${m.content.trim()}`);
  }
  if (atual.length) paginas.push(atual.join("\n\n"));
  return paginas;
}

/** Vale a pena guardar esta conversa? */
export function valeArquivar(mensagens: MensagemArquivavel[], minimo = MINIMO_DE_MENSAGENS): boolean {
  const uteis = mensagens.filter((m) => m.role !== "system" && m.content.trim());
  if (uteis.length < minimo) return false;
  // conversa só de saudação passa no contador e não tem conteúdo nenhum
  const caracteres = uteis.reduce((soma, m) => soma + m.content.trim().length, 0);
  return caracteres >= 200;
}

/** O título do documento arquivado. O da conversa, quando tem; senão, a data. */
export function tituloDoArquivo(titulo: string | null, quando: Date): string {
  const limpo = titulo?.trim();
  if (limpo && limpo !== "Nova conversa") return `Conversa: ${limpo}`;
  return `Conversa de ${quando.toLocaleDateString("pt-BR")}`;
}

export interface ResultadoDoArquivamento {
  documentId: string | null;
  trechos: number;
  motivo?: "curta" | "ja_arquivada" | "sem_mensagens";
}

/**
 * Arquiva UMA conversa na base de conhecimento.
 *
 * Reindexar uma conversa que cresceu apaga o documento antigo antes: deixar os
 * dois faria a busca devolver a mesma fala duas vezes, e a resposta citaria a
 * si mesma como se fossem duas fontes.
 */
export async function arquivarConversa(userId: string, conversationId: string, opcoes: { refazer?: boolean } = {}): Promise<ResultadoDoArquivamento> {
  const [conv] = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.id, conversationId), eq(conversation.userId, userId)))
    .limit(1);
  if (!conv) return { documentId: null, trechos: 0, motivo: "sem_mensagens" };

  const [jaTem] = await db
    .select({ id: document.id })
    .from(document)
    .where(and(eq(document.userId, userId), eq(document.origemId, conversationId)))
    .limit(1);
  if (jaTem && !opcoes.refazer) return { documentId: jaTem.id, trechos: 0, motivo: "ja_arquivada" };

  const mensagens = await db
    .select({ role: message.role, content: message.content })
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(asc(message.createdAt), asc(message.id));

  const minimo = await settings.get("graph.minimoDeMensagens");
  if (!valeArquivar(mensagens, minimo)) return { documentId: null, trechos: 0, motivo: "curta" };

  // o antigo sai ANTES do novo entrar: os trechos têm cascade a partir do
  // documento, então some tudo junto
  if (jaTem) await db.delete(document).where(eq(document.id, jaTem.id));

  const titulo = tituloDoArquivo(conv.title, conv.createdAt);
  const r = await ingestPaginas(userId, titulo, paginasDaConversa(mensagens), {
    source: "conversa",
    origem: { tipo: "conversa", id: conversationId, titulo: conv.title },
  });
  log.info("conhecimento.conversa_arquivada", { userId, conversationId, trechos: r.chunks });
  return { documentId: r.documentId, trechos: r.chunks };
}

/**
 * As conversas que ainda não viraram base.
 *
 * Só as que já pararam: arquivar uma conversa em andamento significaria
 * reindexar a cada mensagem nova, e o custo de embedding não justifica. O
 * corte por inatividade vem da config.
 */
export async function conversasPendentes(userId: string, paradaHaMinutos: number, limite = 20): Promise<string[]> {
  const corte = new Date(Date.now() - paradaHaMinutos * 60_000);
  const rows = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(
      and(
        eq(conversation.userId, userId),
        // `lt()` e não sql`... < ${corte}`: dentro do template a Date ia crua
        // para o driver e chegava no Postgres como "Wed Sep 23 2026 ... GMT-0300
        // (Horário Padrão de Brasília)", que ele não sabe ler. O laço do
        // processo vivo falhava a cada volta, e nenhuma conversa era arquivada.
        lt(conversation.updatedAt, corte),
        sql`not exists (select 1 from ${document} d where d.user_id = ${userId} and d.origem_id = ${conversation.id})`,
      ),
    )
    .orderBy(asc(conversation.updatedAt))
    .limit(limite);
  return rows.map((r) => r.id);
}

/**
 * A passada que o processo vivo dá: arquiva o que parou de ser conversado.
 *
 * Roda no `apps/api`, não no navegador. Um lote por vez, com teto: uma base
 * com centenas de conversas antigas não pode virar centenas de chamadas de
 * embedding numa tacada, que é o tipo de coisa que aparece na conta no fim do
 * mês sem ninguém ter pedido.
 */
export async function arquivarConversasParadas(userId: string): Promise<{ arquivadas: number; puladas: number }> {
  const cfg = await settings.getMany(["graph.arquivarConversas", "graph.conversaParadaMinutos"]);
  if (!cfg["graph.arquivarConversas"]) return { arquivadas: 0, puladas: 0 };

  const ids = await conversasPendentes(userId, cfg["graph.conversaParadaMinutos"]);
  let arquivadas = 0;
  let puladas = 0;
  for (const id of ids) {
    try {
      const r = await arquivarConversa(userId, id);
      if (r.documentId && r.trechos > 0) arquivadas++;
      else puladas++;
    } catch (e) {
      // uma conversa que falha (embedding fora do ar) não pode travar o resto
      puladas++;
      log.warn("conhecimento.arquivar_falhou", { userId, conversationId: id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (arquivadas || puladas) log.info("conhecimento.passada", { userId, arquivadas, puladas });
  return { arquivadas, puladas };
}

/**
 * A passada do processo vivo, para a casa inteira.
 *
 * Procura os donos que TÊM conversa pendente em vez de varrer todos os
 * usuários: numa base com 14 contas de teste, a maioria nunca conversou, e
 * perguntar por elas a cada volta do laço é trabalho por nada.
 */
export async function arquivarConversasDeTodos(): Promise<{ usuarios: number; arquivadas: number }> {
  const cfg = await settings.getMany(["graph.arquivarConversas", "graph.conversaParadaMinutos"]);
  if (!cfg["graph.arquivarConversas"]) return { usuarios: 0, arquivadas: 0 };

  const corte = new Date(Date.now() - cfg["graph.conversaParadaMinutos"] * 60_000);
  const donos = await db
    .selectDistinct({ userId: conversation.userId })
    .from(conversation)
    .where(
      and(
        lt(conversation.updatedAt, corte),
        sql`not exists (select 1 from ${document} d where d.user_id = ${conversation.userId} and d.origem_id = ${conversation.id})`,
      ),
    );

  let arquivadas = 0;
  for (const d of donos) {
    const r = await arquivarConversasParadas(d.userId);
    arquivadas += r.arquivadas;
  }
  return { usuarios: donos.length, arquivadas };
}
