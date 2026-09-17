// Migrada do Next em paridade (apps/web/src/app/api/account/export/route.ts).
import { exportAccount } from "@orbita/core/account/data";
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";

/**
 * Exporta todos os dados do usuário em JSON (portabilidade, LGPD). As tabelas
 * saem do schema, não de uma lista à mão (RV.6): o que entrar nas próximas
 * ondas aparece aqui sem tocar nesta rota. Credenciais e vetores ficam fora,
 * listados em `omitidos` com o motivo.
 */
export async function GET(_req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const payload = await exportAccount(session.user);
  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="orbita-meus-dados.json"',
    },
  });
}
