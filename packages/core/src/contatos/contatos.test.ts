import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A agenda do Google (item 2 dos conectores, 27/09/2026). O que fica travado:
 *   - o mesmo celular casa com e sem o nono dígito (o WhatsApp guarda os dois);
 *   - nome ambíguo, ou uma pessoa com dois e-mails, vira pergunta, nunca palpite;
 *   - aniversário conta pelo dia da CASA e vira o ano;
 *   - Google fora do ar não derruba quem pediu: a agenda só some.
 */

vi.mock("@orbita/db", () => ({ db: {} }));
const cfg: Record<string, unknown> = { "contatos.usarGoogle": true, "contatos.cacheMinutos": 60, "contatos.maximo": 5000, "connectors.fusoHorario": "America/Sao_Paulo" };
vi.mock("../settings", () => ({
  settings: { get: async (k: string) => cfg[k], getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, cfg[k]])) },
}));
const lerDeTodasAsContas = vi.fn();
vi.mock("../connectors/multi", () => ({ lerDeTodasAsContas: (...a: unknown[]) => lerDeTodasAsContas(...a) }));

const conversas: { id: string; jid: string; nome: string | null; apelido: string | null; grupo: boolean }[] = [];
vi.mock("../whatsapp/store", async () => {
  const real = await vi.importActual<typeof import("../whatsapp/store")>("../whatsapp/store");
  return { casarContato: real.casarContato, listarContatos: async () => conversas };
});

const { aniversariantes, buscarNaAgenda, chaveDoTelefone, contatoPorTelefone, juntarContas, normalizarTelefone } = await import("./casar");
const { lerPessoa } = await import("./google");
const agenda = await import("./agenda");
const { buscar_contato, aniversarios } = await import("../tools/domains/contatos");

const c = (nome: string, extra: Partial<import("./casar").ContatoAgenda> = {}) => ({ nome, apelidos: [], emails: [], telefones: [], aniversario: null, empresa: null, ...extra });

describe("telefone", () => {
  it("normaliza com e sem DDI, com zero de operadora; sem DDD é nulo", () => {
    expect(normalizarTelefone("(11) 98888-7777")).toBe("5511988887777");
    expect(normalizarTelefone("+55 11 98888-7777")).toBe("5511988887777");
    expect(normalizarTelefone("011 98888-7777")).toBe("5511988887777");
    expect(normalizarTelefone("+1 415 555 0100")).toBe("14155550100");
    expect(normalizarTelefone("98888-7777")).toBeNull();
  });
  it("o mesmo celular com e sem o nono dígito dá a mesma chave", () => {
    expect(chaveDoTelefone("5511988887777")).toBe(chaveDoTelefone("551188887777"));
    expect(chaveDoTelefone("5511988887777")).not.toBe(chaveDoTelefone("5521988887777"));
  });
  it("acha o dono do JID do WhatsApp na agenda (JID antigo, sem o 9)", () => {
    const lista = [c("Tia Cida", { telefones: ["+55 11 98888-7777"] }), c("Outro", { telefones: ["+55 11 91111-2222"] })];
    expect(contatoPorTelefone(lista, "551188887777@s.whatsapp.net")?.nome).toBe("Tia Cida");
    expect(contatoPorTelefone(lista, "5511900000000@s.whatsapp.net")).toBeNull();
  });
});

describe("nome", () => {
  const lista = [c("Maria Souza"), c("Maria Lima", { apelidos: ["Mãe"] }), c("João Pedro Alves")];
  it("apelido exato vence; nome ambíguo devolve todos", () => {
    expect(buscarNaAgenda(lista, "a mãe").map((x) => x.nome)).toEqual(["Maria Lima"]);
    expect(buscarNaAgenda(lista, "maria").map((x) => x.nome)).toEqual(["Maria Souza", "Maria Lima"]);
  });
  it("sem acento e por palavra; termo curto demais não sai casando pedaço", () => {
    expect(buscarNaAgenda(lista, "joao alves").map((x) => x.nome)).toEqual(["João Pedro Alves"]);
    expect(buscarNaAgenda(lista, "ma")).toEqual([]);
  });
});

describe("aniversário", () => {
  const lista = [c("Hoje", { aniversario: { dia: 27, mes: 9, ano: 1990 } }), c("Amanhã", { aniversario: { dia: 28, mes: 9 } }), c("Janeiro", { aniversario: { dia: 2, mes: 1 } }), c("Longe", { aniversario: { dia: 1, mes: 12 } })];
  it("de hoje em diante, com idade quando há ano", () => {
    expect(aniversariantes(lista, "2026-09-27", 7)).toEqual([
      { nome: "Hoje", dia: 27, mes: 9, emDias: 0, idade: 36 },
      { nome: "Amanhã", dia: 28, mes: 9, emDias: 1, idade: null },
    ]);
  });
  it("vira o ano", () => {
    expect(aniversariantes(lista, "2026-12-30", 5).map((a) => [a.nome, a.emDias])).toEqual([["Janeiro", 3]]);
  });
});

describe("leitura do Google", () => {
  it("pessoa da People API vira contato; prefere o número canônico", () => {
    expect(
      lerPessoa({
        names: [{ displayName: "Ana" }],
        nicknames: [{ value: "Aninha" }],
        emailAddresses: [{ value: "ana@x.com" }],
        phoneNumbers: [{ value: "(11) 98888-7777", canonicalForm: "+5511988887777" }],
        birthdays: [{ date: { month: 3, day: 4 } }],
        organizations: [{ name: "Adalink" }],
      }),
    ).toEqual({ nome: "Ana", apelidos: ["Aninha"], emails: ["ana@x.com"], telefones: ["5511988887777"], aniversario: { dia: 4, mes: 3 }, empresa: "Adalink" });
  });
  it("sem o número canônico, normaliza assim mesmo (senão a chave nunca casaria com o JID)", () => {
    expect(lerPessoa({ names: [{ displayName: "Bia" }], phoneNumbers: [{ value: "(11) 98888-7777" }] })?.telefones).toEqual(["5511988887777"]);
  });
  it("sem nome e sem meio de contato, some", () => {
    expect(lerPessoa({ names: [{ displayName: "Só nome" }] })).toBeNull();
  });
  it("o mesmo contato em duas contas vira um só, somando os dados", () => {
    const r = juntarContas([c("Ana", { conta: "pessoal", emails: ["ana@x.com"], telefones: ["+5511988887777"] }), c("Ana", { conta: "trabalho", emails: ["ANA@x.com"], aniversario: { dia: 1, mes: 2 } })]);
    expect(r).toHaveLength(1);
    expect(r[0].aniversario).toEqual({ dia: 1, mes: 2 });
  });
  it("pai e mãe com o fixo da casa NÃO viram uma pessoa", () => {
    const r = juntarContas([c("Pai", { conta: "pessoal", telefones: ["+551133334444", "+5511911111111"] }), c("Mãe", { conta: "pessoal", telefones: ["+551133334444", "+5511922222222"] })]);
    expect(r.map((x) => x.nome)).toEqual(["Pai", "Mãe"]);
  });
});

describe("resolver destino pela agenda", () => {
  const lista = [
    c("João Silva", { emails: ["joao@x.com"], telefones: ["+55 11 3333-4444", "+55 11 98888-7777"] }),
    c("Carla Dias", { emails: ["carla@a.com", "carla@b.com"] }),
    c("Maria Souza", { telefones: ["+5511911111111"] }),
    c("Maria Lima", { telefones: ["+5511922222222"] }),
  ];
  beforeEach(() => {
    agenda.esquecerAgenda();
    lerDeTodasAsContas.mockReset();
    lerDeTodasAsContas.mockResolvedValue({ itens: lista, falhas: [], contas: 1 });
  });

  it("e-mail: pelo nome; endereço passa direto; dois e-mails ou dois contatos perguntam", async () => {
    expect(await agenda.resolverEmail("u", "o João")).toEqual({ ok: true, email: "joao@x.com", nome: "João Silva" });
    expect(await agenda.resolverEmail("u", "Fulano <f@y.com>")).toEqual({ ok: true, email: "f@y.com", nome: null });
    // endereço conhecido ganha o nome da AGENDA; texto com arroba que não é e-mail é recusado na hora
    expect(await agenda.resolverEmail("u", "joao@x.com")).toEqual({ ok: true, email: "joao@x.com", nome: "João Silva" });
    expect(await agenda.resolverEmail("u", "maria arroba @x")).toMatchObject({ ok: false });
    expect(await agenda.resolverEmail("u", "carla")).toMatchObject({ ok: false, erro: expect.stringContaining("mais de um e-mail") });
    expect(await agenda.resolverEmail("u", "ninguém")).toMatchObject({ ok: false });
  });

  it("o preparar fixa o endereço e o nome para o resumo da fila", async () => {
    const fixo = await agenda.fixarEmail({ para: "João", assunto: "x" }, { userId: "u" });
    expect(fixo).toEqual({ para: "joao@x.com", para_nome: "João Silva", assunto: "x" });
    expect(agenda.destinoDoEmail(fixo)).toBe("João Silva <joao@x.com>");
    expect(await agenda.conferirEmail({ para: "carla" }, { userId: "u" })).toContain("Pergunte qual");
  });

  it("o nome que o MODELO manda é descartado (injeção num e-mail lido: 'Mãe <x@golpe.com>')", async () => {
    const fixo = await agenda.fixarEmail({ para: "x@golpe.com", para_nome: "Mãe", assunto: "x" }, { userId: "u" });
    expect(fixo.para_nome).toBeNull();
    expect(agenda.destinoDoEmail(fixo)).toBe("x@golpe.com");
  });

  it("'Ana' não vira 'Juliana': envio só com casamento forte", async () => {
    agenda.esquecerAgenda();
    lerDeTodasAsContas.mockResolvedValue({ itens: [c("Juliana Souza", { emails: ["ju@x.com"], telefones: ["+5511933333333"] })], falhas: [], contas: 1 });
    expect(await agenda.resolverEmail("u", "Ana")).toMatchObject({ ok: false });
    expect(await agenda.candidatosDaAgenda("u", "Ana")).toEqual([]);
  });

  it("candidatos para WhatsApp: o celular ganha do fixo; só fixo é marcado; dois nomes, dois candidatos", async () => {
    expect(await agenda.candidatosDaAgenda("u", "joão")).toEqual([{ nome: "João Silva", numeros: ["5511988887777"], soFixo: false }]);
    expect((await agenda.candidatosDaAgenda("u", "maria")).map((x) => x.nome)).toEqual(["Maria Souza", "Maria Lima"]);
    agenda.esquecerAgenda();
    lerDeTodasAsContas.mockResolvedValue({ itens: [c("Padaria", { telefones: ["+551133334444"] })], falhas: [], contas: 1 });
    expect(await agenda.candidatosDaAgenda("u", "padaria")).toEqual([{ nome: "Padaria", numeros: ["551133334444"], soFixo: true }]);
  });

  it("guarda em memória: a segunda leitura não vai ao Google", async () => {
    await agenda.contatosDaAgenda("u");
    await agenda.contatosDaAgenda("u");
    expect(lerDeTodasAsContas).toHaveBeenCalledTimes(1);
  });

  it("Google fora do ar: lista vazia, sem lançar, e sem martelar o Google a cada chamada", async () => {
    lerDeTodasAsContas.mockRejectedValue(new Error("503"));
    expect(await agenda.contatosDaAgenda("u")).toEqual([]);
    expect(await agenda.contatosDaAgenda("u")).toEqual([]);
    expect(lerDeTodasAsContas).toHaveBeenCalledTimes(1);
  });

  it("leitura pela metade (uma conta falhou) vale pouco tempo, não as horas do cache", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      lerDeTodasAsContas.mockResolvedValue({ itens: lista, falhas: ["trabalho"], contas: 2 });
      await agenda.contatosDaAgenda("u");
      vi.setSystemTime(Date.now() + 6 * 60_000);
      await agenda.contatosDaAgenda("u");
      expect(lerDeTodasAsContas).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dois pedidos juntos fazem UMA ida ao Google", async () => {
    await Promise.all([agenda.contatosDaAgenda("u"), agenda.contatosDaAgenda("u")]);
    expect(lerDeTodasAsContas).toHaveBeenCalledTimes(1);
  });

  it("desligado em Ajustes: nem pergunta ao Google", async () => {
    cfg["contatos.usarGoogle"] = false;
    try {
      expect(await agenda.contatosDaAgenda("u")).toEqual([]);
      expect(lerDeTodasAsContas).not.toHaveBeenCalled();
    } finally {
      cfg["contatos.usarGoogle"] = true;
    }
  });
});

describe("tools", () => {
  beforeEach(() => {
    agenda.esquecerAgenda();
    lerDeTodasAsContas.mockResolvedValue({
      itens: [c("João Silva", { emails: ["joao@x.com"], telefones: ["+5511988887777"], empresa: "Adalink", aniversario: { dia: 5, mes: 10, ano: 1990 } })],
      falhas: [],
      contas: 1,
    });
  });
  it("buscar_contato devolve telefone, e-mail, empresa e aniversário", async () => {
    const r = String(await buscar_contato.run({ nome: "joão" }, { userId: "u" }));
    expect(r).toContain("João Silva · telefone: +5511988887777 · e-mail: joao@x.com · empresa: Adalink · aniversário: 05/10/1990");
    // embrulhado: nome de contato é dado, nunca instrução
    expect(r).toMatch(/^<dado_externo/);
    expect(String(await buscar_contato.run({ nome: "pedro" }, { userId: "u" }))).toContain("Ninguém chamado");
  });
  it("quem só existe nas conversas do WhatsApp também é achado (a Anna, 27/09/2026)", async () => {
    conversas.push({ id: "c9", jid: "5511942330608@s.whatsapp.net", nome: "Anna Santos", apelido: "Anna", grupo: false });
    try {
      expect(String(await buscar_contato.run({ nome: "Anna" }, { userId: "u" }))).toContain("Anna (Anna Santos) · WhatsApp: 5511942330608");
      // quem está nos dois lugares aparece uma vez, pela agenda
      conversas.push({ id: "c8", jid: "551188887777@s.whatsapp.net", nome: "João", apelido: null, grupo: false });
      expect(String(await buscar_contato.run({ nome: "João" }, { userId: "u" })).split("\n").filter((l) => l.includes("João"))).toHaveLength(1);
    } finally {
      conversas.length = 0;
    }
  });
  it("aniversarios: sem ninguém no período, diz; agenda ilegível, diz", async () => {
    expect(String(await aniversarios.run({ dias: 0 }, { userId: "u" }))).toMatch(/Ninguém da agenda faz aniversário hoje|HOJE/);
    agenda.esquecerAgenda();
    lerDeTodasAsContas.mockResolvedValue({ itens: [], falhas: ["x"], contas: 1 });
    expect(String(await aniversarios.run({}, { userId: "u" }))).toContain("Não consegui ler");
  });
});
