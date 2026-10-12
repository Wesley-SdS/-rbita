import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Worker } from "playwright-core";

/**
 * O AMBIENTE dos testes de ponta a ponta da extensão: um Chromium que aceita
 * `--load-extension` (o Chrome for Testing que o Playwright já guarda na
 * máquina; o Chrome de marca ignora a flag desde o 137), um perfil TEMPORÁRIO
 * (nunca o do dono), o servidor da bancada F8 e a extensão construída.
 */

export const RAIZ = fileURLToPath(new URL("..", import.meta.url));
export const DIST = join(RAIZ, "dist");
export const BANCADA = join(RAIZ, "bancada");

/** O Chromium for Testing mais novo do cache do Playwright, se houver. */
export function chromiumDeTeste(): string | null {
  if (process.env.ORBITA_CHROMIUM_TESTE && existsSync(process.env.ORBITA_CHROMIUM_TESTE)) return process.env.ORBITA_CHROMIUM_TESTE;
  const base = join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  if (!existsSync(base)) return null;
  const pastas = readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const p of pastas) {
    const exe = join(base, p, "chrome-win64", "chrome.exe");
    if (existsSync(exe)) return exe;
  }
  return null;
}

export function construirExtensao(): void {
  const r = spawnSync(process.execPath, [join(RAIZ, "scripts", "build.mjs")], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`build da extensão falhou: ${r.stderr}`);
}

export function idDaExtensao(): string {
  const r = spawnSync(process.execPath, [join(RAIZ, "scripts", "id-da-extensao.mjs")], { encoding: "utf8" });
  return r.stdout.trim();
}

const TIPOS: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

/** A bancada servida por HTTP local (porta livre). */
export async function servirBancada(): Promise<{ server: Server; url: (p: string) => string; porta: number }> {
  const server = createServer((req, res) => {
    const caminho = decodeURIComponent((req.url ?? "/").split("?")[0]!.split("#")[0]!);
    if (caminho === "/recebido") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<!doctype html><title>Recebido</title><main><h1>Recebido</h1></main>");
      return;
    }
    const arq = join(BANCADA, caminho.replace(/^\/+/, "") || "texto-escondido.html");
    if (!arq.startsWith(BANCADA) || !existsSync(arq)) {
      res.writeHead(404).end("não achei");
      return;
    }
    res.writeHead(200, { "content-type": TIPOS[extname(arq)] ?? "application/octet-stream" }).end(readFileSync(arq));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const porta = (server.address() as { port: number }).port;
  return { server, porta, url: (p) => `http://127.0.0.1:${porta}/${p}` };
}

export interface Navegador {
  contexto: BrowserContext;
  sw: Worker;
  pasta: string;
  fechar(): Promise<void>;
}

/** O Chromium com a extensão, num perfil temporário. */
export async function abrirComExtensao(executavel: string, opcoes: { headless?: boolean; env?: Record<string, string> } = {}): Promise<Navegador> {
  const { chromium } = await import("playwright-core");
  const pasta = mkdtempSync(join(tmpdir(), "orbita-e2e-"));
  const contexto = await chromium.launchPersistentContext(pasta, {
    executablePath: executavel,
    headless: opcoes.headless ?? true,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--no-first-run"],
    env: { ...process.env, ...(opcoes.env ?? {}) } as Record<string, string>,
  });
  const sw = contexto.serviceWorkers()[0] ?? (await contexto.waitForEvent("serviceworker", { timeout: 20_000 }));
  return {
    contexto,
    sw,
    pasta,
    async fechar() {
      await contexto.close().catch(() => undefined);
      rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    },
  };
}
