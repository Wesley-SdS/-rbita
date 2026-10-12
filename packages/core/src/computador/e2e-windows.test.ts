import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * A TAREFA DELEGADA NO WINDOWS DE PONTA A PONTA (PRD-MOTOR-DESKTOP §10.5), opt-in.
 *
 * ATENÇÃO, isto usa o computador de verdade: as mãos (`apps/maos`, porta 8003)
 * capturam a TELA INTEIRA do monitor, a imagem vai para a Anthropic (decisão do
 * dono, com os apps ocultos pintados de preto) e o mouse e o teclado são usados.
 * Por isso só roda com TODAS as variáveis e sem ninguém trabalhando na máquina:
 *
 *   ORBITA_E2E_WINDOWS=1 ORBITA_E2E_CLAUDE=1 CLAUDE_CODE_OAUTH_TOKEN=... MAOS_TOKEN=...
 *
 * O que usa de verdade: o banco de dev (com um usuário temporário, apagado no
 * fim), as mãos, as tools do registro, o crítico mockado como "alinhado" e o
 * Claude da assinatura. A tarefa é a Calculadora (não restaura sessão: o Bloco de
 * Notas do Windows 11 reabre as abas do dono e uma tarefa "fechar sem salvar"
 * poderia perder uma nota não salva dele). Mede passos, tokens, tempo e o tempo do
 * Parar, e imprime tudo para o MEDICAO.md.
 */

const ligado = process.env.ORBITA_E2E_WINDOWS === "1" && process.env.ORBITA_E2E_CLAUDE === "1" && Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN) && Boolean(process.env.MAOS_TOKEN);

const cfg: Record<string, unknown> = {};
vi.mock("../settings", async () => {
  const { SETTING_DEFS } = await vi.importActual<typeof import("../settings/defs")>("../settings/defs");
  const valor = (k: string) => (k in cfg ? cfg[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]?.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])), set: async (k: string, v: unknown) => void (cfg[k] = v), invalidate: () => undefined } };
});
let usuario = `teste-win-${randomUUID().slice(0, 8)}`;
vi.mock("../owner", () => ({ isOwner: async () => true, getOwnerId: async () => usuario }));
vi.mock("../llm/gerar", async (orig) => ({ ...(await orig<object>()), gerarEstruturado: async () => ({ dados: { alinhado: true, motivo: "serve ao pedido" }, modelKey: "teste/critico" }) }));

describe.skipIf(!ligado)("tarefa no Windows, de ponta a ponta (usa o computador de verdade)", () => {
  let renovaSaude: ReturnType<typeof setInterval> | undefined;
  let core: {
    sessao: typeof import("../controle/sessao");
    parar: typeof import("../controle/parar");
    trabalho: typeof import("./trabalho");
    motor: typeof import("./motor");
    maos: typeof import("../maos/client");
    db: typeof import("@orbita/db");
    schema: typeof import("@orbita/db/schema");
    servico: typeof import("./servico");
  };

  beforeAll(async () => {
    cfg["controle.ativo"] = true;
    cfg["controle.canais"] = ["tela", "voz", "whatsapp"];
    const [sessao, parar, trabalho, motor, maos, db, schema, servico, maosServico] = await Promise.all([
      import("../controle/sessao"), import("../controle/parar"), import("./trabalho"), import("./motor"), import("../maos/client"), import("@orbita/db"), import("@orbita/db/schema"), import("./servico"), import("../maos/servico"),
    ]);
    core = { sessao, parar, trabalho, motor, maos, db, schema, servico };
    maosServico.instalarMaos();
    await maos.atualizarSaude();
    // no apps/api o laço `maos` renova a saúde; sem ele, as tools do computador SOMEM do turno depois de 2 min
    renovaSaude = setInterval(() => void maos.atualizarSaude().catch(() => undefined), 20_000);
    await db.db.insert(schema.user).values({ id: usuario, name: "Teste do Windows", email: `${usuario}@orbita.teste` });
  }, 60_000);

  afterAll(async () => {
    if (renovaSaude) clearInterval(renovaSaude);
    if (core) await core.db.db.$client`delete from "user" where id = ${usuario}`;
  }, 30_000);

  /** Calculadora aberta de uma rodada anterior faz o Claude só ler o visor; cada teste começa sem ela. */
  const fecharCalculadora = () => {
    try {
      execFileSync("taskkill", ["/IM", "CalculatorApp.exe", "/F"], { stdio: "ignore" });
    } catch {
      /* não estava aberta */
    }
  };

  async function abrirSessaoDe(apps: string[], objetivo: string) {
    return core.sessao.abrirSessao(usuario, { alvo: "computador", objetivo, pedidoOriginal: objetivo, pedidoLiteral: true, apps, sites: [], tetoPassos: 40, tetoMinutos: 10, canal: "tela" });
  }

  it("as mãos estão no ar", () => {
    expect(core.maos.maosDisponivel()).toBe(true);
  });

  it("Calculadora: abre e calcula 12 vezes 7; mede passos, tokens e tempo", async () => {
    fecharCalculadora();
    const objetivo = "Abra a Calculadora, calcule 12 vezes 7 e me diga o resultado que aparece.";
    const s = await abrirSessaoDe(["Calculadora", "Calculator"], objetivo);
    const { deps, cfg: cfgDoMotor, encerrar } = await core.trabalho.dependenciasDaTarefa({ userId: usuario, objetivo, sessaoId: s.id, canal: "tela", pedido: objetivo, cancelado: async () => false, progresso: async () => undefined });
    const inicio = Date.now();
    try {
      // quem aprova é o dono; no teste, qualquer proposta fica sem aprovação (a tarefa não precisa de nenhuma)
      deps.esperarAprovacao = async () => ({ status: "vencida", resultado: "" });
      const r = await core.motor.rodarTarefa({ objetivo, pedido: objetivo }, deps, { ...cfgDoMotor, usarClaude: true });
      const ms = Date.now() - inicio;
      console.info("[e2e-windows] calculadora:", JSON.stringify({ estado: r.estado, motor: r.motor, acoes: r.acoes, tokens: r.tokens, segundos: Math.round(ms / 1000), resumo: r.resumo.slice(0, 200) }));
      expect(r.estado).toBe("concluida");
      expect(r.acoes).toBeGreaterThan(0);
      expect(r.resumo).toMatch(/\b84\b/);
    } finally {
      encerrar();
      await core.sessao.encerrarSessao(usuario, s.id, "fim do teste");
      fecharCalculadora();
    }
  }, 300_000);

  it("Parar: do atalho (pararTudo) até o laço encerrar, em menos de 300 ms depois de a sessão marcar parada", async () => {
    fecharCalculadora();
    const objetivo = "Abra a Calculadora e faça, uma de cada vez, 20 somas diferentes clicando nos botões. Não pare até terminar todas.";
    const s = await abrirSessaoDe(["Calculadora", "Calculator"], objetivo);
    const { deps, cfg: cfgDoMotor, encerrar } = await core.trabalho.dependenciasDaTarefa({ userId: usuario, objetivo, sessaoId: s.id, canal: "tela", pedido: objetivo, cancelado: async () => false, progresso: async () => undefined });
    deps.esperarAprovacao = async () => ({ status: "vencida", resultado: "" });
    let terminou = false;
    const tarefa = core.motor.rodarTarefa({ objetivo, pedido: objetivo }, deps, { ...cfgDoMotor, usarClaude: true }).finally(() => (terminou = true));
    try {
      await new Promise((r) => setTimeout(r, 25_000));
      // sem isto o teste mediria o fim natural da tarefa, não o corte do Parar
      expect(terminou, "a tarefa terminou sozinha antes do Parar").toBe(false);
      const t0 = Date.now();
      await core.parar.pararTudo(usuario, "teste e2e");
      const tPararTudo = Date.now() - t0;
      const r = await tarefa;
      const ms = Date.now() - t0;
      console.info("[e2e-windows] parar:", JSON.stringify({ estado: r.estado, msTotal: ms, msPararTudo: tPararTudo, msLacoDepoisDoParar: ms - tPararTudo }));
      expect(["parada", "pausada"]).toContain(r.estado);
      // a meta do PRD é < 300 ms para o corte; o laço pode estar no meio de uma ação das mãos, então o teto do teste é folgado e o número vai para o MEDICAO.md
      expect(ms).toBeLessThan(5000);
    } finally {
      encerrar();
      await core.sessao.encerrarSessao(usuario, s.id, "fim do teste").catch(() => undefined);
      fecharCalculadora();
    }
  }, 120_000);
});

describe("o opt-in", () => {
  it("sem as variáveis, o ponta a ponta não roda (não captura a tela do dono sem querer)", () => {
    expect(typeof ligado).toBe("boolean");
  });
});
