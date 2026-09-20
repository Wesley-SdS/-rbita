import "./env";
import "./egress-guard";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { configureEventSource } from "@orbita/core/events/index";
import { log } from "@orbita/core/observability/logger";
import { AppModule } from "./app.module";
import { ErrorFilter } from "./http/error.filter";
import { compressaoDeControllers } from "./http/compress";
import { motivoRecusaOrigem } from "@orbita/core/csrf";
import { trustedOrigins } from "@orbita/core/auth-origins";

/**
 * O PROCESSO VIVO da Órbita (BRIEFING-JARVIS.md §5 e §8, Onda 1).
 *
 * Nasce como o processo persistente que o Next não podia ser: cron real,
 * event bus, regras proativas, renovação de token, e (Onda 3) o WebSocket do
 * Home Assistant. As rotas HTTP migram para cá em paridade, uma a uma; o Next
 * encaminha para cá (rewrite de fallback) tudo em /api/* que ele mesmo não tiver.
 */
async function bootstrap() {
  configureEventSource("api");
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ["error", "warn"] });
  app.useGlobalFilters(new ErrorFilter());
  // o Next (mesma origem) está na frente; sem CORS aberto de propósito
  app.set("trust proxy", true);
  // O chat aceita imagem em data URL dentro do JSON (até 8 MB, validado por
  // zod na rota): o limite padrão de 100 kB do body-parser cortaria isso.
  app.useBodyParser("json", { limit: process.env.API_JSON_LIMIT ?? "12mb" });
  // Compressão do JSON dos controllers do Nest. As rotas migradas já são
  // comprimidas na ponte (`sendWebResponse`); isto cobre as seis que respondem
  // pelo Express direto, entre elas a listagem de Ajustes, com 60 kB.
  app.use(compressaoDeControllers);
  // Anti-CSRF nas rotas que alteram dados, com a MESMA lista de origens do
  // login (ver core/csrf.ts). Atrás do proxy do Next, o host que o navegador
  // usou chega em x-forwarded-host.
  app.use((req: { method: string; headers: Record<string, string | string[] | undefined> }, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    const h = (k: string) => {
      const v = req.headers[k];
      return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    };
    const hostVisto = h("x-forwarded-host") ?? h("host");
    const confiaveis = trustedOrigins({
      headers: { get: (k: string) => (k.toLowerCase() === "host" ? hostVisto : h(k.toLowerCase())) },
    } as unknown as Request);
    const motivo = motivoRecusaOrigem({ method: req.method, origin: h("origin"), secFetchSite: h("sec-fetch-site"), confiaveis });
    if (motivo) {
      log.warn("csrf.recusado", { method: req.method, origin: h("origin"), motivo });
      res.status(403).json({ error: "Pedido recusado: origem não permitida." });
      return;
    }
    next();
  });
  // 3010 e não 3001: nesta máquina a 3001 já é usada por outros serviços
  const port = Number(process.env.API_PORT ?? 3010);
  await app.listen(port, "127.0.0.1");
  log.info("api.up", { port });
}

bootstrap().catch((e) => {
  log.error("api.boot_falhou", { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
