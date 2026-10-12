import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import { orbitaNaPagina, type DescricaoDoAlvo, type Leitura, type PedidoNaPagina, type RespostaNaPagina } from "../../../packages/core/src/navegador/pagina";
import { chromiumDeTeste, servirBancada } from "./ambiente";
import { lerPng, pixelsEscuros } from "./png";

/**
 * O QUE RODA NA PÁGINA (`orbitaNaPagina`), num Chromium de verdade e SEM a
 * extensão: sanitização (I-4), campo sensível (I-5), regex sem explosão
 * (I-15), a máscara conferida nos PIXELS (I-3) e o ponto do clique (B-2). É a
 * mesma função que a extensão e o perfil dedicado injetam.
 */

const CHROMIUM = chromiumDeTeste();
// o esbuild do vitest pode pôr `__name(...)` dentro da função serializada: o mesmo calço do perfil dedicado
const CALCO = "globalThis.__name = globalThis.__name || ((f) => f);";

if (!CHROMIUM) {
  console.warn("[orbita] pagina.test.ts PULADO: sem o Chrome for Testing (npx playwright install chromium, ou ORBITA_CHROMIUM_TESTE). Veja apps/extensao-chrome/README.md.");
  describe("o que roda na página (Chromium de verdade, sem a extensão)", () => {
    it.skip("PULADO: sem o Chrome for Testing (veja apps/extensao-chrome/README.md, seção Testes)", () => undefined);
  });
}

describe.skipIf(!CHROMIUM)("o que roda na página (Chromium de verdade, sem a extensão)", () => {
  let navegador: Browser;
  let bancada: Awaited<ReturnType<typeof servirBancada>>;

  beforeAll(async () => {
    const { chromium } = await import("playwright-core");
    navegador = await chromium.launch({ executablePath: CHROMIUM!, headless: true });
    bancada = await servirBancada();
  }, 60_000);
  afterAll(async () => {
    await navegador?.close();
    bancada?.server.close();
  });

  async function abrir(arquivo: string): Promise<Page> {
    const p = await navegador.newPage({ viewport: { width: 1280, height: 800 } });
    await p.goto(bancada.url(arquivo));
    await p.evaluate(CALCO);
    return p;
  }
  const naPagina = (p: Page, pedido: PedidoNaPagina) => p.evaluate(orbitaNaPagina, pedido) as Promise<RespostaNaPagina>;
  const ler = async (p: Page, filtro: "interativos" | "visiveis" | "tudo" = "tudo") => {
    const r = await naPagina(p, { tipo: "ler", modo: "ambos", filtro, maxElementos: 500, maxCaracteres: 50_000 });
    if (!r.ok || !("leitura" in r)) throw new Error(JSON.stringify(r));
    return r.leitura;
  };
  /** a ref que a própria página deu ao elemento (lida no mapa do mundo onde a função roda) */
  const refDe = (p: Page, seletor: string) => p.evaluate((s) => (globalThis as unknown as { __orbita: { porElemento: WeakMap<Element, string> } }).__orbita.porElemento.get(document.querySelector(s)!) ?? null, seletor);
  const descrever = async (p: Page, ref: string): Promise<DescricaoDoAlvo> => {
    const r = await naPagina(p, { tipo: "descrever", ref });
    if (!r.ok || !("alvo" in r)) throw new Error(JSON.stringify(r));
    return r.alvo;
  };

  describe("I-4: texto escondido não sai da página", () => {
    it("nenhum dos 23 jeitos de esconder chega; o texto visível chega", async () => {
      const p = await abrir("texto-escondido.html");
      const l: Leitura = await ler(p);
      const vazados = [...(l.texto ?? "").matchAll(/ORBITA-ESCONDIDO-\d+/g)].map((m) => m[0]);
      expect(vazados).toEqual([]);
      expect(l.texto).toContain("A chuva voltou a São Paulo");
      expect(l.texto).toContain("A Defesa Civil recomenda cuidado");
      // controle: um bloco com fundo próprio e texto escuro continua legível
      expect(l.texto).toContain("O alerta vale até domingo");
      // o resumo do <details> fechado aparece; o conteúdo dele, não
      expect(l.texto).toContain("Mais detalhes");
      expect(l.escondidos).toBeGreaterThanOrEqual(15);
      await p.close();
    }, 30_000);

    it("controle: o texto abaixo da dobra numa área que ROLA (o app inteiro num overflow:hidden de 100vh) continua sendo lido", async () => {
      const p = await navegador.newPage({ viewport: { width: 800, height: 400 } });
      await p.setContent(`<body style="margin:0"><div style="height:100vh;overflow:hidden"><div style="height:100%;overflow:auto"><p style="margin-top:2000px">TEXTO-ABAIXO-DA-DOBRA</p></div></div></body>`);
      await p.evaluate(CALCO);
      expect((await ler(p)).texto).toContain("TEXTO-ABAIXO-DA-DOBRA");
      await p.close();
    }, 30_000);
  });

  describe("I-5: campo de código, token, validade e cartão são sensíveis", () => {
    it.each(["#s1", "#s2", "#s3", "#s4", "#s5", "#s6", "#s7", "#o1", "#s8", "#s9", "#s10"])("%s é sensível", async (sel) => {
      const p = await abrir("sensivel.html");
      await ler(p);
      expect((await descrever(p, (await refDe(p, sel))!)).sensivel).toBe(true);
      await p.close();
    }, 30_000);

    it.each(["#c1", "#c2", "#c3", "#c4", "#c5"])("controle: %s não é", async (sel) => {
      const p = await abrir("sensivel.html");
      await ler(p);
      expect((await descrever(p, (await refDe(p, sel))!)).sensivel).toBe(false);
      await p.close();
    }, 30_000);

    it("nenhum valor sensível sai na leitura (nem o texto do contenteditable nem o do textarea); o detector de 2FA usa as mesmas pistas", async () => {
      const p = await abrir("sensivel.html");
      const l = await ler(p);
      const tudo = JSON.stringify(l);
      expect(tudo).not.toMatch(/ORBITA-SENSIVEL-\d+/);
      expect(tudo).not.toContain("4111 1111 1111 1111");
      expect(tudo).toContain("Wesley");
      expect(tudo).toContain("Texto visível do comentário");
      expect(l.bloqueio).toBe("2fa");
      await p.close();
    }, 30_000);
  });

  describe("I-15: regex sem explosão", () => {
    it("um <label> com 'cod' repetido 20 mil vezes não trava a página", async () => {
      const p = await navegador.newPage();
      await p.setContent(`<label>${"cod".repeat(20000)} <input id="x"></label><label>Código ${"a".repeat(50000)} seg <input id="y"></label>`);
      await p.evaluate(CALCO);
      const inicio = Date.now();
      await ler(p);
      const alvo = await descrever(p, (await refDe(p, "#x"))!);
      await descrever(p, (await refDe(p, "#y"))!);
      expect(Date.now() - inicio).toBeLessThan(1500);
      expect(typeof alvo.sensivel).toBe("boolean");
      await p.close();
    }, 30_000);
  });

  describe("I-3: a máscara apaga o glifo de verdade (conferido nos pixels)", () => {
    it("senha, cartão e contenteditable sensível ficam sem nenhum pixel de texto; sem máscara, o texto está lá", async () => {
      const p = await navegador.newPage({ viewport: { width: 900, height: 500 } });
      await p.setContent(`<style>body{margin:0;background:#fff} .c{display:block;position:absolute;left:10px;width:800px;height:90px;font:700 60px monospace;color:#000;background:#fff;border:0;outline:0}</style>
        <input class="c" id="senha" type="password" value="segredo" style="top:10px">
        <input class="c" id="cartao" name="cardnumber" value="4111 1111 1111 1111" style="top:110px">
        <div class="c" id="cofre" contenteditable="true" aria-label="Senha do cofre" style="top:210px">segredo</div>
        <input class="c" id="nome" value="Wesley" style="top:310px">`);
      await p.evaluate(CALCO);
      const regiao = async (id: string) => {
        const b = (await p.locator(`#${id}`).boundingBox())!;
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      // sem máscara (controle): o texto está nos pixels (o campo de senha já desenha bolinhas: elas também contam)
      const antes = lerPng(await p.screenshot({ type: "png" }));
      for (const id of ["senha", "cartao", "cofre", "nome"]) expect(pixelsEscuros(antes, await regiao(id))).toBeGreaterThan(50);
      expect(await naPagina(p, { tipo: "mascarar", ligar: true })).toMatchObject({ ok: true });
      const depois = lerPng(await p.screenshot({ type: "png" }));
      for (const id of ["senha", "cartao", "cofre"]) expect(pixelsEscuros(depois, await regiao(id))).toBe(0);
      // o campo comum continua legível na captura
      expect(pixelsEscuros(depois, await regiao("nome"))).toBeGreaterThan(50);
      // e a sombra que desenhava o glifo em cinza não existe mais
      expect(await p.evaluate(() => getComputedStyle(document.getElementById("cartao")!).textShadow)).toBe("none");
      await naPagina(p, { tipo: "mascarar", ligar: false });
      await p.close();
    }, 30_000);
  });

  describe("B-2: o clique cai no alvo, não no que está por cima ou dentro dele", () => {
    it("o botão dentro do card tem ref própria; preparar o card escolhe um ponto do card, longe do Excluir", async () => {
      const p = await abrir("card.html");
      const l = await ler(p, "interativos");
      const card = l.elementos!.find((e) => e.nome === "Ver detalhes");
      const excluir = l.elementos!.find((e) => e.nome === "Excluir");
      expect(card).toBeDefined();
      expect(excluir).toBeDefined();
      expect(excluir!.ref).not.toBe(card!.ref);
      const r = await naPagina(p, { tipo: "preparar", ref: card!.ref, assinatura: { papel: card!.papel, nome: card!.nome }, acao: "clicar", agindoMs: 0 });
      if (!r.ok || !("alvo" in r)) throw new Error(JSON.stringify(r));
      const noPonto = await p.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.id, [r.alvo.centro.x, r.alvo.centro.y]);
      expect(noPonto).toBe("card");
      // e um clique ali, de verdade, abre os detalhes, não exclui
      await p.mouse.click(r.alvo.centro.x, r.alvo.centro.y);
      expect(await p.textContent("#status")).toBe("detalhes abertos");
      await p.close();
    }, 30_000);

    it("um aviso cobrindo a página inteira: tela_mudou, nada é clicado", async () => {
      const p = await abrir("modal.html");
      const l = await ler(p, "interativos");
      const meio = l.elementos!.find((e) => e.nome === "Ver ofertas")!;
      await p.evaluate(() => (window as unknown as { abrirCookies: () => void }).abrirCookies());
      const r = await naPagina(p, { tipo: "preparar", ref: meio.ref, assinatura: { papel: meio.papel, nome: meio.nome }, acao: "clicar", agindoMs: 0 });
      expect(r).toMatchObject({ ok: false, codigo: "tela_mudou" });
      await p.close();
    }, 30_000);

    it("o cabeçalho fixo cobre metade do botão: o ponto escolhido fica na metade de fora", async () => {
      const p = await abrir("modal.html");
      const l = await ler(p, "interativos");
      const topo = l.elementos!.find((e) => e.nome === "Ver carrinho")!;
      const r = await naPagina(p, { tipo: "preparar", ref: topo.ref, assinatura: { papel: topo.papel, nome: topo.nome }, acao: "clicar", agindoMs: 0 });
      if (!r.ok || !("alvo" in r)) throw new Error(JSON.stringify(r));
      expect(await p.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.id, [r.alvo.centro.x, r.alvo.centro.y])).toBe("topo");
      await p.close();
    }, 30_000);

    it("o alvo de roteiro só com seletor acha ELE, e não o primeiro botão da página", async () => {
      const p = await abrir("modal.html");
      const r = await naPagina(p, { tipo: "achar", papel: "button", nome: null, texto: null, seletor: "#meio" });
      expect(r).toMatchObject({ ok: true, alvo: { nome: "Ver ofertas" } });
      await p.close();
    }, 30_000);
  });
});
