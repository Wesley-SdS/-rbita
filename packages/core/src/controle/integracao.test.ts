import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/**
 * O CICLO INTEIRO da sessão de controle contra o Postgres REAL (PRD F2 e F3):
 * propor, aprovar falando "manda", agir dentro do envelope, recusar fora
 * dele, estourar o teto e pausar, comando elevado a perigoso que a frase não
 * aprova, vetos do crítico que pausam e avisam, e o parar que corta tudo.
 * O modelo (crítico) e as mãos são simulados; fila, trilha e sessão são as de
 * verdade, com o SQL de verdade (contagem atômica de passos, troca de status).
 *
 * Desligado por padrão, para a suíte comum não depender de banco. Liga com:
 *
 *   ORBITA_E2E_DB=1 node ./node_modules/vitest/vitest.mjs run packages/core/src/controle/integracao.test.ts
 *
 * Cria um usuário temporário e o apaga no fim (as tabelas caem por cascade).
 */

const LIGADO = process.env.ORBITA_E2E_DB === "1";

function usarEnvDoApp() {
  for (const caminho of [resolve(process.cwd(), "apps/web/.env"), resolve(process.cwd(), "../web/.env"), resolve(process.cwd(), "../../apps/web/.env")]) {
    if (!existsSync(caminho)) continue;
    for (const linha of readFileSync(caminho, "utf-8").split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim());
      if (m && ["DATABASE_URL", "BETTER_AUTH_SECRET", "CONNECTORS_ENC_KEY"].includes(m[1]!)) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
    return;
  }
}

// config da casa: o controle ligado (o padrão é desligado); o resto, o padrão
vi.mock("../settings", async () => {
  const { SETTING_DEFS } = await vi.importActual<typeof import("../settings/defs")>("../settings/defs");
  const fixo: Record<string, unknown> = { "controle.ativo": true, "controle.espelhoTimeoutMs": 200 };
  const valor = (k: string) => (k in fixo ? fixo[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]?.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])) } };
});
// o dono da instância de verdade é outra conta: aqui, o usuário temporário é o dono
vi.mock("../owner", () => ({ isOwner: async () => true }));
// eventos e avisos não vão para o outbox nem para o celular do dono
const emit = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../events/index", () => ({ events: { emit } }));
const notifyUser = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../routines/run", () => ({ notifyUser }));

describe.skipIf(!LIGADO)("sessão de controle contra o Postgres real", () => {
  let M: Awaited<ReturnType<typeof modulos>>;
  let userId = "";
  const espelho: { tipo: string; status?: string }[] = [];
  let veredito = { alinhado: true, motivo: "serve ao pedido" };
  const cliques = vi.fn(async (_i: unknown) => ({ mensagem: "cliquei" }));

  async function modulos() {
    const { db } = await import("@orbita/db");
    const { user } = await import("@orbita/db/auth-schema");
    const { actionQueue } = await import("@orbita/db/action-schema");
    const ctl = await import("@orbita/db/controle-schema");
    const orm = await import("drizzle-orm");
    return {
      db, user, actionQueue, ctl, orm,
      tools: await import("../tools/index"),
      aprovar: await import("../actions/aprovar"),
      frase: await import("../actions/por-frase"),
      guarda: await import("./guarda"),
      sessao: await import("./sessao"),
      trilha: await import("./trilha"),
      parar: await import("./parar"),
      espelho: await import("./espelho"),
    };
  }

  beforeAll(async () => {
    usarEnvDoApp();
    M = await modulos();
    userId = `e2e-controle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await M.db.insert(M.user).values({ id: userId, name: "E2E Controle", email: `${userId}@teste.local`, emailVerified: true });
    M.espelho.registrarEspelho({ nome: "maos-teste", notificar: async (e) => void espelho.push({ tipo: e.tipo, status: e.tipo === "fim" ? e.status : undefined }) });
    const { autorizarNaSessao } = M.sessao;
    if (!M.tools.getTool("computador_teste_agir")) {
      M.tools.registerTools([
        {
          name: "computador_teste_agir", domain: "computador", description: "Clica num app (teste).", risk: "escrita",
          inputSchema: z.object({ acao: z.string(), app: z.string() }),
          authorize: (i: { app: string }, ctx) => autorizarNaSessao(ctx, { tipo: "computador", app: i.app }),
          run: (i: unknown) => cliques(i),
        },
        {
          name: "terminal_teste_rodar", domain: "terminal", description: "Roda um comando (teste).", risk: "leitura",
          inputSchema: z.object({ comando: z.string() }),
          elevarRisco: async ({ comando }: { comando: string }) => (/Remove-Item|rm -r/.test(comando) ? "perigoso" : /^pnpm/.test(comando) ? "efeito_externo" : "leitura"),
          run: async ({ comando }: { comando: string }) => ({ saida: `rodei ${comando}` }),
        },
      ]);
    }
  });

  afterAll(async () => {
    if (userId) await M.db.delete(M.user).where(M.orm.eq(M.user.id, userId));
    M?.espelho._limparEspelhos();
  });

  const opts = (canal: "voz" | "tela" = "voz") => ({ enqueue: M.tools.enqueueFor(userId, canal), guarda: M.guarda.criarGuarda(async () => veredito) });
  const ctx = (canal: "voz" | "tela" = "voz", pedido?: string) => ({ userId, canal, pedido });
  const chamar = (nome: string, entrada: unknown, canal: "voz" | "tela" = "voz", pedido?: string) => M.tools.executarChamada(M.tools.getTool(nome)!, entrada, ctx(canal, pedido), opts(canal));
  const sessaoAtual = () => M.sessao.sessaoAtual(userId, true);
  const pendentes = () => M.db.select().from(M.actionQueue).where(M.orm.and(M.orm.eq(M.actionQueue.userId, userId), M.orm.eq(M.actionQueue.status, "pending")));

  it("ciclo: sem sessão recusa; propõe; 'manda' abre; age; fora do envelope recusa; teto pausa", async () => {
    // 1. sem sessão
    const semSessao = (await chamar("computador_teste_agir", { acao: "clicar", app: "VS Code" })) as { permitido: boolean; erro: string };
    expect(semSessao.permitido).toBe(false);
    expect(semSessao.erro).toMatch(/controle_iniciar/);
    expect(cliques).not.toHaveBeenCalled();
    expect((await M.trilha.listarPassos(userId, null)).map((p) => p.decisao)).toContain("recusado");

    // 2. propor: o pedido literal é o do canal, e o risco vai no payload
    const proposta = (await chamar("controle_iniciar", { objetivo: "rodar os testes", alvo: "computador", apps: ["VS Code"], tetoPassos: 2 }, "voz", "abre o VS Code e roda os testes")) as { id: string };
    const [linha] = await M.db.select().from(M.actionQueue).where(M.orm.eq(M.actionQueue.id, proposta.id));
    expect(linha!.payload).toMatchObject({ risco: "efeito_externo", pedidoOriginal: "abre o VS Code e roda os testes", pedidoLiteral: true, apps: ["VS Code"], tetoPassos: 2, canal: "voz" });
    expect((await M.trilha.listarPassos(userId, null)).find((p) => p.acaoId === proposta.id)?.decisao).toBe("na_fila");

    // 3. "manda" falado abre a sessão (decisão do dono de 10/10)
    expect(await M.frase.aprovarPorFrase(userId, "voz", "manda", new Date(Date.now() - 60_000))).toMatchObject({ estado: "enviado" });
    const s = await sessaoAtual();
    expect(s).toMatchObject({ status: "ativa", objetivo: "rodar os testes", tetoPassos: 2, pedidoLiteral: true, apps: ["VS Code"] });
    expect(espelho.at(-1)).toEqual({ tipo: "envelope", status: undefined });
    expect(emit).toHaveBeenCalledWith("controle.sessao_iniciada", expect.objectContaining({ sessaoId: s!.id }), { userId });
    // o passo que esperava na fila virou o passo executado (uma linha por ação)
    expect((await M.trilha.listarPassos(userId, null)).filter((p) => p.acaoId === proposta.id).map((p) => p.decisao)).toEqual(["executado"]);

    // 4. agir dentro do envelope, duas vezes
    expect(await chamar("computador_teste_agir", { acao: "clicar", app: "vs code" })).toEqual({ mensagem: "cliquei" });
    expect(await chamar("computador_teste_agir", { acao: "digitar", app: "Code" })).toMatchObject({ permitido: false }); // "Code" não é "VS Code"
    expect(await chamar("computador_teste_agir", { acao: "clicar", app: "VS Code" })).toEqual({ mensagem: "cliquei" });
    expect(cliques).toHaveBeenCalledTimes(2);
    const trilha = await M.trilha.listarPassos(userId, s!.id);
    expect(trilha.map((p) => p.decisao).sort()).toEqual(["executado", "executado", "recusado"]);
    expect((await sessaoAtual())!.passosUsados).toBe(2);

    // 5. o terceiro passou do teto: recusa e a sessão pausa
    expect(await chamar("computador_teste_agir", { acao: "clicar", app: "VS Code" })).toMatchObject({ permitido: false });
    expect(cliques).toHaveBeenCalledTimes(2);
    expect((await sessaoAtual())!.status).toBe("pausada");
    expect(espelho.at(-1)).toEqual({ tipo: "fim", status: "pausada" });
  });

  it("comando elevado a perigoso: vai para a fila e o 'manda' não o aprova; leitura roda avulsa com trilha", async () => {
    const r = (await chamar("terminal_teste_rodar", { comando: "Remove-Item -Recurse C:\\x" })) as { id: string; resumo: string };
    expect(r.resumo).toMatch(/só se aprova pela tela/);
    const [linha] = await M.db.select().from(M.actionQueue).where(M.orm.eq(M.actionQueue.id, r.id));
    expect(linha!.payload).toMatchObject({ risco: "perigoso" });
    expect(await M.frase.aprovarPorFrase(userId, "voz", "manda", new Date(Date.now() - 60_000))).toMatchObject({ estado: "so_na_tela" });
    expect((await pendentes()).map((p) => p.id)).toContain(r.id);

    expect(await chamar("terminal_teste_rodar", { comando: "git status" })).toEqual({ saida: "rodei git status" });
    const avulsos = await M.trilha.listarPassos(userId, null);
    expect(avulsos.find((p) => p.tool === "terminal_teste_rodar" && p.decisao === "executado")).toMatchObject({ alvo: { comando: "git status" }, risco: "leitura" });
  });

  it("dois vetos seguidos do crítico pausam a sessão nova e avisam; envelope novo encerra o anterior", async () => {
    const p = (await chamar("controle_iniciar", { objetivo: "abrir o projeto", alvo: "computador", apps: ["VS Code"] }, "tela", "abre o projeto")) as { id: string };
    expect(await M.aprovar.aprovarAcao(userId, p.id)).toMatchObject({ ok: true });
    const s = await sessaoAtual();
    expect(s!.status).toBe("ativa");
    const anteriores = await M.sessao.listarSessoes(userId);
    expect(anteriores.filter((x) => x.id !== s!.id).every((x) => x.status === "encerrada")).toBe(true);

    veredito = { alinhado: false, motivo: "apagar não foi pedido" };
    expect(await chamar("computador_teste_agir", { acao: "clicar", app: "VS Code" }, "tela")).toMatchObject({ vetado: true });
    expect(await chamar("computador_teste_agir", { acao: "clicar", app: "VS Code" }, "tela")).toMatchObject({ vetado: true });
    veredito = { alinhado: true, motivo: "ok" };
    expect((await sessaoAtual())!.status).toBe("pausada");
    expect(notifyUser).toHaveBeenCalledWith(userId, "A Órbita pausou o controle do PC", expect.stringContaining("apagar não foi pedido"), null, expect.anything());
    expect((await M.trilha.listarPassos(userId, s!.id)).filter((x) => x.decisao === "vetado")).toHaveLength(2);
  });

  it("parar: sessão vira parada, proposta do controle na fila é cancelada, as mãos ouvem", async () => {
    const p = (await chamar("controle_iniciar", { objetivo: "rodar o build", alvo: "computador", apps: ["VS Code"] }, "tela", "roda o build")) as { id: string };
    await M.aprovar.aprovarAcao(userId, p.id);
    expect((await sessaoAtual())!.status).toBe("ativa");
    expect((await pendentes()).length).toBeGreaterThan(0); // o Remove-Item do teste anterior

    expect(await M.frase.aprovarPorFrase(userId, "voz", "Órbita, para!", null)).toMatchObject({ estado: "parado" });
    expect(await sessaoAtual()).toBeNull();
    expect((await M.sessao.listarSessoes(userId))[0]!.status).toBe("parada");
    expect(await pendentes()).toEqual([]);
    expect(espelho.some((e) => e.tipo === "parar")).toBe(true);
    expect(emit).toHaveBeenCalledWith("controle.parado", expect.objectContaining({ origem: "voz" }), { userId });
    // sem sessão aberta, "para" volta a ser conversa
    expect(await M.parar.pararPorFrase(userId, "voz", "para")).toBeNull();
  });
});
