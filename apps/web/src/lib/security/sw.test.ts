import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * O service worker não pode tocar requisição de outro site: o `fetch` dele obedece
 * à CSP do sw.js, não à da página, e o widget da Pluggy morria aí (12/10/2026).
 */

function carregarWorker() {
  const ouvintes: Record<string, (e: unknown) => void> = {};
  const self = {
    location: { origin: "http://localhost:3000" },
    addEventListener: (tipo: string, fn: (e: unknown) => void) => (ouvintes[tipo] = fn),
    skipWaiting: () => undefined,
    clients: { claim: () => undefined },
  };
  const fonte = readFileSync(join(__dirname, "../../../public/sw.js"), "utf-8");
  new Function("self", "caches", "fetch", fonte)(self, { open: vi.fn(), match: vi.fn(async () => undefined), keys: vi.fn() }, vi.fn(() => new Promise(() => undefined)));
  return (url: string) => {
    const respondWith = vi.fn();
    ouvintes.fetch({ request: { method: "GET", url, mode: "no-cors" }, respondWith });
    return respondWith.mock.calls.length > 0;
  };
}

describe("service worker", () => {
  const interceptou = carregarWorker();

  it("deixa o navegador buscar outro site sozinho", () => {
    expect(interceptou("https://cdn.pluggy.ai/pluggy-connect/v2.3.1/pluggy-connect.js")).toBe(false);
    expect(interceptou("https://connect.pluggy.ai/")).toBe(false);
  });

  it("continua cuidando dos arquivos da própria Órbita", () => {
    expect(interceptou("http://localhost:3000/_next/static/chunks/app.js")).toBe(true);
  });
});
