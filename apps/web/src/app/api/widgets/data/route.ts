import { getWeather } from "@/lib/tools/weather";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dados ao vivo de um widget (cotação de moeda ou clima). */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return Response.json({ error: "Não autenticado" }, { status: 401 });
  const url = new URL(req.url);
  const type = url.searchParams.get("type");

  try {
    if (type === "cotacao") {
      const par = (url.searchParams.get("par") || "USD-BRL").toUpperCase();
      const r = await fetch(`https://economia.awesomeapi.com.br/json/last/${par}`, { signal: AbortSignal.timeout(4000) });
      const d = (await r.json()) as Record<string, { bid: string; pctChange: string; name: string }>;
      const k = par.replace("-", "");
      const item = d[k];
      if (!item) return Response.json({ error: "par inválido" }, { status: 422 });
      return Response.json({ valor: Number(item.bid), variacao: Number(item.pctChange), nome: item.name });
    }
    if (type === "clima") {
      const cidade = url.searchParams.get("cidade") || "São Paulo";
      const w = await getWeather(cidade);
      return Response.json(w);
    }
    return Response.json({ error: "tipo desconhecido" }, { status: 400 });
  } catch {
    return Response.json({ error: "falha ao obter dados" }, { status: 502 });
  }
}
