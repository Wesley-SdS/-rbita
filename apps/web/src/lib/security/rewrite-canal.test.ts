import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

/**
 * I-2 da auditoria do Chrome: o rewrite do Next mandava `/api/navegador/canal`
 * ao apps/api, e o api via a conexão do próprio Next (127.0.0.1). Com o Next
 * aberto na rede (`dev:rede`), uma máquina da casa chegava ao canal da
 * extensão por ali. O canal não passa mais pelo Next; o resto de /api continua.
 */
describe("o rewrite do Next não leva o canal da extensão", () => {
  it("navegador/canal fica de fora; as outras rotas do navegador e da api seguem para o apps/api", async () => {
    const r = (await nextConfig.rewrites!()) as { beforeFiles: { source: string }[] };
    const fonte = r.beforeFiles[0]!.source;
    // "/api/:path(<regex>.*)" do path-to-regexp: o que importa é o lookahead do começo
    const regex = new RegExp(`^${fonte.slice("/api/:path(".length, -1)}$`);
    expect(regex.test("navegador/canal")).toBe(false);
    expect(regex.test("navegador/canal/")).toBe(false);
    expect(regex.test("auth/session")).toBe(false);
    expect(regex.test("navegador/sites")).toBe(true);
    expect(regex.test("navegador/canalx")).toBe(true);
    expect(regex.test("chat")).toBe(true);
  });
});
