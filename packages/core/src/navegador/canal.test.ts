import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O CANAL DA EXTENSÃO sem rede (PRD §5.2, B1): quem conecta, o pareamento por
 * código, o token na primeira mensagem, as ordens com resposta e prazo, a
 * revogação, o espelho do envelope e o que acontece quando o dono mexe ou
 * aperta Parar na aba.
 */

const cfg: Record<string, unknown> = {};
vi.mock("../settings", async () => {
  const { SETTING_DEFS } = await vi.importActual<typeof import("../settings/defs")>("../settings/defs");
  const valor = (k: string) => (k in cfg ? cfg[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]?.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])), set: async (k: string, v: unknown) => void (cfg[k] = v) } };
});
const tokens = new Map<string, { id: string; userId: string }>();
const revogadosPorId: string[] = [];
/** atraso do banco ao conferir o token: é nele que o socket pode fechar (a conexão fantasma) */
const atraso = { ms: 0 };
vi.mock("./pareamento", async (orig) => ({
  ...(await orig<object>()),
  extensaoDoToken: async (t: string) => {
    if (atraso.ms) await new Promise((r) => setTimeout(r, atraso.ms));
    return tokens.get(t) ?? null;
  },
  marcarVista: async () => undefined,
  revogarPorId: async (id: string) => {
    revogadosPorId.push(id);
    for (const [k, v] of tokens) if (v.id === id) tokens.delete(k);
    return true;
  },
  registrarExtensao: async (userId: string, _n: string, _v: string, anterior?: string | null) => {
    const revogadas: string[] = [];
    if (anterior && tokens.has(anterior)) {
      revogadas.push(tokens.get(anterior)!.id);
      tokens.delete(anterior);
    }
    const token = `token-${tokens.size + 1}-${"x".repeat(40)}`;
    tokens.set(token, { id: `ext-${tokens.size + 1}`, userId });
    return { token, extensao: { id: `ext-${tokens.size}` }, revogadas };
  },
}));
vi.mock("./sites", async (orig) => ({ ...(await orig<object>()), regrasDeSite: async () => ({ categorias: ["bancos"], bancos: ["itau.com.br"], origensDaOrbita: [], padrao: "leitura", linhas: [] }) }));
const sessao = { atual: null as null | { id: string; objetivo: string; sites: string[]; expiraEm: Date; tetoPassos: number; passosUsados: number } };
const pausadas: string[] = [];
const pausadasPorId: string[] = [];
/** as sessões que já existiram, com o status de agora (para o Parar que chega atrasado) */
const historico = new Map<string, string>();
vi.mock("../controle/sessao", () => ({
  sessaoParaTipo: async () => sessao.atual,
  sessaoPorId: async (_u: string, id: string) => (historico.has(id) ? { id, status: historico.get(id) } : null),
  pausarSessao: async (_u: string, id: string, motivo: string) => {
    pausadasPorId.push(id);
    // como no banco: só a sessão ATIVA pausa
    if (historico.has(id) && historico.get(id) !== "ativa") return null;
    pausadas.push(motivo);
    return { id };
  },
}));
// o banco só para o estado do /health: há uma extensão pareada (token valendo)?
const pareadas = { linhas: [] as { id: string }[] };
vi.mock("@orbita/db", () => {
  const cadeia: Record<string, unknown> = {};
  for (const m of ["from", "where", "limit"]) cadeia[m] = () => cadeia;
  cadeia.then = (ok: (v: unknown) => unknown) => Promise.resolve(pareadas.linhas).then(ok);
  return { db: { select: () => cadeia } };
});
const paradas: string[] = [];
vi.mock("../controle/parar", () => ({ pararTudo: async (_u: string, origem: string) => void paradas.push(origem) }));

const canal = await import("./canal");
const { gerarCodigo, _limparCodigo, consumirCodigo, hashDoToken } = await import("./pareamento");
const { espelhar, _limparEspelhos } = await import("../controle/espelho");
const { triagemDoUpgrade } = await import("./servidor");
const { ERROS_POR_ORIGEM, ERROS_GLOBAIS } = await import("./pareamento");

const ID = "cbjgpcknhpiklccdmhcodnhddpmogjcd";
const ORIGEM = `chrome-extension://${ID}`;

function conexao(meta: { origin: string | null; ponte: boolean; origemDaPonte?: string | null } = { origin: ORIGEM, ponte: false }) {
  const recebidas: Record<string, unknown>[] = [];
  const fechada: { codigo?: number; motivo?: string } = {};
  const h = canal.aoConectar({ enviar: (m) => void recebidas.push(m as Record<string, unknown>), fechar: (codigo, motivo) => Object.assign(fechada, { codigo, motivo }) }, meta);
  return { h, recebidas, fechada, mandar: (m: unknown) => h.receber(JSON.stringify(m)) };
}

beforeEach(() => {
  canal._limparConexoes();
  _limparEspelhos();
  _limparCodigo();
  tokens.clear();
  for (const k of Object.keys(cfg)) delete cfg[k];
  cfg["navegador.extensaoId"] = ID;
  sessao.atual = null;
  pausadas.length = 0;
  pausadasPorId.length = 0;
  paradas.length = 0;
  revogadosPorId.length = 0;
  historico.clear();
  atraso.ms = 0;
});

describe("quem conecta", () => {
  it("Origin de outra extensão, de página web ou ausente (sem ponte): recusado", () => {
    expect(canal.conferirOrigem({ origin: "https://atacante.example", ponte: false }, ID, false)).toMatchObject({ ok: false });
    expect(canal.conferirOrigem({ origin: `chrome-extension://${"a".repeat(32)}`, ponte: false }, ID, false)).toMatchObject({ ok: false });
    expect(canal.conferirOrigem({ origin: null, ponte: false }, ID, false)).toMatchObject({ ok: false });
    expect(canal.conferirOrigem({ origin: ORIGEM, ponte: false }, ID, false)).toMatchObject({ ok: true });
    // sem ID configurado, só o pareamento passa (e é ele que grava o ID)
    expect(canal.conferirOrigem({ origin: ORIGEM, ponte: false }, "", false)).toMatchObject({ ok: false });
    expect(canal.conferirOrigem({ origin: ORIGEM, ponte: false }, "", true)).toMatchObject({ ok: true, idVisto: ID });
    // a ponte (já com o segredo conferido) só vale com a origem que o Chrome lhe deu, e tem de ser a configurada
    expect(canal.conferirOrigem({ origin: null, ponte: true, origemDaPonte: ORIGEM }, ID, false)).toMatchObject({ ok: true });
    expect(canal.conferirOrigem({ origin: null, ponte: true }, ID, false)).toMatchObject({ ok: false });
    expect(canal.conferirOrigem({ origin: null, ponte: true, origemDaPonte: `chrome-extension://${"b".repeat(32)}` }, ID, true)).toMatchObject({ ok: false });
  });

  it("a triagem do upgrade recusa antes de abrir o WebSocket", () => {
    const host = "127.0.0.1:3010";
    const base = { url: "/api/navegador/canal", headers: { origin: ORIGEM, host } as Record<string, string>, remoto: "127.0.0.1", portaLocal: 3010 };
    expect(triagemDoUpgrade(base, null)).toMatchObject({ ok: true, ponte: false });
    expect(triagemDoUpgrade({ ...base, url: "/api/navegador/canal?token=abc" }, null)).toMatchObject({ ok: false, status: 400 });
    expect(triagemDoUpgrade({ ...base, headers: { origin: "https://g1.globo.com", host } }, null)).toMatchObject({ ok: false, status: 403 });
    expect(triagemDoUpgrade({ ...base, remoto: "192.168.0.20" }, null)).toMatchObject({ ok: false, status: 403 });
    expect(triagemDoUpgrade({ ...base, headers: { host } }, null)).toMatchObject({ ok: false, status: 403 });
    expect(triagemDoUpgrade({ ...base, url: "/outra" }, null)).toMatchObject({ ok: false, status: 404 });
  });

  it("I-2: o que passou por um proxy (o rewrite do Next) é recusado, mesmo vindo de 127.0.0.1", () => {
    const base = { url: "/api/navegador/canal", remoto: "127.0.0.1", portaLocal: 3010 };
    // o rewrite do Next em dev acrescenta estes cabeçalhos e mantém o Host de quem chamou
    for (const extra of [{ "x-forwarded-for": "192.168.0.50" }, { "x-forwarded-host": "192.168.0.10:3000" }, { forwarded: "for=192.168.0.50" }, { "x-real-ip": "10.0.0.2" }, { via: "1.1 next" }]) {
      expect(triagemDoUpgrade({ ...base, headers: { origin: ORIGEM, host: "127.0.0.1:3010", ...extra } }, null)).toMatchObject({ ok: false, status: 403 });
    }
    expect(triagemDoUpgrade({ ...base, headers: { origin: ORIGEM, host: "192.168.0.10:3000" } }, null)).toMatchObject({ ok: false, status: 403 });
    expect(triagemDoUpgrade({ ...base, headers: { origin: ORIGEM, host: "localhost:3000" } }, null)).toMatchObject({ ok: false, status: 403 });
    // controle: direto da extensão, com o Host desta porta
    expect(triagemDoUpgrade({ ...base, headers: { origin: ORIGEM, host: "localhost:3010" } }, null)).toMatchObject({ ok: true });
    expect(triagemDoUpgrade({ ...base, headers: { origin: ORIGEM, host: "[::1]:3010" } }, null)).toMatchObject({ ok: true });
  });

  it("I-14: sem Origin, só a ponte com o SEGREDO do arquivo; o cabeçalho público de antes não passa mais", () => {
    const segredo = "s".repeat(43);
    const base = { url: "/api/navegador/canal", remoto: "127.0.0.1", portaLocal: 3010 };
    const h = (extra: Record<string, string>) => ({ ...base, headers: { host: "127.0.0.1:3010", ...extra } });
    expect(triagemDoUpgrade(h({ "x-orbita-ponte": "1" }), segredo)).toMatchObject({ ok: false, status: 403 });
    expect(triagemDoUpgrade(h({ "x-orbita-ponte": "t".repeat(43) }), segredo)).toMatchObject({ ok: false, status: 403 });
    // sem o arquivo do segredo (ponte não instalada), nada passa sem Origin
    expect(triagemDoUpgrade(h({ "x-orbita-ponte": segredo }), null)).toMatchObject({ ok: false, status: 403 });
    expect(triagemDoUpgrade(h({ "x-orbita-ponte": segredo, "x-orbita-ponte-origem": `${ORIGEM}/` }), segredo)).toMatchObject({ ok: true, ponte: true, origemDaPonte: ORIGEM });
  });

  it("I-14: a ponte com o segredo mas iniciada para OUTRA extensão não pareia nem entra", async () => {
    const { codigo } = gerarCodigo("u1");
    const a = conexao({ origin: null, ponte: true, origemDaPonte: `chrome-extension://${"b".repeat(32)}` });
    await a.mandar({ t: "parear", codigo, nome: "Chrome", versao: "0.1.0" });
    expect(a.recebidas[0]).toMatchObject({ t: "recusado" });
    // e o código do dono continua valendo
    const b = conexao({ origin: null, ponte: true, origemDaPonte: ORIGEM });
    await b.mandar({ t: "parear", codigo, nome: "Chrome", versao: "0.1.0" });
    expect(b.recebidas[0]).toMatchObject({ t: "pareado" });
  });

  it("conexão que fecha enquanto o token é conferido não vira 'conectada' (a fantasma)", async () => {
    tokens.set("t".repeat(40), { id: "ext-1", userId: "u1" });
    atraso.ms = 30;
    const a = conexao();
    const recebendo = a.mandar({ t: "ola", token: "t".repeat(40), versao: "0.1.0" });
    a.h.fechou();
    await recebendo;
    expect(canal.extensaoConectada("u1")).toBe(false);
    expect(a.recebidas.some((m) => m.t === "bem_vindo")).toBe(false);
  });

  it("mensagem antes do token, ou fora do protocolo, derruba", async () => {
    const a = conexao();
    await a.mandar({ t: "ping" });
    expect(a.fechada.codigo).toBe(4001);
    const b = conexao();
    await b.h.receber("isto não é json");
    expect(b.fechada.codigo).toBe(4002);
  });

  it("token errado é recusado; token certo autentica e recebe o bem-vindo com os sites", async () => {
    const a = conexao();
    await a.mandar({ t: "ola", token: "x".repeat(40), versao: "0.1.0" });
    expect(a.recebidas[0]).toMatchObject({ t: "recusado" });
    expect(a.fechada.codigo).toBe(4003);

    tokens.set("t".repeat(40), { id: "ext-1", userId: "u1" });
    const b = conexao();
    await b.mandar({ t: "ola", token: "t".repeat(40), versao: "0.1.0", nome: "Chrome 155" });
    expect(canal.extensaoConectada("u1")).toBe(true);
    expect(b.recebidas[0]).toMatchObject({ t: "bem_vindo", envelope: null, sites: { bloqueados: expect.arrayContaining(["itau.com.br"]) }, keepaliveSeg: 20 });
  });
});

describe("pareamento", () => {
  it("o código vale uma vez, troca por token, e grava o ID quando ainda não havia", async () => {
    cfg["navegador.extensaoId"] = "";
    const { codigo } = gerarCodigo("u1");
    const a = conexao();
    await a.mandar({ t: "parear", codigo, nome: "Chrome", versao: "0.1.0" });
    expect(a.recebidas[0]).toMatchObject({ t: "pareado", token: expect.stringMatching(/^token-/) });
    expect(cfg["navegador.extensaoId"]).toBe(ID);
    expect(canal.extensaoConectada("u1")).toBe(true);
    const b = conexao();
    await b.mandar({ t: "parear", codigo, nome: "Chrome", versao: "0.1.0" });
    expect(b.recebidas[0]).toMatchObject({ t: "recusado" });
  });

  it("código vencido não vale; quem erra demais é barrado, sem matar o código do dono (I-2)", () => {
    const { codigo } = gerarCodigo("u1", 0);
    expect(consumirCodigo(codigo, 6 * 60_000)).toBeNull();
    const g = gerarCodigo("u1");
    const errado = g.codigo === "000000" ? "000001" : "000000";
    // dez erros de uma extensão estranha: ela é barrada (nem o código certo passa mais para ela)...
    for (let i = 0; i < 10; i++) consumirCodigo(errado, Date.now(), "chrome-extension://atacante");
    expect(consumirCodigo(g.codigo, Date.now(), "chrome-extension://atacante")).toBeNull();
    // ...e o dono, de outra origem, continua pareando com o mesmo código
    expect(consumirCodigo(g.codigo, Date.now(), ORIGEM)).toBe("u1");
  });

  it("o limite global mais alto ainda mata o código quando muitas origens erram", () => {
    const g = gerarCodigo("u1");
    const errado = g.codigo === "000000" ? "000001" : "000000";
    for (let o = 0; o * ERROS_POR_ORIGEM < ERROS_GLOBAIS; o++) for (let i = 0; i < ERROS_POR_ORIGEM; i++) consumirCodigo(errado, Date.now(), `origem-${o}`);
    expect(consumirCodigo(g.codigo, Date.now(), ORIGEM)).toBeNull();
  });

  it("parear de novo com o token anterior revoga o anterior e derruba a conexão velha", async () => {
    tokens.set("v".repeat(40), { id: "ext-velha", userId: "u1" });
    const velha = conexao();
    await velha.mandar({ t: "ola", token: "v".repeat(40), versao: "0.1.0" });
    const { codigo } = gerarCodigo("u1");
    const nova = conexao();
    await nova.mandar({ t: "parear", codigo, nome: "Chrome", versao: "0.1.0", tokenAnterior: "v".repeat(40) });
    expect(nova.recebidas[0]).toMatchObject({ t: "pareado" });
    expect(tokens.has("v".repeat(40))).toBe(false);
    expect(velha.fechada.codigo).toBe(4004);
  });

  it("do token só o hash existe fora da extensão", () => {
    expect(hashDoToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDoToken("abc")).not.toContain("abc");
  });
});

describe("ordens, espelho e eventos", () => {
  async function autenticada() {
    tokens.set("t".repeat(40), { id: "ext-1", userId: "u1" });
    const c = conexao();
    await c.mandar({ t: "ola", token: "t".repeat(40), versao: "0.1.0" });
    c.recebidas.length = 0;
    return c;
  }

  it("a ordem leva a origem e espera a resposta pelo id", async () => {
    const c = await autenticada();
    const p = canal.ordemAExtensao("u1", { tipo: "abas" }, "dono", 2000);
    const ordem = c.recebidas.find((m) => m.t === "ordem") as { id: string; origem: string };
    expect(ordem.origem).toBe("dono");
    await c.mandar({ t: "resposta", id: ordem.id, ok: true, dados: { abas: [] } });
    await expect(p).resolves.toEqual({ abas: [] });
  });

  it("recusa da extensão vira erro com a frase; sem resposta, estoura o prazo", async () => {
    const c = await autenticada();
    const p = canal.ordemAExtensao("u1", { tipo: "abas" }, "rotina", 2000);
    const ordem = c.recebidas.find((m) => m.t === "ordem") as { id: string };
    await c.mandar({ t: "resposta", id: ordem.id, ok: false, erro: "Ordem de rotina recusada", codigo: "origem_recusada" });
    await expect(p).rejects.toMatchObject({ codigo: "origem_recusada" });
    await expect(canal.ordemAExtensao("u1", { tipo: "abas" }, "dono", 50)).rejects.toMatchObject({ codigo: "sem_resposta" });
    await expect(canal.ordemAExtensao("outro", { tipo: "abas" }, "dono", 50)).rejects.toMatchObject({ codigo: "desconectada" });
  });

  it("revogar derruba na hora e falha as ordens pendentes", async () => {
    const c = await autenticada();
    const p = canal.ordemAExtensao("u1", { tipo: "abas" }, "dono", 5000);
    expect(canal.derrubarExtensao("ext-1")).toBe(1);
    expect(c.recebidas.some((m) => m.t === "revogado")).toBe(true);
    expect(c.fechada.codigo).toBe(4004);
    await expect(p).rejects.toMatchObject({ codigo: "desconectou" });
    expect(canal.extensaoConectada("u1")).toBe(false);
  });

  it("espelho: envelope de navegador, fim e parar chegam; envelope só de computador não", async () => {
    canal.ligarCanalDaExtensao();
    const c = await autenticada();
    const env = { sessaoId: "s1", alvo: "navegador" as const, objetivo: "x", apps: [], sites: ["jira.com"], tetoPassos: 5, passosUsados: 0, expiraEm: new Date().toISOString(), maquina: "pc" };
    await espelhar({ tipo: "envelope", userId: "u1", envelope: env }, 1000);
    await espelhar({ tipo: "envelope", userId: "u1", envelope: { ...env, alvo: "computador" } }, 1000);
    await espelhar({ tipo: "fim", userId: "u1", sessaoId: "s1", status: "encerrada", motivo: "ok" }, 1000);
    await espelhar({ tipo: "parar", userId: "u1", origem: "voz" }, 1000);
    expect(c.recebidas.map((m) => m.t)).toEqual(["envelope", "fim", "parar"]);
    expect(c.recebidas[0]).toMatchObject({ envelope: { sites: ["jira.com"] }, sites: { bloqueados: expect.any(Array) } });
  });

  it("Esquecer no popup revoga o token no servidor e derruba", async () => {
    const c = await autenticada();
    await c.mandar({ t: "esquecer" });
    expect(revogadosPorId).toEqual(["ext-1"]);
    expect(c.recebidas.some((m) => m.t === "revogado")).toBe(true);
    expect(c.fechada.codigo).toBe(4004);
    expect(canal.extensaoConectada("u1")).toBe(false);
  });

  it("B-3: o Parar que chega atrasado (canal caído) para a sessão dele e é confirmado; o de uma sessão velha não para a nova", async () => {
    const ATIVA = "11111111-1111-4111-8111-111111111111";
    const VELHA = "22222222-2222-4222-8222-222222222222";
    historico.set(ATIVA, "ativa");
    const c = await autenticada();
    await c.mandar({ t: "evento", tipo: "parar", id: "e1", sessaoId: ATIVA });
    expect(paradas).toHaveLength(1);
    expect(c.recebidas).toContainEqual({ t: "evento_recebido", id: "e1" });
    // a sessão do Parar já acabou: confirma (a extensão para de reenviar), mas não para nada
    historico.set(VELHA, "encerrada");
    await c.mandar({ t: "evento", tipo: "parar", id: "e2", sessaoId: VELHA });
    expect(paradas).toHaveLength(1);
    expect(c.recebidas).toContainEqual({ t: "evento_recebido", id: "e2" });
    // apertado AGORA (o canal caiu por segundos e o api abriu outra sessão nesse meio): para tudo, é o que o dono quis
    await c.mandar({ t: "evento", tipo: "parar", id: "e4", sessaoId: VELHA, em: Date.now() - 5_000 });
    expect(paradas).toHaveLength(2);
    // o "dono mexeu" atrasado pausa só a sessão dele, e só se ainda estiver ativa
    await c.mandar({ t: "evento", tipo: "dono_mexeu", id: "e3", sessaoId: VELHA });
    expect(pausadas).toHaveLength(0);
    expect(pausadasPorId).toEqual([VELHA]);
  });

  it("o dono mexeu na aba: a sessão pausa; Parar na aba: para tudo", async () => {
    sessao.atual = { id: "s1", objetivo: "x", sites: [], expiraEm: new Date(), tetoPassos: 1, passosUsados: 0 };
    const c = await autenticada();
    await c.mandar({ t: "evento", tipo: "dono_mexeu", aba: 3 });
    expect(pausadas).toEqual(["o dono mexeu na aba"]);
    await c.mandar({ t: "evento", tipo: "redirecionou", dominio: "evil.io" });
    expect(pausadas[1]).toMatch(/evil\.io/);
    await c.mandar({ t: "evento", tipo: "parar" });
    expect(paradas).toEqual(["botão Parar na aba do Chrome"]);
  });

  it("o estado para a tela diz por onde a extensão conectou", async () => {
    canal.ligarCanalDaExtensao();
    const { estadoDasMaos } = await import("../controle/estado");
    expect((await estadoDasMaos()).extensao.ligado).toBe(false);
    await autenticada();
    expect((await estadoDasMaos()).extensao).toMatchObject({ ligado: true, versao: "0.1.0", detalhe: expect.stringMatching(/WebSocket/) });
  });
});

describe("/health: o estado da extensão (PRD §13)", () => {
  it("nao_usado sem pareamento; down pareada e caída; up conectada", async () => {
    pareadas.linhas = [];
    expect(await canal.estadoDaExtensaoParaOHealth()).toBe("nao_usado");
    pareadas.linhas = [{ id: "ext-1" }];
    expect(await canal.estadoDaExtensaoParaOHealth()).toBe("down");
    tokens.set("t".repeat(40), { id: "ext-1", userId: "u1" });
    await conexao().mandar({ t: "ola", token: "t".repeat(40), versao: "0.1.0" });
    expect(await canal.estadoDaExtensaoParaOHealth()).toBe("up");
  });
});
