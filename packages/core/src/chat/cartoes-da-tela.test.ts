import { describe, expect, it } from "vitest";
import { cartaoDasFontes, cartoesDoResultado, quandoLegivel } from "./cartoes-da-tela";

const AGORA = new Date("2026-10-06T15:00:00");

describe("cartões que a Órbita abre na tela", () => {
  it("e-mails: remetente sem o endereço, conta só quando há mais de uma, sempre o mesmo id", () => {
    const r = {
      emails: [
        { id: "1", from: "Stripe <no-reply@stripe.com>", subject: "Atualize seus dados", date: "Tue, 6 Oct 2026 10:00:00 -0300", snippet: "Envie o documento até 22/10", conta: "pessoal" },
        { id: "2", from: "banco@santander.com", subject: "", date: "", snippet: "", conta: "trabalho" },
      ],
      contas_lidas: 2,
      contas_que_falharam: [],
    };
    const [c] = cartoesDoResultado("ler_emails", r);
    expect(c).toMatchObject({ id: "emails:google", tipo: "emails", titulo: "Seus e-mails", resumo: "2 e-mails · 2 contas" });
    expect(c!.itens[0]).toMatchObject({ titulo: "Atualize seus dados", detalhe: "Stripe · pessoal", texto: "Envie o documento até 22/10" });
    expect(c!.itens[1]).toMatchObject({ titulo: "(sem assunto)", detalhe: "banco@santander.com · trabalho" });
    expect(cartoesDoResultado("outlook_ler_emails", { ...r, contas_lidas: 1 })[0]!.itens[0]!.detalhe).toBe("Stripe");
  });

  it("agenda em ordem de horário, link de reunião só se for http(s)", () => {
    const [c] = cartoesDoResultado("listar_eventos", {
      eventos: [
        { summary: "Almoço", start: "2026-10-06T12:00:00-03:00", end: "", conta: "x" },
        { summary: "Daily", start: "2026-10-06T09:00:00-03:00", end: "", link: "https://meet.google.com/abc", conta: "x" },
        { summary: "Golpe", start: "2026-10-06T18:00:00-03:00", end: "", link: "javascript:alert(1)", conta: "x" },
      ],
      contas_lidas: 1,
    });
    expect(c!.itens.map((i) => i.titulo)).toEqual(["Daily", "Almoço", "Golpe"]);
    expect(c!.itens[0]!.url).toBe("https://meet.google.com/abc");
    expect(c!.itens[2]!.url).toBeUndefined();
    expect(cartoesDoResultado("listar_eventos", { eventos: [], contas_lidas: 1 })[0]).toMatchObject({ itens: [], vazio: expect.stringContaining("livre") });
  });

  it("tarefas marcam atrasada e feita; o resumo conta só as abertas", () => {
    const [c] = cartoesDoResultado("listar_tarefas", {
      tarefas: [
        { texto: "Mandar o documento", concluida: false, vencimento: "2026-10-01", para_quem: null },
        { texto: "Ligar para o banco", concluida: true, vencimento: null, para_quem: "Anna" },
        { texto: "Revisar PR", concluida: false, vencimento: "2026-10-09", para_quem: null },
      ],
    }, {}, AGORA);
    expect(c!.resumo).toBe("2 em aberto");
    expect(c!.itens.map((i) => i.marca)).toEqual(["atrasado", "feito", undefined]);
    expect(c!.itens[1]!.detalhe).toBe("para Anna");
  });

  it("clima vira destaque com a condição; cidade não achada não vira cartão", () => {
    const [c] = cartoesDoResultado("previsao_tempo", { cidade: "Maragogi, Brasil", agora: { temperatura: 26.7, sensacao: 29.2, condicao: "Céu limpo", vento: 12.4 }, hoje: { min: 23.1, max: 30, chuvaMm: 0 } });
    expect(c).toMatchObject({ id: "clima:maragogi, brasil", titulo: "Maragogi", destaque: { valor: "27°", rotulo: "Céu limpo" } });
    expect(c!.itens).toContainEqual({ titulo: "Mínima e máxima", valor: "23° / 30°" });
    expect(cartoesDoResultado("previsao_tempo", { cidade: "Xyz", agora: null, hoje: null, erro: "cidade não encontrada" })).toEqual([]);
    expect(cartoesDoResultado("previsao_tempo", "Não sei a cidade da casa")).toEqual([]);
  });

  it("finanças: cada vista é um cartão; o destaque é o número que responde", () => {
    const [posso] = cartoesDoResultado("resumo_financeiro", { mes: "outubro de 2026", tenhoNaConta: "R$ 39.000,00", possoGastarHoje: "R$ 1.200,00", sobraNoMes: "R$ 30.000,00" }, { o_que: "posso_gastar" });
    expect(posso).toMatchObject({ id: "financas:posso_gastar", titulo: "Posso gastar?", destaque: { valor: "R$ 1.200,00", rotulo: "posso gastar hoje" }, abrir: "/app/financas" });
    expect(posso!.itens).toContainEqual({ titulo: "Na conta", valor: "R$ 39.000,00" });
    const [saldos] = cartoesDoResultado("resumo_financeiro", { contas: [{ conta: "Nubank", saldo: "R$ 39.000,00" }], total: "R$ 39.000,00" }, { o_que: "saldos" });
    expect(saldos).toMatchObject({ id: "financas:saldos", destaque: { valor: "R$ 39.000,00" }, itens: [{ titulo: "Nubank", valor: "R$ 39.000,00" }] });
  });

  it("contas a vencer chegam em REAIS como número e saem formatadas", () => {
    const [c] = cartoesDoResultado("contas_a_vencer", { contas: [{ descricao: "Luz", valor: 245.9, tipo: "a_pagar", vencimento: "2026-10-05", vencida: true }] });
    expect(c!.itens[0]).toMatchObject({ titulo: "Luz", valor: "R$ 245,90", marca: "atrasado", detalhe: "a pagar" });
    expect(c!.resumo).toBe("1 conta · 1 vencida");
  });

  it("notícias com link seguro; o id leva o tema pedido", () => {
    const [c] = cartoesDoResultado("noticias_dos_meus_temas", { temas: [{ tema: "IA", noticias: [{ titulo: "SEGA barra IA", site: "Canaltech", resumo: "Jogos feitos por humanos.", link: "https://canaltech.com.br/x" }] }] }, { tema: "IA" });
    expect(c).toMatchObject({ id: "noticias:ia", titulo: "Notícias: IA", itens: [{ titulo: "SEGA barra IA", detalhe: "Canaltech", url: "https://canaltech.com.br/x" }] });
  });

  it("texto vira cartão só onde o texto É a resposta", () => {
    expect(cartoesDoResultado("cotacao", "PETR4: R$ 38,12, +1,23% no dia.", { ativo: "PETR4" })[0]).toMatchObject({ id: "cotacao:petr4", titulo: "Cotação PETR4" });
    const [rota] = cartoesDoResultado("rota", "25 min (12 km) de carro com o trânsito de agora, trânsito livre. De: Casa. Para: Adalink.", { destino: "Adalink" });
    expect(rota).toMatchObject({ titulo: "Até Adalink", destaque: { valor: "25 min", rotulo: "(12 km) de carro com o trânsito de agora, trânsito livre." }, itens: [{ titulo: "De: Casa. Para: Adalink." }] });
    const [aniv] = cartoesDoResultado("aniversarios", "Anna: HOJE (06/10), faz 30 anos\nLucas: amanhã (07/10)");
    expect(aniv!.itens).toEqual([{ titulo: "Anna", detalhe: "HOJE (06/10), faz 30 anos" }, { titulo: "Lucas", detalhe: "amanhã (07/10)" }]);
    expect(cartoesDoResultado("aniversarios", "Ninguém da agenda faz aniversário hoje.")[0]).toMatchObject({ itens: [], vazio: "Ninguém da agenda faz aniversário hoje." });
    // conversa do WhatsApp é dado de terceiro embrulhado: não vira cartão
    expect(cartoesDoResultado("whatsapp_conversas_recentes", "<dado_externo>…</dado_externo>")).toEqual([]);
  });

  it("erro, tool sem cartão e resultado torto não abrem nada", () => {
    expect(cartoesDoResultado("ler_emails", { erro: "Google não conectado" })).toEqual([]);
    expect(cartoesDoResultado("registrar_gasto", { ok: true })).toEqual([]);
    expect(cartoesDoResultado("ler_emails", null)).toEqual([]);
    expect(cartoesDoResultado("ler_emails", { emails: "não é lista" })).toEqual([]);
  });

  it("fontes da web viram cartão com link", () => {
    expect(cartaoDasFontes([])).toBeNull();
    expect(cartaoDasFontes([{ titulo: "A", url: "https://a.com/x", trecho: "", site: "a.com" }])).toMatchObject({ id: "fontes", itens: [{ titulo: "A", detalhe: "a.com", url: "https://a.com/x" }] });
  });
});

describe("quando legível", () => {
  it("hoje, amanhã, ontem, dia da semana e data", () => {
    expect(quandoLegivel("2026-10-06T09:05:00", AGORA)).toBe("hoje 09:05");
    expect(quandoLegivel("2026-10-07T14:00:00", AGORA)).toBe("amanhã 14:00");
    expect(quandoLegivel("2026-10-05", AGORA)).toBe("ontem");
    expect(quandoLegivel("2026-10-09", AGORA)).toBe("sex 09/10");
    expect(quandoLegivel("2026-11-20", AGORA)).toBe("20/11");
    expect(quandoLegivel("2025-01-02", AGORA)).toBe("02/01/2025");
    expect(quandoLegivel("lixo", AGORA)).toBe("lixo");
  });

  it("data sem hora é dia do calendário, não meia-noite UTC", () => {
    expect(quandoLegivel("2026-10-06", AGORA)).toBe("hoje");
  });
});

describe("cartão de servidor MCP (formato genérico)", () => {
  const bloco = (o: unknown) => [{ type: "text", text: JSON.stringify(o) }];

  it("lista de chamados: código, status traduzido, prazo do SLA e o total", () => {
    const [c] = cartoesDoResultado("tickets__tickets_list", bloco({
      total: 51,
      tickets: [{ code: "TCK-0056", title: "Agente Importação", status: "open", priority: "high", organization: { name: "Adalink" }, sla: { deadline: "2026-10-10T18:29:39Z" } }],
    }));
    expect(c).toMatchObject({ id: "externo:tickets__tickets_list", tipo: "externo", titulo: "list · tickets", destaque: { valor: "51" }, resumo: "1 de 51" });
    expect(c!.itens[0]).toMatchObject({ titulo: "Agente Importação", detalhe: "TCK-0056 · aberto · Adalink", quando: "2026-10-10T18:29:39Z", marca: "importante" });
  });

  it("o nome do cartão vem da descrição da ferramenta, não do nome técnico", () => {
    const [c] = cartoesDoResultado("adalink_gestao__get_my_day", bloco({ doing: [] }), {}, new Date(), "MEU DIA: o kanban pessoal do dia");
    expect(c!.titulo).toBe("Meu dia · adalink gestao");
    const [l] = cartoesDoResultado("tickets__tickets_list", bloco({ tickets: [] }), {}, new Date(), "Lista chamados de todas as organizações (ou de uma), do mais novo");
    expect(l!.titulo).toBe("Lista chamados de todas as organizações · tickets");
  });

  it("meu dia da gestão: cada lista vira uma aba, atrasado aparece marcado", () => {
    const [c] = cartoesDoResultado("adalink_gestao__get_my_day", bloco({
      date: "2026-10-07",
      backlog: [],
      doing: [{ name: "Levantamento de requisitos", projectName: "Sistema de Bugs", endDate: "2026-09-17", overdue: true, column: "doing" }],
    }));
    expect(c!.grupos).toEqual([{ id: "backlog", rotulo: "Backlog", total: 0 }, { id: "doing", rotulo: "Em andamento", total: 1 }]);
    expect(c!.itens[0]).toMatchObject({ titulo: "Levantamento de requisitos", marca: "atrasado", grupo: "doing", quando: "2026-09-17" });
  });

  it("na voz o resultado vem embrulhado e em texto; proposta e erro não viram cartão", () => {
    const [c] = cartoesDoResultado("usar_ferramenta_externa", { ferramenta: "tickets__tickets_stats", descricao: "Números agregados: total, por status", resultado: JSON.stringify({ total: 51, byStatus: [{ status: "open", count: 5 }] }) });
    expect(c!.titulo).toBe("Números agregados · tickets");
    expect(c!.itens[0]).toMatchObject({ titulo: "aberto", valor: "5" });
    expect(cartoesDoResultado("usar_ferramenta_externa", { ferramenta: "tickets__tickets_create", resultado: { proposta_enfileirada: true } })).toEqual([]);
    expect(cartoesDoResultado("tickets__tickets_list", { erro: "O servidor tickets não respondeu" })).toEqual([]);
  });

  it("texto que não é JSON vira um cartão de texto", () => {
    const [c] = cartoesDoResultado("tickets__tickets_ask", [{ type: "text", text: "Há 2 chamados críticos.\nDetalhes..." }]);
    expect(c!.itens[0]).toMatchObject({ titulo: "Há 2 chamados críticos." });
  });
});
