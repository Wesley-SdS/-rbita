import { z } from "zod";
import { settings } from "@orbita/core/settings/index";
import { rateLimit, tooMany } from "@orbita/core/ratelimit";
import { log } from "@orbita/core/observability/logger";
import { ASSINATURA_HEADER, assinaturaValida } from "@orbita/core/whatsapp/gowa/assinatura";
import { PonteError } from "@orbita/core/whatsapp/gowa/client";
import { receberEvento } from "@orbita/core/whatsapp/processar";
import { desconectarSessao, parear, sessaoDe, sessaoDoDispositivo } from "@orbita/core/whatsapp/sessao";
import { provedorAtivo } from "@orbita/core/whatsapp/enviar";
import { atualizarContato, automaticasRecentes, listarContatos } from "@orbita/core/whatsapp/store";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { ownerOf } from "../http/owner-route";

/**
 * WhatsApp pessoal (PRD-WHATSAPP). O webhook é chamado pelo GOWA, NÃO por um
 * navegador: a autenticação é o HMAC da sessão sobre os bytes do corpo, não a
 * sessão do Better Auth. O resto é tela do dono.
 */

const ponteErro = (e: unknown) => {
  if (e instanceof PonteError) return Response.json({ error: e.message, motivo: e.motivo }, { status: e.motivo === "nao_local" ? 400 : 502 });
  throw e;
};

/** POST /api/whatsapp/webhook/:deviceId — grava e responde; quem processa é a fila em processo. */
export async function WEBHOOK(req: Request, ctx: RouteCtx) {
  const deviceId = z.string().min(8).max(100).safeParse(ctx.params.deviceId);
  if (!deviceId.success) return Response.json({ error: "Dispositivo inválido" }, { status: 400 });

  const rl = rateLimit(`whatsapp.webhook:${deviceId.data}`, await settings.get("whatsapp.webhookPorMinuto"), 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const cru = new Uint8Array(await req.arrayBuffer());
  if (cru.length > 10 * 1024 * 1024) return Response.json({ error: "Corpo grande demais" }, { status: 413 });
  const sessao = await sessaoDoDispositivo(deviceId.data);
  // dispositivo desconhecido e assinatura errada respondem igual: quem sonda
  // não descobre quais ids existem
  if (!sessao || !assinaturaValida(cru, req.headers.get(ASSINATURA_HEADER), sessao.segredo)) {
    log.warn("whatsapp.webhook_recusado", { conhecido: Boolean(sessao) });
    return Response.json({ error: "Assinatura inválida" }, { status: 401 });
  }
  let corpo: unknown;
  try {
    corpo = JSON.parse(new TextDecoder().decode(cru));
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const r = await receberEvento(deviceId.data, corpo);
  // evento que não reconhecemos ainda é 200: devolver erro faria o GOWA
  // reenviar para sempre algo que nunca vai passar
  if (!r.ok && r.status === 400) {
    log.info("whatsapp.webhook_evento_ignorado", {});
    return Response.json({ ok: true, ignorado: true });
  }
  return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.erro }, { status: r.status });
}

/** GET /api/whatsapp/sessao — o estado do número pessoal e qual provedor está valendo. */
export async function GET_SESSAO(_req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const [sessao, provedor, config] = await Promise.all([sessaoDe(s.user.id), provedorAtivo(s.user.id).catch(() => null), settings.get("whatsapp.provedor")]);
  return Response.json({
    status: sessao?.status ?? "sem_sessao",
    numero: sessao?.jid ? sessao.jid.split("@")[0] : null,
    pareadoEm: sessao?.pareadoEm ?? null,
    reconexoes: sessao?.reconexoes ?? 0,
    provedorAtivo: provedor,
    provedorEscolhido: config,
  });
}

const Parear = z.discriminatedUnion("modo", [
  z.object({ modo: z.literal("qr") }),
  z.object({ modo: z.literal("codigo"), telefone: z.string().regex(/^\+?[\d\s()-]{10,20}$/, "Telefone com DDI e DDD, só números") }),
]);

/** POST /api/whatsapp/parear — QR ou código de 8 dígitos. Só o dono. */
export async function POST_PAREAR(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const parsed = Parear.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    const p = await parear(dono.userId, parsed.data.modo, parsed.data.modo === "codigo" ? parsed.data.telefone : undefined);
    return Response.json({ qr: p.qr, codigo: p.codigo, expiraEm: p.expiraEm });
  } catch (e) {
    return ponteErro(e);
  }
}

/** POST /api/whatsapp/desconectar — sai do WhatsApp na ponte. As mensagens guardadas ficam. */
export async function POST_DESCONECTAR(_req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  await desconectarSessao(dono.userId);
  return Response.json({ ok: true });
}

/** GET /api/whatsapp/contatos — conversas conhecidas, com o modo de cada uma. */
export async function GET_CONTATOS(_req: Request, ctx: RouteCtx) {
  const s = sessionOf(ctx);
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const [contatos, automaticas] = await Promise.all([listarContatos(s.user.id, 300), automaticasRecentes(s.user.id, 30)]);
  return Response.json({
    contatos: contatos.map((c) => ({ id: c.id, jid: c.jid, nome: c.nome, apelido: c.apelido, grupo: c.grupo, modo: c.modo, pausadoAte: c.pausadoAte, ultimaMensagemEm: c.ultimaMensagemEm })),
    automaticas: automaticas.map((m) => ({ id: m.id, chatJid: m.chatJid, texto: m.texto, em: m.em })),
  });
}

const PatchContato = z.object({
  apelido: z.string().trim().max(80).nullable().optional(),
  modo: z.enum(["aprovar", "automatico"]).optional(),
  /** voltar a responder agora, sem esperar a pausa acabar */
  retomar: z.boolean().optional(),
});

/** PATCH /api/whatsapp/contatos/:id — apelido e resposta automática. Só o dono. */
export async function PATCH_CONTATO(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const id = z.string().uuid().safeParse(ctx.params.id);
  if (!id.success) return Response.json({ error: "id inválido" }, { status: 400 });
  const parsed = PatchContato.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const atual = (await listarContatos(dono.userId, 5000)).find((c) => c.id === id.data);
  if (!atual) return Response.json({ error: "Contato não encontrado" }, { status: 404 });
  // grupo nunca tem resposta automática (a trava também existe no motor)
  if (parsed.data.modo === "automatico" && atual.grupo) return Response.json({ error: "Grupo não pode ter resposta automática." }, { status: 400 });
  const c = await atualizarContato(dono.userId, id.data, {
    ...(parsed.data.apelido !== undefined ? { apelido: parsed.data.apelido || null } : {}),
    ...(parsed.data.modo ? { modo: parsed.data.modo } : {}),
    ...(parsed.data.retomar ? { pausadoAte: null } : {}),
  });
  return Response.json({ ok: true, contato: c });
}
