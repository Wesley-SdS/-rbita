import { z } from "zod";
import { settings } from "@orbita/core/settings/index";
import { instanteLocal, paraHoraLocal } from "@orbita/core/fuso";
import type { RouteHandler } from "../http/web";
import { sessionOf } from "../http/web-route";
import { criarTarefa, editarTarefa, listarTarefas, removerTarefa, tarefasDaOrigem } from "@orbita/core/tarefas/store";

// Migrada do Next em paridade (apps/web/src/app/api/todos/route.ts).
// Controller fino (§6): autentica, valida com zod e delega para o `store`.

/** Data ISO completa ou só o dia ("2026-10-05"), que é o que o <input type="date"> manda. */
const DATA = z.string().max(40).nullable().optional();
// formato ESTRITO: um valor que não dá para ler era aceito e virava "sem
// lembrete", apagando o que havia, com 200
const LEMBRETE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Lembrete no formato AAAA-MM-DDTHH:MM")
  .nullable()
  .optional();

/** Lembrete no passado é engano (o dono não quer ser lembrado de algo que já passou). */
async function lembreteInvalido(valor: string | null | undefined, fuso: string): Promise<Response | null> {
  if (!valor) return null;
  const quando = instanteLocal(valor, fuso);
  if (!quando) return Response.json({ error: "Não entendi a hora do lembrete." }, { status: 400 });
  if (quando.getTime() < Date.now() - 60_000) return Response.json({ error: "Esse horário já passou." }, { status: 400 });
  return null;
}

/** A tarefa como a tela recebe: o lembrete também no horário da CASA, pronto para o campo. */
function paraTela<T extends { dueDate: Date | null; lembrarEm?: Date | null }>(t: T, fuso: string) {
  return { ...t, dueDate: t.dueDate?.toISOString() ?? null, lembrarEmLocal: t.lembrarEm ? paraHoraLocal(t.lembrarEm, fuso) : null };
}
const IMAGEM = z.string().max(3_000_000).nullable().optional(); // data URL (imagem pequena)

const Create = z.object({
  text: z.string().min(1).max(500),
  dueDate: DATA,
  imageUrl: IMAGEM,
  notes: z.string().max(5000).nullable().optional(),
  paraQuem: z.string().max(200).nullable().optional(),
  /** "AAAA-MM-DDTHH:MM" no horário da casa: quando avisar (WhatsApp e push) */
  lembrarEm: LEMBRETE,
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
  /** "AAAA-MM-DDTHH:MM" no horário da casa: quando avisar (WhatsApp e push) */
  lembrarEm: LEMBRETE,
});

export const GET: RouteHandler = async (req, ctx) => {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  // `?origem=<id da reunião>`: o caminho de volta. A tela da reunião pergunta
  // "o que ficou para mim daqui?" sem ter de baixar a lista inteira e filtrar
  // no cliente, que é regra de negócio no lugar errado (§6).
  const origem = new URL(req.url).searchParams.get("origem");
  const rows = origem ? await tarefasDaOrigem(session.user.id, origem) : await listarTarefas(session.user.id);
  const fuso = await settings.get("connectors.fusoHorario");
  return Response.json({ todos: rows.map((t) => paraTela(t, fuso)) });
};

export const POST: RouteHandler = async (req, ctx) => {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const d = parsed.data;
  const fuso = await settings.get("connectors.fusoHorario");
  const invalido = await lembreteInvalido(d.lembrarEm, fuso);
  if (invalido) return invalido;
  const row = await criarTarefa(session.user.id, {
    texto: d.text,
    vencimento: d.dueDate,
    imagemUrl: d.imageUrl,
    anotacoes: d.notes,
    paraQuem: d.paraQuem,
    origem: d.origem,
    lembrarEm: d.lembrarEm,
    fuso,
  });
  return Response.json({ id: row?.id });
};

export const PATCH: RouteHandler = async (req, ctx) => {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const parsed = Update.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { id, done, text, dueDate, imageUrl, notes, paraQuem, lembrarEm } = parsed.data;
  const fuso = await settings.get("connectors.fusoHorario");
  const invalido = await lembreteInvalido(lembrarEm, fuso);
  if (invalido) return invalido;
  const row = await editarTarefa(session.user.id, id, {
    concluida: done,
    texto: text,
    vencimento: dueDate,
    imagemUrl: imageUrl,
    anotacoes: notes,
    paraQuem,
    lembrarEm,
    fuso,
  });
  // 404 e não 200: editar o id de outra pessoa tem de falhar de forma visível
  if (!row) return Response.json({ error: "Tarefa não encontrada" }, { status: 404 });
  return Response.json({ ok: true, todo: paraTela(row, fuso) });
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
