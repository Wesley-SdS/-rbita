import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromiumDeTeste, servirBancada } from "./ambiente";

/**
 * B5 + B6 DE PONTA A PONTA: uma ROTINA (o `runPromptForUser` de verdade, com o
 * modelo trocado por um que chama a tool) lê um site no PERFIL DEDICADO, com a
 * extensão do dono desconectada ("o Chrome do dono fechado"). A mesma ordem
 * mandada ao perfil real é recusada, e agir numa rotina não existe.
 *
 * O perfil dedicado roda num Chromium de teste, numa pasta temporária: nunca
 * no Chrome do dono.
 */

const cfg: Record<string, unknown> = {};
vi.mock("../../../packages/core/src/settings", async () => {
  const { SETTING_DEFS } = await vi.importActual<typeof import("../../../packages/core/src/settings/defs")>("../../../packages/core/src/settings/defs");
  const valor = (k: string) => (k in cfg ? cfg[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]?.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])), set: async (k: string, v: unknown) => void (cfg[k] = v), invalidate: () => undefined } };
});
vi.mock("../../../packages/core/src/settings/apply", () => ({ applyLlmSettings: async () => undefined }));
vi.mock("../../../packages/core/src/owner", () => ({ isOwner: async () => true }));
const pedidoDaRotina: { url: string; acao?: string } = { url: "" };
vi.mock("../../../packages/core/src/llm/gerar", async (orig) => ({
  ...(await orig<object>()),
  // o "modelo" da rotina: chama a tool de leitura com o endereço, e devolve o que ela trouxe
  gerarTexto: async ({ tools }: { tools: Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }> }) => {
    const nomes = Object.keys(tools);
    const lido = await tools.navegador_ler!.execute({ url: pedidoDaRotina.url }, { toolCallId: "t1", messages: [] });
    const agir = tools.navegador_agir ? await tools.navegador_agir.execute({ acao: "clicar", ref: "ref_1" }, { toolCallId: "t2", messages: [] }) : null;
    return { texto: JSON.stringify({ nomes, lido, agir }), modelKey: "teste/rotina" };
  },
}));

const CHROMIUM = chromiumDeTeste();
const usuario = `teste-dedicado-${randomUUID().slice(0, 8)}`;

// o pulo é VISÍVEL: sem o Chrome for Testing o relatório mostra o motivo
if (!CHROMIUM) {
  console.warn("[orbita] dedicado.test.ts PULADO: sem o Chrome for Testing (npx playwright install chromium, ou ORBITA_CHROMIUM_TESTE).");
  describe("perfil dedicado para rotinas (B5, B6)", () => {
    it.skip("PULADO: sem o Chrome for Testing (veja apps/extensao-chrome/README.md, seção Testes)", () => undefined);
  });
}

describe.skipIf(!CHROMIUM)("perfil dedicado para rotinas (B5, B6)", () => {
  let bancada: Awaited<ReturnType<typeof servirBancada>>;
  let pasta: string;
  let core: {
    dedicado: typeof import("../../../packages/core/src/navegador/dedicado");
    ordens: typeof import("../../../packages/core/src/navegador/ordens");
    canal: typeof import("../../../packages/core/src/navegador/canal");
    sites: typeof import("../../../packages/core/src/navegador/sites");
    rotinas: typeof import("../../../packages/core/src/routines/run");
    db: typeof import("../../../packages/db/src/index");
    schema: typeof import("../../../packages/db/src/schema");
  };

  beforeAll(async () => {
    cfg["controle.ativo"] = true;
    cfg["navegador.perfilDedicado"] = true;
    const [dedicado, ordens, canal, sites, rotinas, db, schema] = await Promise.all([
      import("../../../packages/core/src/navegador/dedicado"),
      import("../../../packages/core/src/navegador/ordens"),
      import("../../../packages/core/src/navegador/canal"),
      import("../../../packages/core/src/navegador/sites"),
      import("../../../packages/core/src/routines/run"),
      import("../../../packages/db/src/index"),
      import("../../../packages/db/src/schema"),
    ]);
    core = { dedicado, ordens, canal, sites, rotinas, db, schema };
    await db.db.insert(schema.user).values({ id: usuario, name: "Teste dedicado", email: `${usuario}@orbita.teste` });
    // o dono liberou a bancada para leitura (explícito): é o que deixa a rotina ler por endereço sem aprovação
    await sites.definirSite(usuario, "127.0.0.1", "leitura");
    pasta = mkdtempSync(join(tmpdir(), "orbita-dedicado-"));
    dedicado._fixarOpcoesDoDedicado({ executavel: CHROMIUM!, pasta, visivel: false });
    await ordens.atualizarDisponibilidade();
    bancada = await servirBancada();
  }, 60_000);

  afterAll(async () => {
    await core?.dedicado.fecharDedicado("fim do teste");
    core?.dedicado._fixarOpcoesDoDedicado(null);
    bancada?.server.close();
    if (pasta) rmSync(pasta, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    if (core) await core.db.db.$client`delete from "user" where id = ${usuario}`;
  }, 60_000);

  it("a rotina conclui no perfil dedicado com o Chrome do dono fechado", async () => {
    expect(core.canal.extensaoConectada()).toBe(false);
    expect(core.ordens.navegadorDisponivel()).toBe(true);
    pedidoDaRotina.url = bancada.url("texto-escondido.html");
    const saida = JSON.parse(await core.rotinas.runPromptForUser(usuario, "lê a notícia da chuva", "", { fluxo: "rotina", todas: true })) as { nomes: string[]; lido: { conteudo?: string; erro?: string }; agir: unknown };
    expect(saida.lido.erro).toBeUndefined();
    expect(saida.lido.conteudo).toContain("A chuva voltou a São Paulo");
    expect(saida.lido.conteudo).not.toContain("ORBITA-ESCONDIDO");
    expect(core.dedicado.dedicadoAberto()).toBe(true);
    // com TODAS as tools do turno (a conversa "Eu" usa assim), a de agir está lá e mesmo assim não age
    expect(saida.nomes).toContain("navegador_agir");
    // agir numa rotina não existe: recusado antes de chegar a qualquer navegador
    expect(saida.agir).toMatchObject({ permitido: false, erro: expect.stringMatching(/Rotina e regra só LEEM/) });
  }, 120_000);

  it("a mesma ordem mandada ao perfil real é recusada", async () => {
    await expect(core.ordens.ordemAoNavegador(usuario, { tipo: "abrir", url: bancada.url("texto-escondido.html"), nova: true, grupo: { titulo: "x", cor: "purple" } }, { origem: "rotina", perfil: "real" })).rejects.toThrow(/nunca mexem no seu Chrome/);
  });

  it("o perfil dedicado também recusa site bloqueado do lado dele", async () => {
    cfg["emails.bancos"] = [`localhost:${bancada.porta}`];
    await expect(core.ordens.ordemAoNavegador(usuario, { tipo: "abrir", url: `http://localhost:${bancada.porta}/campo-oculto.html`, nova: true, paraLer: true, grupo: { titulo: "x", cor: "purple" } }, { origem: "rotina" })).rejects.toThrow(/bloqueado/);
    cfg["emails.bancos"] = [];
  });

  it("no perfil dedicado a página mascara senha e cartão igual à extensão", async () => {
    await core.ordens.ordemAoNavegador(usuario, { tipo: "abrir", url: bancada.url("campo-oculto.html"), nova: true, paraLer: true, grupo: { titulo: "x", cor: "purple" } }, { origem: "rotina" });
    const r = await core.ordens.ordemAoNavegador(usuario, { tipo: "ler", modo: "ambos", filtro: "tudo", maxCaracteres: 5000, maxElementos: 100 }, { origem: "rotina" });
    const tudo = JSON.stringify(r.leitura);
    expect(tudo).not.toMatch(/segredo-do-dono-123|4111111111111111|987654|ORBITA-OCULTO/);
    expect(tudo).toContain("[oculto]");
  }, 60_000);

  it("desligado em Ajustes, o perfil dedicado não abre", async () => {
    cfg["navegador.perfilDedicado"] = false;
    await expect(core.ordens.ordemAoNavegador(usuario, { tipo: "abas" }, { origem: "rotina" })).rejects.toThrow(/desligado/);
    cfg["navegador.perfilDedicado"] = true;
  });

  // I-10 da auditoria: o contrato das mãos vale no dedicado também
  it("I-10: sem um envelope que vale agora, o dedicado não age nem abre fora do envelope (só abre para ler)", async () => {
    const agir = { tipo: "agir" as const, acao: "rolar" as const, direcao: "baixo" as const };
    await expect(core.ordens.ordemAoNavegador(usuario, agir, { origem: "rotina" })).rejects.toThrow(/Sem uma sessão/);
    await expect(core.ordens.ordemAoNavegador(usuario, { tipo: "abrir", url: bancada.url("titulo.html"), nova: true, grupo: { titulo: "x", cor: "purple" } }, { origem: "rotina" })).rejects.toThrow(/envelope/);
    // controle: abrir só para ler continua valendo (é o que a rotina faz)
    await expect(core.ordens.ordemAoNavegador(usuario, { tipo: "abrir", url: bancada.url("titulo.html"), nova: true, paraLer: true, grupo: { titulo: "x", cor: "purple" } }, { origem: "rotina" })).resolves.toMatchObject({ aba: expect.any(Number) });
  }, 60_000);

  it("I-10: com o envelope espelhado ele age no site do envelope; o Parar pelo espelho FECHA o dedicado e nada mais mexe", async () => {
    const { espelhar } = await import("../../../packages/core/src/controle/espelho");
    core.dedicado.ligarEspelhoDoDedicado();
    const env = { sessaoId: randomUUID(), alvo: "navegador" as const, objetivo: "x", apps: [], sites: ["127.0.0.1"], tetoPassos: 5, passosUsados: 0, expiraEm: new Date(Date.now() + 600_000).toISOString(), maquina: "pc" };
    await espelhar({ tipo: "envelope", userId: usuario, envelope: env }, 2000);
    await core.ordens.ordemAoNavegador(usuario, { tipo: "abrir", url: bancada.url("formulario.html"), nova: true, grupo: { titulo: "x", cor: "purple" } }, { origem: "rotina" });
    await expect(core.ordens.ordemAoNavegador(usuario, { tipo: "agir", acao: "rolar", direcao: "baixo" }, { origem: "rotina" })).resolves.toMatchObject({ feito: expect.any(String) });
    expect(core.dedicado.dedicadoAberto()).toBe(true);
    await espelhar({ tipo: "parar", userId: usuario, origem: "teste" }, 5000);
    expect(core.dedicado.dedicadoAberto()).toBe(false);
    await expect(core.ordens.ordemAoNavegador(usuario, { tipo: "abrir", url: bancada.url("titulo.html"), nova: true, paraLer: true, grupo: { titulo: "x", cor: "purple" } }, { origem: "rotina" })).rejects.toThrow(/Parar/);
    // um envelope novo (sessão nova) solta o Parar
    await espelhar({ tipo: "envelope", userId: usuario, envelope: { ...env, sessaoId: randomUUID() } }, 2000);
    await expect(core.ordens.ordemAoNavegador(usuario, { tipo: "abrir", url: bancada.url("titulo.html"), nova: true, paraLer: true, grupo: { titulo: "x", cor: "purple" } }, { origem: "rotina" })).resolves.toMatchObject({ aba: expect.any(Number) });
    await espelhar({ tipo: "fim", userId: usuario, sessaoId: "x", status: "encerrada", motivo: "fim" }, 2000);
  }, 90_000);

  it("I-10: uma página com laço infinito não trava a rotina: a leitura falha no prazo e a aba é fechada", async () => {
    cfg["navegador.ordemTimeoutMs"] = 3000;
    await core.ordens.ordemAoNavegador(usuario, { tipo: "abrir", url: bancada.url("laco.html"), nova: true, paraLer: true, grupo: { titulo: "x", cor: "purple" } }, { origem: "rotina" }).catch(() => undefined);
    const inicio = Date.now();
    await expect(core.ordens.ordemAoNavegador(usuario, { tipo: "ler", modo: "ambos", filtro: "tudo", maxCaracteres: 5000, maxElementos: 100 }, { origem: "rotina" })).rejects.toThrow(/não respondeu/);
    expect(Date.now() - inicio).toBeLessThan(15_000);
    delete cfg["navegador.ordemTimeoutMs"];
  }, 60_000);

  it("o perfil dedicado se apaga (cookies e logins): fecha o Chrome e some a pasta", async () => {
    const { existsSync } = await import("node:fs");
    await core.ordens.ordemAoNavegador(usuario, { tipo: "abas" }, { origem: "rotina" });
    expect(existsSync(pasta)).toBe(true);
    const r = await core.dedicado.apagarPerfilDedicado("teste");
    expect(r).toMatchObject({ apagada: true });
    expect(existsSync(pasta)).toBe(false);
    expect(core.dedicado.dedicadoAberto()).toBe(false);
  }, 60_000);
});
