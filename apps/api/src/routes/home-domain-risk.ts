import { z } from "zod";
import { defaultDomainRisk, isKnownDomain } from "@orbita/core/home/domain-risk";
import { loadDomainRiskOverrides, setDomainRiskOverride } from "@orbita/core/home/access";
import { TOOL_RISKS } from "@orbita/core/tools/index";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

// domínios do HA que já aparecem nas entidades sincronizadas do usuário, para
// a tela mostrar mesmo os que ainda não têm override (zero hardcode: não é
// uma lista fixa, é o que o índice de entidades já descobriu)
import { db } from "@orbita/db";
import { haEntity } from "@orbita/db/home-schema";
import { eq } from "drizzle-orm";
import { ownerOf } from "../http/owner-route";

/** GET /api/home/domain-risk — risco efetivo por domínio (B3.8), default + override. */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const [overrides, seen] = await Promise.all([
    loadDomainRiskOverrides(session.user.id),
    db.selectDistinct({ domain: haEntity.domain }).from(haEntity).where(eq(haEntity.userId, session.user.id)),
  ]);
  const domains = new Set([...overrides.keys(), ...seen.map((s) => s.domain)]);
  const rows = [...domains].sort().map((domain) => ({
    domain,
    default: defaultDomainRisk(domain),
    override: overrides.get(domain) ?? null,
    effective: overrides.get(domain) ?? defaultDomainRisk(domain),
    known: isKnownDomain(domain),
  }));
  return Response.json({ domains: rows });
}

const PutBody = z.object({ domain: z.string().min(1).max(60), risk: z.enum(TOOL_RISKS).nullable() });

/** PUT /api/home/domain-risk — sobrescreve (ou remove, com risk: null) o risco de um domínio. */
export async function PUT(req: Request, ctx: RouteCtx) {
  const dono = await ownerOf(ctx);
  if (dono instanceof Response) return dono;
  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  // ao contrário do risco de tool (só sobe), aqui o dono pode subir OU descer
  // à vontade: é ele quem decide o que é seguro na própria casa, não um
  // padrão de segurança compartilhado entre todos os usuários do app.
  await setDomainRiskOverride(dono.userId, parsed.data.domain, parsed.data.risk);
  return Response.json({ ok: true });
}
