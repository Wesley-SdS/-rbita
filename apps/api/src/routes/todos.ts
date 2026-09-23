import { z } from "zod";
import type { RouteHandler } from "../http/web";
import { sessionOf } from "../http/web-route";
import { criarTarefa, editarTarefa, listarTarefas, removerTarefa, tarefasDaOrigem } from "@orbita/core/tarefas/store";

// Migrada do Next em paridade (apps/web/src/app/api/todos/route.ts).
// Controller fino (§6): autentica, valida com zod e delega para o `store`.

/** Data ISO completa ou só o dia ("2026-10-05"), que é o que o <input type="date"> manda. */
const DATA = z.string().max(40).nullable().optional();
const IMAGEM = z.string().max(3_000_000).nullable().optional(); // data URL (imagem pequena)

const Create = z.object({
  text: z.string().min(1).max(500),
  dueDate: DATA,
  imageUrl: IMAGEM,
  notes: z.string().max(5000).nullable().optional(),
  paraQuem: z.string().max(200).nullable().optional(),
  origem: z
    .object({
      tipo: z.enum(["reuniao", "documento", "chat"]),
      id: z.uuid().nullable().optional(),
      titulo: z.string().max(300).nullable().optional(),
      trecho: z.string().max(2000).nullable().optional(),
    })
    .nullable()
    .optional(),
});

/**
 * Todo campo é opcional e a diferença entre AUSENTE e NULO importa: ausente é
 * "não mexa", nulo é "limpe". Sem isso, concluir uma tarefa apagaria o
 * vencimento dela (ver `camposDaEdicao`).
 */
const Update = z.object({
  id: z.uuid(),
  done: z.boolean().optional(),
  text: z.string().min(1).max(500).optional(),
  dueDate: DATA,
  imageUrl: IMAGEM,
  notes: z.string().max(5000).nullable().optional(),
  paraQuem: z.string().max(200).nullable().optional(),
});

export const GET: RouteHandler = async (req, ctx) => {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  // `?origem=<id da reunião>`: o caminho de volta. A tela da reunião pergunta
  // "o que ficou para mim daqui?" sem ter de baixar a lista inteira e filtrar
  // no cliente, que é regra de negócio no lugar errado (§6).
  const origem = new URL(req.url).searchParams.get("origem");
  const rows = origem ? await tarefasDaOrigem(session.user.id, origem) : await listarTarefas(session.user.id);
  return Response.json({ todos: rows.map((t) => ({ ...t, dueDate: t.dueDate?.toISOString() ?? null })) });
};

export const POST: RouteHandler = async (req, ctx) => {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const d = parsed.data;
  const row = await criarTarefa(session.user.id, {
    texto: d.text,
    vencimento: d.dueDate,
    imagemUrl: d.imageUrl,
    anotacoes: d.notes,
    paraQuem: d.paraQuem,
    origem: d.origem,
  });
  return Response.json({ id: row?.id });
};

export const PATCH: RouteHandler = async (req, ctx) => {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Update.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { id, done, text, dueDate, imageUrl, notes, paraQuem } = parsed.data;
  const row = await editarTarefa(session.user.id, id, {
    concluida: done,
    texto: text,
    vencimento: dueDate,
    imagemUrl: imageUrl,
    anotacoes: notes,
    paraQuem,
  });
  // 404 e não 200: editar o id de outra pessoa tem de falhar de forma visível
  if (!row) return Response.json({ error: "Tarefa não encontrada" }, { status: 404 });
  return Response.json({ ok: true, todo: { ...row, dueDate: row.dueDate?.toISOString() ?? null } });
};

export const DELETE: RouteHandler = async (req, ctx) => {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id obrigatório" }, { status: 400 });
  const apagou = await removerTarefa(session.user.id, id);
  if (!apagou) return Response.json({ error: "Tarefa não encontrada" }, { status: 404 });
  return Response.json({ ok: true });
};
