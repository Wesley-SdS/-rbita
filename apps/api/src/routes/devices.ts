import { z } from "zod";
import { DeviceInputSchema, listDevices, registerDevice, removeDevice, updateDevice } from "@orbita/core/identity/device";
import type { RouteCtx } from "../http/web";
import { leituraCacheavel } from "../http/cacheable";
import { domainError, ownerOf } from "../http/owner-route";

/**
 * Dispositivos da casa e o cômodo de cada um (B5.3/B5.4). O navegador se
 * cadastra uma vez, guarda o id e o manda no chat: é assim que "apaga a luz
 * daqui" sabe onde é "aqui", e é por onde a notificação acha o cômodo da pessoa.
 */
export async function GET(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  return leituraCacheavel(req, { devices: await listDevices(o.userId) });
}

export async function POST(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const parsed = DeviceInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  try {
    return Response.json(await registerDevice(o.userId, parsed.data));
  } catch (e) {
    return domainError(e);
  }
}

const PatchBody = DeviceInputSchema.partial().extend({ id: z.string().uuid() });

export async function PATCH(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const { id, ...patch } = parsed.data;
  if (!Object.keys(patch).length) return Response.json({ error: "Nada para alterar" }, { status: 400 });
  try {
    await updateDevice(o.userId, id, patch);
    return Response.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const o = await ownerOf(ctx);
  if (o instanceof Response) return o;
  const id = z.string().uuid().safeParse(new URL(req.url).searchParams.get("id"));
  if (!id.success) return Response.json({ error: "id inválido" }, { status: 400 });
  try {
    await removeDevice(o.userId, id.data);
    return Response.json({ ok: true });
  } catch (e) {
    return domainError(e);
  }
}
