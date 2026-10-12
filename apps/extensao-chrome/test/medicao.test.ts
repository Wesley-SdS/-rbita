import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { abrirComExtensao, chromiumDeTeste, construirExtensao, DIST, idDaExtensao, servirBancada, type Navegador } from "./ambiente";

/**
 * B0, A MEDIÇÃO (não é teste de regressão): roda só com ORBITA_MEDIR=1 e grava
 * os números em ORBITA_MEDIR_SAIDA (JSON), que viram o apps/extensao-chrome/MEDICAO.md.
 *
 *   ORBITA_MEDIR=1 ORBITA_MEDIR_SAIDA=... node ./node_modules/vitest/vitest.mjs run ../extensao-chrome/test/medicao.test.ts
 *
 * Mede: tokens do retrato de páginas reais, o depurador em aba sem foco, o
 * peso da faixa amarela, a latência por ação e uma tarefa delegada de verdade
 * com o Claude da assinatura (se o token estiver no ambiente).
 */

const cfg: Record<string, unknown> = {};
vi.mock("../../../packages/core/src/settings", async () => {
  const { SETTING_DEFS } = await vi.importActual<typeof import("../../../packages/core/src/settings/defs")>("../../../packages/core/src/settings/defs");
  const valor = (k: string) => (k in cfg ? cfg[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]?.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])), set: async (k: string, v: unknown) => void (cfg[k] = v), invalidate: () => undefined } };
});
vi.mock("../../../packages/core/src/owner", () => ({ isOwner: async () => true }));
vi.mock("../../../packages/core/src/llm/gerar", async (orig) => ({ ...(await orig<object>()), gerarEstruturado: async () => ({ dados: { alinhado: true, motivo: "medição" }, modelKey: "teste" }) }));

const MEDIR = process.env.ORBITA_MEDIR === "1";
const CHROMIUM = chromiumDeTeste();
const usuario = `teste-medir-${randomUUID().slice(0, 8)}`;
const resultado: Record<string, unknown> = { quando: new Date().toISOString(), chromium: CHROMIUM };

const PAGINAS_REAIS = [
  "https://g1.globo.com/",
  "https://pt.wikipedia.org/wiki/Google_Chrome",
  "https://github.com/microsoft/playwright",
  "https://news.ycombinator.com/",
  "https://www.gov.br/pt-br",
  "https://developer.chrome.com/docs/extensions/reference/api/debugger",
];

function tokenDoClaude(): string | null {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try {
    const env = readFileSync(new URL("../../web/.env", import.meta.url), "utf8");
    return env.match(/^CLAUDE_CODE_OAUTH_TOKEN=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "") ?? null;
  } catch {
    return null;
  }
}

/** Tokens do Claude de verdade (count_tokens pela assinatura); sem ele, a estimativa do gpt-tokenizer. */
async function contarTokens(texto: string): Promise<{ claude: number | null; estimativa: number }> {
  const { encode } = await import("gpt-tokenizer");
  const estimativa = encode(texto).length;
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) return { claude: null, estimativa };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-5-5", system: [{ type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." }], messages: [{ role: "user", content: texto || "." }] }),
    });
    const j = (await r.json()) as { input_tokens?: number };
    return { claude: typeof j.input_tokens === "number" ? j.input_tokens - 20 : null, estimativa };
  } catch {
    return { claude: null, estimativa };
  }
}

const mediana = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

describe.runIf(MEDIR && CHROMIUM)("B0: medição", () => {
  let api: Server;
  let desanexar: () => void;
  let nav: Navegador;
  let bancada: Awaited<ReturnType<typeof servirBancada>>;
  let core: {
    canal: typeof import("../../../packages/core/src/navegador/canal");
    pareamento: typeof import("../../../packages/core/src/navegador/pareamento");
    sessao: typeof import("../../../packages/core/src/controle/sessao");
    leitura: typeof import("../../../packages/core/src/navegador/leitura");
    db: typeof import("../../../packages/db/src/index");
    schema: typeof import("../../../packages/db/src/schema");
  };
  const ordem = (o: Parameters<typeof core.canal.ordemAExtensao>[1]) => core.canal.ordemAExtensao(usuario, o, "dono", 60_000);
  async function abaDe(url: string) {
    const r = await ordem({ tipo: "abas" });
    return r.abas!.find((a) => a.url.startsWith(url))!.aba;
  }

  beforeAll(async () => {
    const t = tokenDoClaude();
    if (t) process.env.CLAUDE_CODE_OAUTH_TOKEN = t;
    cfg["controle.ativo"] = true;
    construirExtensao();
    const [canal, servidor, pareamento, sessao, leitura, db, schema] = await Promise.all([
      import("../../../packages/core/src/navegador/canal"),
      import("../../../packages/core/src/navegador/servidor"),
      import("../../../packages/core/src/navegador/pareamento"),
      import("../../../packages/core/src/controle/sessao"),
      import("../../../packages/core/src/navegador/leitura"),
      import("../../../packages/db/src/index"),
      import("../../../packages/db/src/schema"),
    ]);
    core = { canal, pareamento, sessao, leitura, db, schema };
    await db.db.insert(schema.user).values({ id: usuario, name: "Medição", email: `${usuario}@orbita.teste` });
    api = createServer((_q, s) => s.writeHead(404).end());
    await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
    const porta = (api.address() as { port: number }).port;
    canal.ligarCanalDaExtensao();
    desanexar = servidor.anexarCanalDoNavegador(api);
    bancada = await servirBancada();
    nav = await abrirComExtensao(CHROMIUM!);
    const popup = await nav.contexto.newPage();
    await popup.goto(`chrome-extension://${idDaExtensao()}/popup.html`);
    await popup.click("summary");
    await popup.fill("#endereco", `ws://127.0.0.1:${porta}/api/navegador/canal`);
    await popup.click("#botao-endereco");
    await popup.fill("#codigo", pareamento.gerarCodigo(usuario).codigo);
    await popup.click("#botao-parear");
    const fim = Date.now() + 20_000;
    while (!canal.extensaoConectada(usuario) && Date.now() < fim) await new Promise((r) => setTimeout(r, 200));
    await popup.close();
  }, 180_000);

  afterAll(async () => {
    writeFileSync(process.env.ORBITA_MEDIR_SAIDA ?? join(tmpdir(), "orbita-medicao.json"), JSON.stringify(resultado, null, 2));
    await nav?.fechar();
    desanexar?.();
    api?.close();
    bancada?.server.close();
    if (core) await core.db.db.$client`delete from "user" where id = ${usuario}`;
  }, 60_000);

  it("tokens do retrato de páginas reais", async () => {
    const linhas: Record<string, unknown>[] = [];
    for (const url of PAGINAS_REAIS) {
      const p = await nav.contexto.newPage();
      try {
        await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await p.waitForTimeout(2500);
        const aba = await abaDe(url.replace(/\/$/, ""));
        const linha: Record<string, unknown> = { url };
        for (const [nome, o] of [
          ["interativos", { modo: "arvore", filtro: "interativos" }],
          ["visiveis", { modo: "arvore", filtro: "visiveis" }],
          ["tudo", { modo: "arvore", filtro: "tudo" }],
          ["texto", { modo: "texto", filtro: "visiveis" }],
        ] as const) {
          const t0 = Date.now();
          const r = await ordem({ tipo: "ler", aba, modo: o.modo, filtro: o.filtro, maxElementos: 2000, maxCaracteres: 100_000 });
          const ms = Date.now() - t0;
          const texto = core.leitura.leituraParaModelo(r.leitura!);
          const tk = await contarTokens(texto);
          linha[nome] = { elementos: r.leitura!.elementos?.length ?? null, caracteres: texto.length, tokensClaude: tk.claude, tokensEstimados: tk.estimativa, escondidos: r.leitura!.escondidos, ms };
        }
        const t0 = Date.now();
        const img = await ordem({ tipo: "ver", aba, larguraMax: 1280 });
        linha.captura = { largura: img.imagem?.largura, altura: img.imagem?.altura, bytes: Math.round(((img.imagem?.base64.length ?? 0) * 3) / 4), ms: Date.now() - t0, tokensEstimadosImagem: img.imagem ? Math.round((img.imagem.largura * img.imagem.altura) / 750) : null };
        linhas.push(linha);
      } catch (e) {
        linhas.push({ url, erro: e instanceof Error ? e.message.slice(0, 200) : String(e) });
      } finally {
        await p.close();
      }
    }
    resultado.paginas = linhas;
    expect(linhas.length).toBe(PAGINAS_REAIS.length);
  }, 600_000);

  it("o depurador age em aba sem foco (captura e clique)", async () => {
    const url = bancada.url("formulario.html");
    const alvo = await nav.contexto.newPage();
    await alvo.goto(url);
    const frente = await nav.contexto.newPage();
    await frente.goto(bancada.url("titulo.html"));
    await frente.bringToFront();
    const aba = await abaDe(url);
    const ativa = (await ordem({ tipo: "abas" })).abas!.find((a) => a.aba === aba)!.ativa;
    const s = await core.sessao.abrirSessao(usuario, { alvo: "navegador", objetivo: "medir", pedidoOriginal: "medir", pedidoLiteral: true, apps: [], sites: ["127.0.0.1"], tetoPassos: 500, tetoMinutos: 60, canal: "tela" });
    await new Promise((r) => setTimeout(r, 500));
    // a aba do formulário entra no grupo pela própria Órbita (como faria ao abri-la)
    const t0 = Date.now();
    const cap = await ordem({ tipo: "ver", aba, larguraMax: 1280 }).catch((e: Error) => ({ erro: e.message }));
    const msCaptura = Date.now() - t0;
    const lido = await ordem({ tipo: "ler", aba, modo: "arvore", filtro: "interativos", maxElementos: 100, maxCaracteres: 1000 });
    const ajuda = lido.leitura!.elementos!.find((e) => e.nome === "Ver ajuda")!;
    const t1 = Date.now();
    const clique = await ordem({ tipo: "agir", aba, acao: "clicar", ref: ajuda.ref, assinatura: { papel: ajuda.papel, nome: ajuda.nome } }).catch((e: Error) => ({ erro: e.message }));
    const msClique = Date.now() - t1;
    const status = await alvo.textContent("#status");
    resultado.semFoco = { abaAtiva: ativa, captura: "erro" in cap ? cap.erro : "ok", msCaptura, clique: "erro" in clique ? clique.erro : "ok", msClique, efeitoNaPagina: status };
    await core.sessao.encerrarSessao(usuario, s.id, "medição");
    await alvo.close();
    await frente.close();
  }, 120_000);

  it("latência por ação (mediana de 10)", async () => {
    const url = bancada.url("formulario.html");
    const p = await nav.contexto.newPage();
    await p.goto(url);
    const aba = await abaDe(url);
    const s = await core.sessao.abrirSessao(usuario, { alvo: "navegador", objetivo: "medir", pedidoOriginal: "medir", pedidoLiteral: true, apps: [], sites: ["127.0.0.1"], tetoPassos: 500, tetoMinutos: 60, canal: "tela" });
    await new Promise((r) => setTimeout(r, 500));
    const lido = await ordem({ tipo: "ler", aba, modo: "arvore", filtro: "interativos", maxElementos: 100, maxCaracteres: 1000 });
    const nome = lido.leitura!.elementos!.find((e) => e.nome === "Nome")!;
    const ajuda = lido.leitura!.elementos!.find((e) => e.nome === "Ver ajuda")!;
    const casos: Record<string, () => Promise<unknown>> = {
      abas: () => ordem({ tipo: "abas" }),
      ler_arvore: () => ordem({ tipo: "ler", aba, modo: "arvore", filtro: "interativos", maxElementos: 250, maxCaracteres: 20_000 }),
      ler_texto: () => ordem({ tipo: "ler", aba, modo: "texto", filtro: "visiveis", maxElementos: 250, maxCaracteres: 20_000 }),
      descrever_ref: () => ordem({ tipo: "descrever", aba, ref: ajuda.ref }),
      clicar: () => ordem({ tipo: "agir", aba, acao: "clicar", ref: ajuda.ref, assinatura: { papel: ajuda.papel, nome: ajuda.nome } }),
      preencher: () => ordem({ tipo: "agir", aba, acao: "preencher", ref: nome.ref, assinatura: { papel: nome.papel, nome: nome.nome }, texto: "Wesley" }),
      ver: () => ordem({ tipo: "ver", aba, larguraMax: 1280 }),
    };
    const lat: Record<string, number> = {};
    for (const [k, fn] of Object.entries(casos)) {
      const xs: number[] = [];
      try {
        for (let i = 0; i < 10; i++) {
          const t0 = performance.now();
          await fn();
          xs.push(performance.now() - t0);
        }
        lat[k] = Math.round(mediana(xs));
      } catch (e) {
        lat[k] = -1;
        resultado[`latenciaErro_${k}`] = e instanceof Error ? e.message.slice(0, 200) : String(e);
      }
    }
    resultado.latenciaMs = lat;
    await core.sessao.encerrarSessao(usuario, s.id, "medição");
    await p.close();
  }, 300_000);

  it("tempo do Parar na aba: até a extensão soltar e até o core marcar a sessão", async () => {
    const amostras: { extensaoMs: number; coreMs: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const s = await core.sessao.abrirSessao(usuario, { alvo: "navegador", objetivo: "medir o parar", pedidoOriginal: "medir", pedidoLiteral: true, apps: [], sites: ["127.0.0.1"], tetoPassos: 50, tetoMinutos: 30, canal: "tela" });
      await new Promise((r) => setTimeout(r, 300));
      const r = await ordem({ tipo: "abrir", url: bancada.url("formulario.html"), nova: true, grupo: { titulo: "Órbita: medir", cor: "purple" } });
      const p = nav.contexto.pages().filter((x) => x.url().includes("formulario.html")).at(-1)!;
      await p.bringToFront();
      // o depurador anexado, como numa ação de verdade
      await ordem({ tipo: "agir", aba: r.aba, acao: "rolar", direcao: "baixo", quantidade: 1 });
      const fimEspera = Date.now() + 10_000;
      while (!(await p.evaluate(() => !!document.querySelector("orbita-borda"))) && Date.now() < fimEspera) await p.waitForTimeout(100);
      const w = await p.evaluate(() => window.innerWidth);
      let x = w / 2;
      while (x < w && (await p.evaluate(([px]) => document.elementFromPoint(px!, 22)?.tagName ?? "", [x + 4])) === "ORBITA-BORDA") x += 4;
      const t0 = Date.now();
      await p.mouse.click(x - 20, 22);
      let extensaoMs = -1;
      let coreMs = -1;
      while ((extensaoMs < 0 || coreMs < 0) && Date.now() - t0 < 5000) {
        if (extensaoMs < 0) {
          const e = (await nav.sw.evaluate(() => chrome.storage.session.get("estado"))) as { estado: { parado: boolean; depurando: number[] } };
          if (e.estado.parado && !e.estado.depurando.length) extensaoMs = Date.now() - t0;
        }
        if (coreMs < 0 && (await core.sessao.sessaoPorId(usuario, s.id))?.status === "parada") coreMs = Date.now() - t0;
        await new Promise((res) => setTimeout(res, 10));
      }
      amostras.push({ extensaoMs, coreMs });
      await p.close();
    }
    resultado.parar = { amostras, medianaExtensaoMs: mediana(amostras.map((a) => a.extensaoMs)), medianaCoreMs: mediana(amostras.map((a) => a.coreMs)) };
  }, 180_000);

  it("peso da faixa do depurador (janela visível)", async () => {
    const { chromium } = await import("playwright-core");
    const pasta = mkdtempSync(join(tmpdir(), "orbita-faixa-"));
    const ctx = await chromium.launchPersistentContext(pasta, { executablePath: CHROMIUM!, headless: false, viewport: null, args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--window-size=1280,900"] });
    try {
      const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
      const p = ctx.pages()[0] ?? (await ctx.newPage());
      await p.goto(bancada.url("formulario.html"));
      await p.waitForTimeout(800);
      const antes = await p.evaluate(() => window.innerHeight);
      await sw.evaluate(async () => {
        const [t] = await chrome.tabs.query({ active: true });
        await chrome.debugger.attach({ tabId: t!.id! }, "1.3");
      });
      await p.waitForTimeout(1500);
      const depois = await p.evaluate(() => window.innerHeight);
      resultado.faixa = { alturaAntes: antes, alturaDepois: depois, pixelsDaFaixa: antes - depois };
    } finally {
      await ctx.close();
      rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
  }, 120_000);

  it("Chrome de marca e --load-extension", async () => {
    const marca = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const { chromium } = await import("playwright-core");
    const pasta = mkdtempSync(join(tmpdir(), "orbita-marca-"));
    let carregou = false;
    let versao = "";
    try {
      const ctx = await chromium.launchPersistentContext(pasta, { executablePath: marca, headless: true, args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`] });
      versao = ctx.browser()?.version() ?? "";
      carregou = !!(ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 8000 }).catch(() => null)));
      await ctx.close();
    } catch (e) {
      resultado.marcaErro = e instanceof Error ? e.message.slice(0, 200) : String(e);
    } finally {
      rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
    resultado.chromeDeMarca = { versao, loadExtensionFuncionou: carregou };
  }, 120_000);

  it("tarefa delegada de verdade, com o Claude da assinatura", async () => {
    if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      resultado.claude = "sem token";
      return;
    }
    const s = await core.sessao.abrirSessao(usuario, { alvo: "navegador", objetivo: "preencher o reembolso de teste", pedidoOriginal: "preenche o reembolso", pedidoLiteral: true, apps: [], sites: ["127.0.0.1"], tetoPassos: 60, tetoMinutos: 30, canal: "tela" });
    await new Promise((r) => setTimeout(r, 500));
    const { dependenciasDaTarefa } = await import("../../../packages/core/src/navegador/trabalho");
    const { rodarTarefa } = await import("../../../packages/core/src/navegador/motor");
    const { chamarClaudeDireto } = await import("../../../packages/llm/src/claude-direto");
    const objetivo = `Abra ${bancada.url("formulario.html")}, preencha Nome com "Wesley", Valor com "42", Categoria "Transporte", marque a declaração e clique em Enviar.`;
    const { deps, cfg: c } = await dependenciasDaTarefa({ userId: usuario, objetivo, sessaoId: s.id, canal: "tela", pedido: objetivo, cancelado: async () => false, progresso: async () => undefined });
    const rodadas: { ms: number; entrada: number; saida: number; membros: string[] }[] = [];
    deps.chamarClaude = async (p) => {
      const t0 = Date.now();
      const r = await chamarClaudeDireto(p);
      resultado.claudeParcial = rodadas;
      rodadas.push({ ms: Date.now() - t0, entrada: r.usage.input_tokens + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0), saida: r.usage.output_tokens, membros: r.content.filter((b) => b.type === "tool_use").map((b) => String(b.name)) });
      return r;
    };
    const propostas: string[] = [];
    deps.esperarAprovacao = async (id) => (propostas.push(id), { status: "vencida", resultado: "" });
    const t0 = Date.now();
    const r = await rodarTarefa({ objetivo, pedido: objetivo }, deps, { ...c, usarClaude: true, roteiros: false, esperaAprovacaoMs: 1, passosMax: 15, modelo: "claude/claude-sonnet-5-5" });
    const p = nav.contexto.pages().filter((x) => x.url().includes("formulario.html")).at(-1);
    resultado.claude = {
      modelo: "claude-sonnet-5-5",
      estado: r.estado,
      resumo: r.resumo,
      ms: Date.now() - t0,
      rodadas,
      tokens: r.tokens,
      acoes: r.acoes,
      propostas: propostas.length,
      paginaDepois: p ? { nome: await p.inputValue("#nome").catch(() => null), valor: await p.inputValue("#valor").catch(() => null), categoria: await p.inputValue("#categoria").catch(() => null), aceito: await p.isChecked("#aceito").catch(() => null), status: await p.textContent("#status").catch(() => null) } : null,
    };
  }, 900_000);
});
