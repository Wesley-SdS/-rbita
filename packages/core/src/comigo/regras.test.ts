import { describe, expect, it } from "vitest";
import { atividadesComigo, classificarChamados, deveComentar, ehMeuNome, ocorrencias, quaisAvisar, situacaoDoPrazo, textoDoAvisoComigo, textoDoComentario, REGRA_PADRAO, type ChamadoBruto } from "./regras";

/**
 * O que está com o dono e o que atrasou, com os chamados no formato que a
 * central devolve (medido em 08/10/2026). Decisão do dono: "sem tratativa" é
 * aberto com o prazo vencido OU sem primeira resposta depois do prazo dela; e
 * todo item mostra o prazo dito em gente (pedido do dono, 08/10/2026).
 */

// quinta, 08/10/2026, 09:00 em São Paulo
const AGORA = new Date("2026-10-08T12:00:00Z");
const ch = (code: string, status: string, responsavel: string | null, sla: ChamadoBruto["sla"], createdAt = "2026-10-01T12:00:00Z"): ChamadoBruto => ({
  id: code, code, title: `Chamado ${code}`, status, priority: "high", assignee: responsavel ? { name: responsavel } : null, organization: { name: "Adalink" }, createdAt, sla,
});
const vencido = { deadline: "2026-10-06T23:00:00Z", paused: false, firstResponseDeadline: "2026-10-06T16:00:00Z", firstResponseAt: null };
const emDia = { deadline: "2026-10-20T23:00:00Z", paused: false, firstResponseDeadline: "2026-10-19T16:00:00Z", firstResponseAt: null };

describe("o prazo, dito em gente", () => {
  const p = (quando: string | null, opts?: Parameters<typeof situacaoDoPrazo>[3]) => situacaoDoPrazo(quando, AGORA, REGRA_PADRAO, opts);

  it("instante: hoje com hora e quanto falta, amanhã, dias da semana, e longe com a data", () => {
    expect(p("2026-10-08T21:00:00Z")).toMatchObject({ estado: "perto", texto: "vence hoje às 18:00 (faltam 9 horas)" });
    expect(p("2026-10-09T18:29:00Z").texto).toBe("vence amanhã às 15:29");
    expect(p("2026-10-10T18:29:00Z").texto).toBe("faltam 2 dias, até sáb 10/10 às 15:29");
    expect(p("2026-10-26T18:00:00Z").texto).toBe("faltam 18 dias, até 26/10 às 15:00");
  });

  it("dia sem hora vale até o fim do dia: hoje ainda não venceu", () => {
    expect(p("2026-10-08")).toMatchObject({ texto: "vence hoje" });
    expect(p("2026-10-08").estado).not.toBe("atrasado");
    expect(p("2026-10-26").texto).toBe("faltam 18 dias, até 26/10");
  });

  it("vencido: há quanto tempo, em gente", () => {
    expect(p("2026-09-17")).toMatchObject({ estado: "atrasado", texto: "venceu há 21 dias, em 17/09" });
    expect(p("2026-10-07T23:05:00Z").texto).toBe("venceu ontem às 20:05");
    expect(p("2026-10-08T09:00:00Z").texto).toBe("venceu há 3 horas");
    expect(p("2026-10-08T11:50:00Z").texto).toBe("venceu há 10 minutos");
  });

  it("reta final: o último quarto do tempo que havia, como a central faz com o SLA", () => {
    // aberto há 7 dias, vence em 2 dias: 22% do tempo restante
    expect(p("2026-10-10T12:00:00Z", { inicio: "2026-10-01T12:00:00Z" }).estado).toBe("perto");
    // aberto ontem, vence em 2 dias: 67% restante
    expect(p("2026-10-10T12:00:00Z", { inicio: "2026-10-07T12:00:00Z" }).estado).toBe("no_prazo");
    // sem início: perto é faltar menos de 24 h
    expect(p("2026-10-09T06:00:00Z").estado).toBe("perto");
    expect(p("2026-10-12T06:00:00Z").estado).toBe("no_prazo");
  });

  it("pausado e sem prazo dizem isso, em vez de ficar em branco", () => {
    expect(p("2026-10-01T00:00:00Z", { pausado: true })).toMatchObject({ estado: "pausado", texto: "prazo pausado enquanto aguarda", restanteMs: null });
    expect(p(null)).toMatchObject({ estado: "sem_prazo", texto: "sem prazo definido" });
  });
});

describe("de quem é o chamado", () => {
  it("\"Wesley\" na central é o mesmo \"Wesley Santos\" da conta, mas outro Wesley não", () => {
    expect(ehMeuNome("Wesley", "Wesley Santos")).toBe(true);
    expect(ehMeuNome("Wesley Santos", "Wesley")).toBe(true);
    expect(ehMeuNome("wésley santos", "Wesley Santos")).toBe(true);
    expect(ehMeuNome("Wesley Silva", "Wesley Santos")).toBe(false);
    expect(ehMeuNome("Lucas Souza", "Wesley")).toBe(false);
    expect(ehMeuNome(null, "Wesley")).toBe(false);
    expect(ehMeuNome("Wesley", "")).toBe(false);
  });
});

describe("chamados atrasados", () => {
  const brutos = [
    ch("TCK-0053", "open", "Wesley", vencido), // aberto, com o dono, prazo vencido
    ch("TCK-0047", "open", null, vencido), // aberto sem ninguém
    ch("TCK-0060", "open", null, { ...emDia, firstResponseDeadline: "2026-10-07T10:00:00Z" }), // só a primeira resposta venceu
    ch("TCK-0033", "in_progress", null, vencido), // em andamento sem dono: ninguém trata
    ch("TCK-0050", "in_progress", "Fernando Rodrigues", vencido), // com dev e atrasado
    ch("TCK-0061", "in_progress", "Lucas Souza", emDia), // com dev, no prazo
    ch("TCK-0062", "waiting", "Fernando Rodrigues", { ...vencido, paused: true }), // SLA pausado
    ch("TCK-0063", "resolved", "Wesley", vencido), // resolvido não conta
  ];
  const r = classificarChamados(brutos, "Wesley Santos", AGORA);

  it("com o dono: só os dele que não foram resolvidos, com os dois prazos do SLA", () => {
    expect(r.comigo.map((c) => c.codigo)).toEqual(["TCK-0053"]);
    expect(r.comigo[0]!.prazoSolucao).toMatchObject({ estado: "atrasado", texto: "venceu há 2 dias, em 06/10" });
    expect(r.comigo[0]!.primeiraResposta).toMatchObject({ estado: "atrasado" });
  });

  it("sem tratativa: aberto vencido, aberto sem primeira resposta e em andamento sem responsável", () => {
    expect(r.semTratativa.map((c) => c.codigo).sort()).toEqual(["TCK-0033", "TCK-0047", "TCK-0053", "TCK-0060"]);
    expect(r.semTratativa.find((c) => c.codigo === "TCK-0060")).toMatchObject({ motivo: "primeira_resposta", vencidoEm: "2026-10-07T10:00:00Z" });
  });

  it("com dev e atrasado: só em andamento, com responsável e prazo de solução vencido", () => {
    expect(r.comDevAtrasados.map((c) => c.codigo)).toEqual(["TCK-0050"]);
    expect(r.comDevAtrasados[0]).toMatchObject({ responsavel: "Fernando Rodrigues", status: "em andamento", motivo: "prazo" });
  });

  it("aguardando (SLA pausado) e no prazo não são atraso de ninguém", () => {
    const todos = [...r.semTratativa, ...r.comDevAtrasados].map((c) => c.codigo);
    expect(todos).not.toContain("TCK-0062");
    expect(todos).not.toContain("TCK-0061");
    expect(classificarChamados([brutos[6]!], "Fernando", AGORA).comigo[0]!.prazoSolucao.estado).toBe("pausado");
  });

  it("primeira resposta já dada some; a ordem segue o prazo que vence primeiro", () => {
    const respondido = classificarChamados([ch("TCK-9", "open", "Wesley", { ...emDia, firstResponseAt: "2026-10-02T10:00:00Z" })], "Wesley", AGORA);
    expect(respondido.comigo[0]!.primeiraResposta).toBeNull();
    const doisPrazos = classificarChamados([ch("TCK-8", "open", "Wesley", emDia)], "Wesley", AGORA).comigo[0]!;
    expect(doisPrazos.prazoOrdem).toBe(doisPrazos.primeiraResposta);
  });

  it("em andamento não mostra prazo de primeira resposta: alguém já pegou", () => {
    const andando = classificarChamados([ch("TCK-7", "in_progress", "Wesley", vencido)], "Wesley", AGORA).comigo[0]!;
    expect(andando.primeiraResposta).toBeNull();
    expect(andando.prazoSolucao.estado).toBe("atrasado");
  });

  it("o mesmo chamado lido em duas páginas aparece uma vez", () => {
    expect(classificarChamados([brutos[0]!, brutos[0]!], "Wesley", AGORA).comigo).toHaveLength(1);
  });
});

describe("atividades da gestão", () => {
  const meuDia = {
    date: "2026-10-08",
    backlog: [{ id: "a4", name: "Sem data ainda", projectName: "Painel" }],
    doing: [
      { id: "a1", name: "Adequação da geração de ppt", projectName: "Implantação", companyName: "Althaia", startDate: "2026-09-10", endDate: "2026-10-26", overdue: false, isCritical: true, responsibles: [{ name: "Wesley Santos", isMe: true }, { name: "Marcela Santoro", isMe: false }] },
      { id: "a2", name: "Levantamento de requisitos", projectName: "Sistema de Bugs", companyName: "Adalink", startDate: "2026-09-17", endDate: "2026-09-17", overdue: true, responsibles: [] },
    ],
    suggestedToday: [{ id: "a1", name: "Adequação da geração de ppt", projectName: "Implantação" }],
    doneToday: [{ id: "a3", name: "Ajustes de permissão", endDate: "2026-09-30" }],
  };

  it("tudo que está com o dono, menos o já feito, do prazo mais apertado ao sem prazo, sem repetir", () => {
    const a = atividadesComigo(meuDia, AGORA);
    expect(a.map((x) => x.id)).toEqual(["a2", "a1", "a4"]);
    expect(a[0]).toMatchObject({ atrasada: true, coluna: "Em andamento", prazo: { estado: "atrasado", texto: "venceu há 21 dias, em 17/09" } });
    expect(a[1]).toMatchObject({ critica: true, com: ["Marcela Santoro"], fim: "2026-10-26", prazo: { estado: "no_prazo", texto: "faltam 18 dias, até 26/10" } });
    expect(a[2]!.prazo).toMatchObject({ estado: "sem_prazo", texto: "sem prazo definido" });
  });

  it("retorno torto não derruba nada", () => {
    expect(atividadesComigo(null, AGORA)).toEqual([]);
    expect(atividadesComigo({ doing: "não é lista" }, AGORA)).toEqual([]);
  });
});

describe("o aviso", () => {
  it("cada fato tem chave estável, leva o prazo, e o atraso vem primeiro, sem travessão", () => {
    const chamados = classificarChamados([ch("TCK-0050", "in_progress", "Fernando", vencido)], "Wesley", AGORA);
    const atividades = atividadesComigo({ doing: [{ id: "a9", name: "Tela de créditos — ajustes", projectName: "Painel", startDate: "2026-10-01", endDate: "2026-10-30" }] }, AGORA);
    const o = ocorrencias({ atividades, chamados }, "America/Sao_Paulo");
    expect(o.map((x) => x.chave)).toEqual(["atividade:a9", "dev-atrasado:TCK-0050"]);
    const { titulo, corpo } = textoDoAvisoComigo(o);
    expect(titulo).toBe("Uma coisa atrasada na Adalink");
    expect(corpo.split("\n")[0]).toContain("TCK-0050 com Fernando está atrasado, prazo venceu em 06/10");
    expect(corpo).toContain("Tela de créditos, ajustes (Painel), faltam 22 dias, até 30/10");
    expect(corpo).not.toMatch(/[—–]/);
  });

  it("o que é do dono e entra na reta final avisa, uma linha só, com o prazo", () => {
    const atividades = atividadesComigo({ doing: [{ id: "a5", name: "Relatório", projectName: "Painel", startDate: "2026-09-01", endDate: "2026-10-09" }] }, AGORA);
    const o = ocorrencias({ atividades, chamados: { comigo: [], semTratativa: [], comDevAtrasados: [] } }, "America/Sao_Paulo");
    expect(o.map((x) => x.chave)).toEqual(["atividade:a5", "perto:a5:2026-10-09"]);
    const { titulo, corpo } = textoDoAvisoComigo(o);
    expect(titulo).toBe("Uma coisa vence em breve");
    expect(corpo).toBe("Reta final: Relatório (Painel), vence amanhã.");
  });

  it("chamado do dono que também está atrasado sai numa linha só, a do alerta", () => {
    const chamados = classificarChamados([ch("TCK-0053", "open", "Wesley", vencido)], "Wesley", AGORA);
    const o = ocorrencias({ atividades: [], chamados }, "America/Sao_Paulo");
    expect(o.map((x) => x.chave)).toEqual(["chamado:TCK-0053", "sem-tratativa:TCK-0053:prazo"]);
    const { titulo, corpo } = textoDoAvisoComigo(o);
    expect(corpo.split("\n")).toHaveLength(1);
    expect(corpo).toContain("TCK-0053 aberto e sem tratativa");
    expect(titulo).toBe("Uma coisa atrasada na Adalink");
  });

  it("mudar o motivo do atraso é outro fato (avisa de novo)", () => {
    const so1a = classificarChamados([ch("TCK-1", "open", null, { ...emDia, firstResponseDeadline: "2026-10-07T10:00:00Z" })], "x", AGORA);
    const prazo = classificarChamados([ch("TCK-1", "open", null, vencido)], "x", AGORA);
    const chave = (c: typeof so1a) => ocorrencias({ atividades: [], chamados: c }, "America/Sao_Paulo")[0]!.chave;
    expect(chave(so1a)).not.toBe(chave(prazo));
  });
});

describe("o que vira aviso", () => {
  const o = (chave: string, urgente: boolean) => ({ chave, frase: chave, urgente, nivel: urgente ? ("atrasado" as const) : ("novo" as const) });
  const todas = [o("atividade:a1", false), o("atividade:a2", true), o("chamado:c1", false), o("dev-atrasado:t1", true)];

  it("primeira vez de um tipo só guarda, menos o que é urgente", () => {
    const r = quaisAvisar(todas, new Set(todas.map((x) => x.chave)), new Set());
    expect(r.map((x) => x.chave)).toEqual(["atividade:a2", "dev-atrasado:t1"]);
  });

  it("depois, só o que acabou de entrar", () => {
    const r = quaisAvisar(todas, new Set(["atividade:a1"]), new Set(["atividade", "chamado", "dev-atrasado"]));
    expect(r.map((x) => x.chave)).toEqual(["atividade:a1"]);
  });
});

describe("chamado novo na central, para quem for", () => {
  const novo = { ...ch("TCK-0057", "open", null, emDia, "2026-10-08T11:30:00Z"), createdBy: { name: "Lucas Souza" }, organization: { name: "Benx" } };
  const antigo = { ...ch("TCK-0010", "open", "Fernando", emDia, "2026-09-01T10:00:00Z"), createdBy: { name: "Ana" } };
  const chamados = classificarChamados([novo, antigo], "Wesley", AGORA);

  it("só o aberto há pouco vira aviso, com quem abriu, prioridade, responsável e prazo", () => {
    const o = ocorrencias({ atividades: [], chamados }, "America/Sao_Paulo", { meuNome: "Wesley", novoDesde: new Date(AGORA.getTime() - 24 * 3_600_000) });
    expect(o.map((x) => x.chave)).toEqual(["aberto:TCK-0057"]);
    expect(o[0]!.frase).toBe("Chamado novo: TCK-0057 Chamado TCK-0057 (Benx, aberto por Lucas Souza, prioridade alta, sem responsável, prazo do SLA: faltam 12 dias, até 20/10 às 20:00).");
    expect(textoDoAvisoComigo(o).titulo).toBe("Chamado novo na central");
  });

  it("desligado (sem janela), não avisa chamado novo", () => {
    expect(ocorrencias({ atividades: [], chamados }, "America/Sao_Paulo", { meuNome: "Wesley", novoDesde: null })).toEqual([]);
  });

  it("aberto já com o dono: uma linha só, dizendo que está com ele", () => {
    const meu = classificarChamados([{ ...novo, assignee: { name: "Wesley" } }], "Wesley", AGORA);
    const o = ocorrencias({ atividades: [], chamados: meu }, "America/Sao_Paulo", { meuNome: "Wesley", novoDesde: new Date(AGORA.getTime() - 24 * 3_600_000) });
    const { corpo } = textoDoAvisoComigo(o);
    expect(corpo.split("\n")).toHaveLength(1);
    expect(corpo).toContain("com você");
  });
});

describe("o comentário de recebi", () => {
  const padrao = "{saudacao} Recebi o chamado {codigo} e já estou analisando. Assim que tiver uma atualização, comento por aqui.";
  const t = classificarChamados([{ ...ch("TCK-0057", "open", "Wesley", emDia), createdBy: { name: "Lucas Souza" } }], "Wesley", AGORA).comigo[0]!;

  it("o modelo do dono é preenchido, com a saudação pelo primeiro nome de quem abriu", () => {
    expect(textoDoComentario(padrao, t)).toBe("Olá, Lucas! Recebi o chamado TCK-0057 e já estou analisando. Assim que tiver uma atualização, comento por aqui.");
    expect(textoDoComentario("{saudacao} Vejo {titulo} até {prazo}.", { ...t, solicitante: null })).toBe("Olá! Vejo Chamado TCK-0057 até faltam 12 dias, até 20/10 às 20:00.");
    // marcação desconhecida fica como está: nada é interpretado além das conhecidas
    expect(textoDoComentario("Oi {outra}", t)).toBe("Oi {outra}");
  });

  it("não comenta no que o próprio dono abriu, nem no resolvido", () => {
    expect(deveComentar(t, "Wesley")).toBe(true);
    expect(deveComentar({ ...t, solicitante: "Wesley" }, "Wesley Santos")).toBe(false);
    expect(deveComentar({ ...t, status: "resolvido" }, "Wesley")).toBe(false);
  });
});
