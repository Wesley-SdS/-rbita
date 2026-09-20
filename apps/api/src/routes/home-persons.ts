import { z } from "zod";
import { createPerson, listPeople, PersonInputSchema, PersonPatchSchema, updatePerson } from "@orbita/core/identity/people";
import { removePerson } from "@orbita/core/identity/erase";
import type { RouteCtx } from "../http/web";
import { leituraCacheavel } from "../http/cacheable";
import { domainError, ownerOf } from "../http/owner-route";

/**
 * Pessoas da casa (B7.1, Onda 8). NÃO é multi-tenant: toda pessoa pertence à
 * casa do dono. A lógica mora em packages/core/src/identity; aqui só a borda.
 */
export async function GET(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  return leituraCacheavel(req, { people: await listPeople(o.userId) });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const parsed = PersonInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    return Response.json(await createPerson(o.userId, parsed.data));
  } catch (e) {
    return domainError(e);
  }
}

const PatchBody = PersonPatchSchema.extend({ id: z.string().uuid() });

export async function PATCH(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { id, ...patch } = parsed.data;
  try {
    await updatePerson(o.userId, id, patch);
    return Response.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}

/** Remover a pessoa apaga tudo dela: biometria, menções no event_log, consentimentos, acessos (PRD §4.5). */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "id inválido" }, { status: 400 });
  try {
    await removePerson(o.userId, id.data);
    return Response.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
