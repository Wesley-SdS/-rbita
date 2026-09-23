import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@orbita/db";
import { conversation } from "@orbita/db/chat-schema";
import { document, memory } from "@orbita/db/knowledge-schema";
import { todo } from "@orbita/db/todo-schema";
import { person } from "@orbita/db/home-schema";
import { settings } from "../settings";
import { ligarLocutores, montarGrafo, type Grafo, type LinhaDeAresta, type LinhaDeNo } from "./grafo";

/**
 * De onde saem os nós e as ligações do mapa.
 *
 * Tudo aqui vem de coluna que JÁ EXISTE. Não há tabela de ligação: o vínculo é
 * o `origem_id` da tarefa e do documento, que são os mesmos campos que a tela
 * de tarefas e a de conhecimento já usam. Grafo derivado não sai do ar em
 * relação ao resto: apagou a tarefa, sumiu do mapa, sem passo de manutenção.
 *
 * Cada consulta filtra por `userId` (§6), inclusive a de similaridade.
 */

/** Um documento de reunião é um nó de tipo próprio: no mapa ele é um lugar, não um arquivo. */
function tipoDoDocumento(source: string): "reuniao" | "conversa" | "documento" {
  if (source === "meeting" || source === "reuniao") return "reuniao";
  if (source === "conversa") return "conversa";
  return "documento";
}

export interface OpcoesDoGrafo {
  /** incluir as arestas fracas de similaridade entre memórias */
  comParecidos?: boolean;
  /** só estes tipos de nó */
  tipos?: string[];
}

export async function montarGrafoDoUsuario(userId: string, opcoes: OpcoesDoGrafo = {}): Promise<Grafo> {
  const cfg = await settings.getMany(["graph.nodeLimit", "graph.edgeMinSim", "graph.edgeLimit"]);
  const teto = cfg["graph.nodeLimit"];
  const quer = (t: string) => !opcoes.tipos?.length || opcoes.tipos.includes(t);

  const linhas: LinhaDeNo[] = [];
  const ligacoes: LinhaDeAresta[] = [];

  // --- documentos, reuniões e conversas arquivadas ------------------------
  // o teto por consulta existe para uma base grande não virar uma consulta que
  // traz tudo para a memória antes de o `montarGrafo` cortar
  const docs = await db
    .select({
      id: document.id,
      title: document.title,
      source: document.source,
      origemId: document.origemId,
      createdAt: document.createdAt,
      speakers: document.speakers,
    })
    .from(document)
    .where(eq(document.userId, userId))
    .orderBy(desc(document.createdAt))
    .limit(teto);

  for (const d of docs) {
    const tipo = tipoDoDocumento(d.source);
    if (!quer(tipo)) continue;
    linhas.push({ id: d.id, tipo, rotulo: d.title, quando: d.createdAt, origemId: d.origemId });
  }

  // --- pessoas: quem falou nas reuniões ------------------------------------
  if (quer("pessoa")) {
    const pessoas = await db
      .select({ id: person.id, name: person.name, aliases: person.aliases, createdAt: person.createdAt })
      .from(person)
      .where(eq(person.userId, userId))
      .limit(teto);
    for (const p of pessoas) linhas.push({ id: p.id, tipo: "pessoa", rotulo: p.name, quando: p.createdAt });
    // a ligação vem dos locutores NOMEADOS do documento de reunião
    ligacoes.push(...ligarLocutores(pessoas.map((p) => ({ id: p.id, nome: p.name, apelidos: p.aliases })), docs));
  }

  // --- conversas ----------------------------------------------------------
  if (quer("conversa")) {
    const convs = await db
      .select({ id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt })
      .from(conversation)
      .where(eq(conversation.userId, userId))
      .orderBy(desc(conversation.updatedAt))
      .limit(teto);
    for (const c of convs) linhas.push({ id: c.id, tipo: "conversa", rotulo: c.title, quando: c.updatedAt });
  }

  // --- tarefas ------------------------------------------------------------
  if (quer("tarefa")) {
    const tarefas = await db
      .select({ id: todo.id, text: todo.text, origemId: todo.origemId, createdAt: todo.createdAt })
      .from(todo)
      .where(eq(todo.userId, userId))
      .orderBy(desc(todo.createdAt))
      .limit(teto);
    for (const t of tarefas) linhas.push({ id: t.id, tipo: "tarefa", rotulo: t.text, quando: t.createdAt, origemId: t.origemId });
  }

  // --- memórias -----------------------------------------------------------
  if (quer("memoria")) {
    const mems = await db
      .select({ id: memory.id, content: memory.content, createdAt: memory.createdAt })
      .from(memory)
      .where(eq(memory.userId, userId))
      .orderBy(desc(memory.createdAt))
      .limit(teto);
    for (const m of mems) linhas.push({ id: m.id, tipo: "memoria", rotulo: m.content, quando: m.createdAt });

    // --- parecidos: a aresta fraca, opcional -------------------------------
    // fica DESLIGADA por padrão. Com ela sempre ligada, todo mundo se liga com
    // todo mundo e o mapa deixa de mostrar de onde as coisas vieram, que é o
    // ponto dele.
    if (opcoes.comParecidos && mems.length > 1) {
      const raw = await db.execute(sql`
        WITH n AS (
          SELECT id, embedding FROM memory WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT ${teto}
        )
        SELECT a.id AS origem, b.id AS destino, round((1 - (a.embedding <=> b.embedding))::numeric, 3) AS forca
        FROM n a JOIN n b ON a.id < b.id
        WHERE (1 - (a.embedding <=> b.embedding)) > ${cfg["graph.edgeMinSim"]}
        ORDER BY forca DESC LIMIT ${cfg["graph.edgeLimit"]}
      `);
      for (const e of raw as unknown as { origem: string; destino: string; forca: string }[]) {
        ligacoes.push({ origem: e.origem, destino: e.destino, tipo: "parecido", forca: Number(e.forca) });
      }
    }
  }

  return montarGrafo(linhas, ligacoes, { teto });
}

/**
 * Apaga um nó da base.
 *
 * O dono pediu para conseguir tirar o que não faz sentido, e isso só vale se
 * apagar aqui apagar de verdade: o documento leva os trechos junto (cascade),
 * e some da busca do chat no mesmo instante. A conversa NÃO é apagada por
 * aqui, só o que foi arquivado dela: perder o histórico da conversa por querer
 * tirar um resumo da base seria uma surpresa ruim.
 */
export async function apagarDoConhecimento(userId: string, tipo: string, id: string): Promise<boolean> {
  if (tipo === "documento" || tipo === "reuniao" || tipo === "conversa") {
    const r = await db
      .delete(document)
      .where(and(eq(document.id, id), eq(document.userId, userId)))
      .returning({ id: document.id });
    return r.length > 0;
  }
  if (tipo === "memoria") {
    const r = await db
      .delete(memory)
      .where(and(eq(memory.id, id), eq(memory.userId, userId)))
      .returning({ id: memory.id });
    return r.length > 0;
  }
  // tarefa tem tela própria, com desfazer; apagar pelo mapa seria um caminho
  // paralelo sem as mesmas defesas
  return false;
}
