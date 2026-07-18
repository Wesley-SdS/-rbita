import { NextResponse, type NextRequest } from "next/server";

/**
 * Observabilidade: gera/propaga um request-id e loga cada requisição de API
 * (método, rota, id) em JSON. O tempo de resposta é medido no route handler;
 * aqui garantimos rastreabilidade ponta a ponta via header x-request-id.
 */
export function middleware(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  const { pathname } = req.nextUrl;

  // log leve só para rotas de API (evita ruído de assets)
  if (pathname.startsWith("/api/")) {
    console.log(
      JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "req", method: req.method, path: pathname, rid: requestId }),
    );
  }

  const res = NextResponse.next();
  res.headers.set("x-request-id", requestId);
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
