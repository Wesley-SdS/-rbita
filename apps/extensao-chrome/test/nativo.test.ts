import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { abrirComExtensao, chromiumDeTeste, construirExtensao, type Navegador } from "./ambiente";
// @ts-expect-error módulo JS puro do instalador, sem tipos
import { instalada, instalar, remover } from "../ponte/instalar.mjs";

/**
 * B7 DE PONTA A PONTA: a ponte registrada no HKCU (só nas chaves do Chromium
 * e do Chrome for Testing, nunca na do Chrome do dono), a extensão num
 * Chromium de teste tentando native messaging PRIMEIRO, e o canal de verdade
 * do outro lado. No fim, o registro é desfeito.
 *
 * SÓ COM `ORBITA_E2E_NATIVO=1`: o Chromium de teste só acha a ponte nas chaves
 * DELE no HKCU, então este teste escreve no registro do usuário (e apaga no
 * fim). Rodando a cada `vitest` completo, ele mexia no registro toda vez; agora
 * é pedido de propósito. O instalador em si (segredo, ACL, idempotência) é
 * testado sempre, numa chave que nenhum navegador lê (`ponte.test.ts`).
 */

const cfg: Record<string, unknown> = {};
vi.mock("../../../packages/core/src/settings", async () => {
  const { SETTING_DEFS } = await vi.importActual<typeof import("../../../packages/core/src/settings/defs")>("../../../packages/core/src/settings/defs");
  const valor = (k: string) => (k in cfg ? cfg[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]?.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])), set: async (k: string, v: unknown) => void (cfg[k] = v) } };
});

const CHROMIUM = chromiumDeTeste();
const NAVEGADORES = ["chromium", "chrome-for-testing"];
const usuario = `teste-nativo-${randomUUID().slice(0, 8)}`;
const PEDIDO = process.env.ORBITA_E2E_NATIVO === "1";
const RODA = !!CHROMIUM && process.platform === "win32" && PEDIDO;
// o segredo da ponte deste teste: num arquivo temporário (o api deste processo e a ponte leem o mesmo, pelo .bat)
const pastaDoSegredo = mkdtempSync(join(tmpdir(), "orbita-nativo-"));
const env = { ...process.env, ORBITA_PONTE_SEGREDO: join(pastaDoSegredo, "segredo") };

if (!RODA) {
  const motivo = !PEDIDO ? "escreve no HKCU: rode com ORBITA_E2E_NATIVO=1" : !CHROMIUM ? "sem o Chrome for Testing" : "só no Windows";
  console.warn(`[orbita] nativo.test.ts PULADO: ${motivo}.`);
  describe("native messaging (B7)", () => {
    it.skip(`PULADO: ${motivo}`, () => undefined);
  });
}

describe.skipIf(!RODA)("native messaging (B7)", () => {
  let api: Server;
  let porta = 0;
  let desanexar: () => void;
  let nav: Navegador | null = null;
  let core: {
    canal: typeof import("../../../packages/core/src/navegador/canal");
    pareamento: typeof import("../../../packages/core/src/navegador/pareamento");
    db: typeof import("../../../packages/db/src/index");
    schema: typeof import("../../../packages/db/src/schema");
  };

  beforeAll(async () => {
    construirExtensao();
    const [canal, servidor, pareamento, db, schema] = await Promise.all([
      import("../../../packages/core/src/navegador/canal"),
      import("../../../packages/core/src/navegador/servidor"),
      import("../../../packages/core/src/navegador/pareamento"),
      import("../../../packages/db/src/index"),
      import("../../../packages/db/src/schema"),
    ]);
    core = { canal, pareamento, db, schema };
    await db.db.insert(schema.user).values({ id: usuario, name: "Teste nativo", email: `${usuario}@orbita.teste` });
    api = createServer((_q, s) => s.writeHead(404).end());
    await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
    porta = (api.address() as { port: number }).port;
    canal.ligarCanalDaExtensao();
    // o api lê o segredo pelo MESMO caminho que o instalador grava e a ponte lê
    process.env.ORBITA_PONTE_SEGREDO = env.ORBITA_PONTE_SEGREDO;
    desanexar = servidor.anexarCanalDoNavegador(api);
    instalar(NAVEGADORES, env);
  }, 120_000);

  afterAll(async () => {
    await nav?.fechar();
    desanexar?.();
    api?.close();
    remover(NAVEGADORES, env);
    rmSync(pastaDoSegredo, { recursive: true, force: true });
    delete process.env.ORBITA_PONTE_SEGREDO;
    core?.canal._limparConexoes();
    if (core) await core.db.db.$client`delete from "user" where id = ${usuario}`;
  }, 60_000);

  it("o instalador é idempotente e só mexe nas chaves pedidas", () => {
    instalar(NAVEGADORES, env);
    expect(instalada("chromium")).toBe(true);
    expect(instalada("chrome-for-testing")).toBe(true);
  });

  it("a extensão fala pela ponte primeiro, pareia e conecta sem WebSocket direto", async () => {
    // a ponte herda o ambiente do Chromium: é por ele que ela sabe a porta do canal deste teste
    nav = await abrirComExtensao(CHROMIUM!, { env: { ORBITA_CANAL_URL: `ws://127.0.0.1:${porta}/api/navegador/canal` } });
    const popup = await nav.contexto.newPage();
    await popup.goto(`chrome-extension://${nav.sw.url().split("/")[2]}/popup.html`);
    const { codigo } = core.pareamento.gerarCodigo(usuario);
    await popup.fill("#codigo", codigo);
    await popup.click("#botao-parear");
    const fim = Date.now() + 30_000;
    while (!core.canal.extensaoConectada(usuario) && Date.now() < fim) await new Promise((r) => setTimeout(r, 300));
    expect(core.canal.extensaoConectada(usuario)).toBe(true);
    const estado = (await nav.sw.evaluate(() => chrome.storage.session.get("estado"))) as { estado: { via: string } };
    expect(estado.estado.via).toBe("nativo");
    // e funciona: uma ordem de ida e volta pela ponte
    const r = await core.canal.ordemAExtensao(usuario, { tipo: "abas" }, "dono", 10_000);
    expect(Array.isArray(r.abas)).toBe(true);
  }, 90_000);

  it("o remover desfaz o registro", () => {
    remover(NAVEGADORES, env);
    expect(instalada("chromium")).toBe(false);
    expect(instalada("chrome-for-testing")).toBe(false);
  });
});
