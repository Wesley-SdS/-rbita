import type { FonteDaWeb } from "./cartoes";
import { brl } from "../finance/formato";

/**
 * O que a Órbita ABRE NA TELA enquanto conversa: "seus e-mails", "sua agenda",
 * "as notícias". Puro: roda no servidor (o chat manda o cartão no stream) e no
 * navegador (a voz em tempo real recebe o resultado da tool direto).
 *
 * O dono viu outro assistente abrindo cartões à medida que falava e quis o
 * mesmo (06/10/2026): na voz, os cartões vão para a mesa da tela, onde dá
 * para arrastar, minimizar e fechar; no chat, ficam dentro da mensagem.
 *
 * Um formato só para todos (título, destaque, lista de itens): a tela desenha
 * qualquer cartão sem saber de onde ele veio, e uma tool nova ganha cartão
 * escrevendo um tradutor aqui, sem tocar na tela. O `id` diz QUAL cartão é:
 * pedir os e-mails de novo atualiza o cartão dos e-mails, não abre outro.
 *
 * Resultado com `erro` não vira cartão: quem explica a falha é a fala.
 */

export type TipoDeCartao =
  | "emails"
  | "agenda"
  | "tarefas"
  | "jira"
  | "noticias"
  | "clima"
  | "financas"
  | "contas"
  | "cotacao"
  | "rota"
  | "aniversarios"
  | "presenca"
  | "trabalho"
  | "fontes";

export interface ItemDeCartao {
  titulo: string;
  /** quem mandou, onde é, de que site: a linha pequena acima ou ao lado */
  detalhe?: string;
  /** o trecho ou resumo, quando cabe */
  texto?: string;
  /** ISO ou "YYYY-MM-DD": a tela escreve "hoje 14:00", "amanhã" (`quandoLegivel`) */
  quando?: string;
  /** dinheiro já formatado ("R$ 45,90") ou um número com unidade */
  valor?: string;
  /** link http(s) para abrir em aba nova */
  url?: string;
  marca?: "atrasado" | "feito" | "importante";
  /** a aba em que o item mora, quando o cartão tem abas (`grupos`) */
  grupo?: string;
}

export interface CartaoDaTela {
  id: string;
  tipo: TipoDeCartao;
  titulo: string;
  /** "5 e-mails · 2 contas" */
  resumo?: string;
  /** o número que responde a pergunta: 26°, R$ 120 por dia */
  destaque?: { valor: string; rotulo?: string };
  itens: ItemDeCartao[];
  /** o que dizer quando a lista veio vazia ("Nenhum compromisso") */
  vazio?: string;
  /** a tela da Órbita onde isso mora por inteiro */
  abrir?: string;
  /** abas do cartão, na ordem, com quantos itens cada uma tem de verdade (a lista pode vir cortada) */
  grupos?: { id: string; rotulo: string; total: number }[];
}

/** Teto de itens por cartão: o cartão rola por dentro, mas 50 e-mails não são um cartão. */
const MAX_ITENS = 20;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const txt = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const lista = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj).filter((x): x is Obj => Boolean(x)) : []);
const opcional = (s: string): string | undefined => s || undefined;

function urlSegura(v: unknown): string | undefined {
  const s = txt(v);
  try {
    const u = new URL(s);
    // o link vira um <a>: `javascript:` vindo de um e-mail ou página não pode virar um
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** "Maria Silva <maria@x.com>" vira "Maria Silva": no cartão, o nome basta. */
function nomeDoRemetente(de: string): string {
  const nome = de.replace(/<[^>]*>/, "").replace(/^"|"$/g, "").trim();
  return nome || de.replace(/[<>]/g, "").trim();
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

function contasDoResumo(r: Obj, chave = "contas_lidas"): string | null {
  const n = typeof r[chave] === "number" ? (r[chave] as number) : 0;
  return n > 1 ? `${n} contas` : null;
}

const juntar = (...partes: (string | null | undefined | false)[]) => partes.filter(Boolean).join(" · ") || undefined;

const ROTULO_DA_ABA: Record<string, string> = { acao: "Ação", util: "Úteis", ruido: "Ruído" };

/** O trabalho consolidado (`meu_trabalho`): Jira, GitHub e Slack, uma aba para cada serviço conectado. */
function trabalho(r: Obj, hoje: string): CartaoDaTela | null {
  const conectados = obj(r.conectados);
  if (!conectados) return null;
  const itens: ItemDeCartao[] = [
    ...lista(r.jira).slice(0, MAX_ITENS).map((i) => {
      const vence = txt(i.vencimento);
      return { titulo: juntar(txt(i.chave), txt(i.titulo)) ?? "", detalhe: opcional(juntar(txt(i.status), Number(conectados.jira) > 1 || lista(r.jira).some((x) => x.site !== i.site) ? txt(i.site) : null) ?? ""), quando: opcional(vence), url: urlSegura(i.link), marca: vence && vence < hoje ? ("atrasado" as const) : undefined, grupo: "jira" };
    }),
    ...lista(r.github).slice(0, MAX_ITENS).map((n) => ({
      titulo: txt(n.pr).replace(/^[^#]*#/, "#"),
      detalhe: opcional(juntar(txt(n.autor), txt(n.acao) || txt(n.tipo)) ?? ""),
      texto: opcional(txt(n.trecho)),
      quando: opcional(txt(n.quando)),
      url: urlSegura(n.link),
      marca: n.acao === "pediu mudanças" ? ("importante" as const) : undefined,
      grupo: "github",
    })),
    ...lista(r.slack).slice(0, MAX_ITENS).map((n) => ({ titulo: `${txt(n.autor)} em ${txt(n.onde)}`, texto: opcional(txt(n.trecho)), quando: opcional(txt(n.quando)), url: urlSegura(n.link), grupo: "slack" })),
  ];
  const grupos = [
    { id: "jira", rotulo: "Jira", total: lista(r.jira).length, conectado: Number(conectados.jira) > 0 },
    { id: "github", rotulo: "GitHub", total: lista(r.github).length, conectado: Number(conectados.github) > 0 },
    { id: "slack", rotulo: "Slack", total: lista(r.slack).length, conectado: Number(conectados.slack) > 0 },
  ].filter((g) => g.conectado).map(({ conectado: _, ...g }) => g);
  return { id: "trabalho", tipo: "trabalho", titulo: "Seu trabalho", resumo: plural(grupos.reduce((s, g) => s + g.total, 0), "pendência", "pendências"), itens, grupos, vazio: "Nada pendente por aqui.", abrir: "/app" };
}

/** Os e-mails já triados (`meus_emails`): um cartão só, com as abas que vieram. */
function emailsTriados(r: Obj): CartaoDaTela | null {
  const contagem = obj(r.contagem);
  if (!contagem) return null;
  const abas = ["acao", "util", "ruido"].filter((a) => Array.isArray(r[a]));
  const itens: ItemDeCartao[] = abas.flatMap((a) =>
    lista(r[a]).slice(0, MAX_ITENS).map((e) => {
      const mov = obj(e.movimentacao);
      return {
        titulo: txt(e.assunto) || "(sem assunto)",
        detalhe: opcional(juntar(txt(e.de), txt(e.conta)) ?? ""),
        texto: opcional(txt(e.tarefa) ? `Tarefa: ${txt(e.tarefa)}` : txt(e.resumo)),
        quando: opcional(txt(e.recebido_em)),
        valor: mov && typeof mov.valor === "number" ? `${mov.natureza === "receita" ? "+" : "-"} ${brl(mov.valor)}` : undefined,
        url: urlSegura(e.link),
        grupo: a,
      };
    }),
  );
  const n = (a: string) => (typeof contagem[a] === "number" ? (contagem[a] as number) : 0);
  return {
    id: "emails:triados",
    tipo: "emails",
    titulo: "Seus e-mails",
    resumo: juntar(n("acao") ? plural(n("acao"), "pede ação", "pedem ação") : "nada pedindo ação", n("util") ? plural(n("util"), "útil", "úteis") : null),
    itens,
    grupos: abas.map((a) => ({ id: a, rotulo: ROTULO_DA_ABA[a]!, total: n(a) })),
    vazio: "Nada por aqui.",
    abrir: "/app",
  };
}

function emails(r: Obj, origem: string): CartaoDaTela | null {
  if (!Array.isArray(r.emails)) return null;
  const itens = lista(r.emails).slice(0, MAX_ITENS).map((e) => ({
    titulo: txt(e.subject) || "(sem assunto)",
    detalhe: opcional(juntar(nomeDoRemetente(txt(e.from)), Number(r.contas_lidas) > 1 ? txt(e.conta) : null) ?? ""),
    texto: opcional(txt(e.snippet).slice(0, 240)),
    quando: opcional(txt(e.date)),
  }));
  return {
    id: `emails:${origem}`,
    tipo: "emails",
    titulo: origem === "outlook" ? "E-mails do Outlook" : "Seus e-mails",
    resumo: juntar(plural(itens.length, "e-mail", "e-mails"), contasDoResumo(r)),
    itens,
    vazio: "Nenhum e-mail por aqui.",
  };
}

function agenda(r: Obj, origem: string): CartaoDaTela | null {
  if (!Array.isArray(r.eventos)) return null;
  const itens = lista(r.eventos)
    .map((e) => ({
      titulo: txt(e.summary) || "(sem título)",
      detalhe: opcional(juntar(txt(e.location), Number(r.contas_lidas) > 1 ? txt(e.conta) : null) ?? ""),
      quando: opcional(txt(e.start)),
      url: urlSegura(e.link),
    }))
    .sort((a, b) => (a.quando ?? "").localeCompare(b.quando ?? ""))
    .slice(0, MAX_ITENS);
  return {
    id: `agenda:${origem}`,
    tipo: "agenda",
    titulo: origem === "outlook" ? "Agenda do Outlook" : "Sua agenda",
    resumo: juntar(plural(itens.length, "compromisso", "compromissos"), contasDoResumo(r)),
    itens,
    vazio: "Agenda livre. Nenhum compromisso no período.",
  };
}

function tarefas(r: Obj, hoje: string): CartaoDaTela | null {
  if (!Array.isArray(r.tarefas)) return null;
  const todas = lista(r.tarefas);
  const abertas = todas.filter((t) => !t.concluida).length;
  const itens: ItemDeCartao[] = todas.slice(0, MAX_ITENS).map((t) => {
    const vence = txt(t.vencimento);
    return {
      titulo: txt(t.texto),
      detalhe: opcional(txt(t.para_quem) ? `para ${txt(t.para_quem)}` : ""),
      quando: opcional(vence),
      marca: t.concluida ? "feito" : vence && vence < hoje ? "atrasado" : undefined,
    };
  });
  return {
    id: "tarefas",
    tipo: "tarefas",
    titulo: "Suas tarefas",
    resumo: plural(abertas, "em aberto", "em aberto"),
    itens: itens.filter((i) => i.titulo),
    vazio: "Nenhuma tarefa. Tudo em dia.",
  };
}

function jira(r: Obj, hoje: string): CartaoDaTela | null {
  if (!Array.isArray(r.issues)) return null;
  const itens = lista(r.issues).slice(0, MAX_ITENS).map((i) => {
    const vence = txt(i.vencimento);
    return {
      titulo: juntar(txt(i.chave), txt(i.titulo)) ?? "",
      detalhe: opcional(juntar(txt(i.status), txt(i.prioridade), Number(r.workspaces_lidos) > 1 ? txt(i.site) : null) ?? ""),
      quando: opcional(vence),
      url: urlSegura(i.link),
      marca: vence && vence < hoje ? ("atrasado" as const) : undefined,
    };
  });
  return { id: "jira", tipo: "jira", titulo: "Suas tarefas no Jira", resumo: plural(itens.length, "tarefa", "tarefas"), itens, vazio: "Nada com você no Jira." };
}

function noticias(r: Obj, args: Obj | null): CartaoDaTela | null {
  if (!Array.isArray(r.temas) || !lista(r.temas).some((t) => Array.isArray(t.noticias))) return null;
  const itens = lista(r.temas)
    .flatMap((t) => lista(t.noticias).map((n) => ({ n, tema: txt(t.tema) })))
    .slice(0, MAX_ITENS)
    .map(({ n }) => ({ titulo: txt(n.titulo), detalhe: opcional(txt(n.site)), texto: opcional(txt(n.resumo)), url: urlSegura(n.link) }))
    .filter((i) => i.titulo);
  const temas = lista(r.temas).map((t) => txt(t.tema)).filter(Boolean);
  return {
    id: `noticias:${txt(args?.tema).toLowerCase()}`,
    tipo: "noticias",
    titulo: temas.length === 1 ? `Notícias: ${temas[0]}` : "Notícias dos seus temas",
    resumo: plural(itens.length, "notícia", "notícias"),
    itens,
    vazio: "Nada novo nos seus temas ainda.",
    abrir: "/app",
  };
}

function clima(r: Obj): CartaoDaTela | null {
  const agora = obj(r.agora);
  const hoje = obj(r.hoje);
  if (!agora && !hoje) return null;
  const graus = (v: unknown) => (typeof v === "number" ? `${Math.round(v)}°` : "");
  const itens: ItemDeCartao[] = [];
  if (agora && typeof agora.sensacao === "number") itens.push({ titulo: "Sensação", valor: graus(agora.sensacao) });
  if (hoje && typeof hoje.min === "number") itens.push({ titulo: "Mínima e máxima", valor: `${graus(hoje.min)} / ${graus(hoje.max)}` });
  if (hoje && typeof hoje.chuvaMm === "number") itens.push({ titulo: "Chuva hoje", valor: `${hoje.chuvaMm} mm` });
  if (agora && typeof agora.vento === "number") itens.push({ titulo: "Vento", valor: `${Math.round(agora.vento)} km/h` });
  return {
    id: `clima:${txt(r.cidade).toLowerCase()}`,
    tipo: "clima",
    titulo: txt(r.cidade).split(",")[0] || "Clima",
    destaque: agora ? { valor: graus(agora.temperatura), rotulo: opcional(txt(agora.condicao)) } : undefined,
    itens,
  };
}

/** Rótulo de gente para as chaves do resumo financeiro ("possoGastarHoje" → "Posso gastar hoje"). */
const ROTULOS: Record<string, string> = {
  tenhoNaConta: "Na conta",
  tenhoHoje: "Tenho hoje",
  aPagarEm30Dias: "A pagar em 30 dias",
  aReceberEm30Dias: "A receber em 30 dias",
  sobraEm30Dias: "Sobra em 30 dias",
  jaGasteiNoMes: "Já gastei no mês",
  sobraNoMes: "Sobra no mês",
  gastoLivreAteAgora: "Gasto livre até agora",
  totalGastoNoMes: "Total gasto no mês",
  emAtraso: "Em atraso",
  saidas: "Saídas",
  entradas: "Entradas",
  total: "Total",
  rendaMensal: "Renda do mês",
  porDia: "Por dia",
  teto: "Teto",
  comprometidoNosProximosMeses: "Comprometido nos próximos meses",
  mediaPorMes: "Média por mês",
};
/** O número que responde "posso gastar?": o primeiro que existir, nesta ordem. */
const DESTAQUES: [string, string][] = [
  ["possoGastarHoje", "posso gastar hoje"],
  ["aindaCabeAteOFimDoMes", "ainda cabe até o fim do mês"],
  ["sobraEm30Dias", "sobra em 30 dias"],
  ["total", "no total"],
  ["aPagarEm30Dias", "a pagar em 30 dias"],
];

const VISTAS: Record<string, string> = {
  posso_gastar: "Posso gastar?",
  painel: "Suas finanças",
  extrato: "Extrato",
  contas: "Contas",
  cartoes: "Cartões",
  dividas: "Dívidas",
  metas: "Metas",
  previsao: "Previsão",
  historico: "Histórico",
  saldos: "Saldos",
};

function financas(r: Obj, args: Obj | null): CartaoDaTela {
  const vista = txt(args?.o_que) || "posso_gastar";
  const destaque = DESTAQUES.find(([k]) => typeof r[k] === "string" && r[k]);
  const itens: ItemDeCartao[] = [];
  // as listas que cada vista traz, cada uma no seu jeito de virar linha
  for (const c of lista(r.contas)) itens.push({ titulo: txt(c.conta), valor: txt(c.saldo) });
  for (const l of lista(r.itens)) itens.push({ titulo: txt(l.descricao), detalhe: opcional(juntar(txt(l.categoria), txt(l.onde)) ?? ""), valor: txt(l.valor), quando: opcional(txt(l.data)) });
  for (const c of lista(r.emAberto)) itens.push({ titulo: txt(c.descricao), detalhe: opcional(txt(c.tipo)), valor: txt(c.valor), quando: opcional(txt(c.vencimento)), marca: /atras|vencid/i.test(txt(c.situacao)) ? "atrasado" : undefined });
  for (const c of lista(r.cartoes)) itens.push({ titulo: txt(c.cartao), detalhe: opcional(txt(c.vence) ? `vence ${txt(c.vence)}` : ""), valor: txt(c.valorDaFatura) });
  for (const c of lista(r.faturasAbertas)) itens.push({ titulo: `Fatura ${txt(c.cartao)}`, detalhe: opcional(txt(c.vence) ? `vence ${txt(c.vence)}` : ""), valor: txt(c.valor) });
  for (const c of lista(r.paraOndeFoi)) itens.push({ titulo: txt(c.categoria), detalhe: typeof c.pct === "number" ? `${Math.round(c.pct)}%` : undefined, valor: txt(c.total) });
  for (const d of lista(r.dividas)) itens.push({ titulo: txt(d.divida), detalhe: opcional(txt(d.previsao)), valor: txt(d.saldoDevedor) });
  for (const m of lista(r.metas)) itens.push({ titulo: txt(m.meta), valor: juntar(txt(m.jaPago), txt(m.teto)) });
  for (const m of lista(r.meses)) itens.push({ titulo: txt(m.mes), valor: txt(m.livre) || txt(m.gasto) });
  // sem lista, os números soltos do resumo (o que não virou destaque)
  if (!itens.length) {
    for (const [k, rotulo] of Object.entries(ROTULOS)) {
      if (k !== destaque?.[0] && typeof r[k] === "string" && r[k]) itens.push({ titulo: rotulo, valor: txt(r[k]) });
    }
  }
  return {
    id: `financas:${vista}`,
    tipo: "financas",
    titulo: VISTAS[vista] ?? "Suas finanças",
    resumo: opcional(txt(r.mes)),
    destaque: destaque ? { valor: txt(r[destaque[0]]), rotulo: destaque[1] } : undefined,
    itens: itens.filter((i) => i.titulo).slice(0, MAX_ITENS),
    abrir: "/app/financas",
  };
}

// o formatador do motor de finanças: o cartão escreve o dinheiro igual ao painel
const emReais = (reais: number) => brl(Math.round(reais * 100));

function contasAVencer(r: Obj): CartaoDaTela | null {
  if (!Array.isArray(r.contas)) return null;
  const itens = lista(r.contas).slice(0, MAX_ITENS).map((c) => ({
    titulo: txt(c.descricao),
    detalhe: c.tipo === "a_receber" ? "a receber" : "a pagar",
    // aqui o valor vem em REAIS como número, não formatado como no resumo
    valor: typeof c.valor === "number" ? emReais(c.valor) : txt(c.valor),
    quando: opcional(txt(c.vencimento)),
    marca: c.vencida ? ("atrasado" as const) : undefined,
  }));
  const vencidas = itens.filter((i) => i.marca === "atrasado").length;
  return {
    id: "contas",
    tipo: "contas",
    titulo: "Contas a vencer",
    resumo: juntar(plural(itens.length, "conta", "contas"), vencidas ? plural(vencidas, "vencida", "vencidas") : null),
    itens,
    vazio: "Nenhuma conta para os próximos dias.",
    abrir: "/app/financas",
  };
}

function presenca(r: Obj): CartaoDaTela | null {
  if (!Array.isArray(r.pessoas)) return null;
  const itens = lista(r.pessoas).map((p) => ({
    titulo: txt(p.nome),
    detalhe: txt(p.visto) === "sem registro" ? "sem registro" : txt(p.quando) === "agora" ? txt(p.comodo) : `visto por último: ${txt(p.comodo)}`,
    quando: opcional(txt(p.vistoEm)),
  }));
  return { id: "presenca", tipo: "presenca", titulo: "Quem está em casa", itens, vazio: txt(r.aviso) || "Ninguém visto agora.", abrir: "/app/casa" };
}

/** As tools que respondem em TEXTO: o cartão mostra o texto, sem tentar entender. */
function deTexto(tool: string, texto: string, args: Obj | null): CartaoDaTela | null {
  const t = texto.trim();
  if (!t) return null;
  if (tool === "cotacao") {
    const ativo = txt(args?.ativo) || t.split(":")[0]!;
    return { id: `cotacao:${ativo.toLowerCase()}`, tipo: "cotacao", titulo: `Cotação ${ativo}`.trim(), itens: [{ titulo: t }] };
  }
  if (tool === "rota") {
    const [cabeca, ...resto] = t.split(/(?<=\.)\s+(?=De:)/);
    return { id: "rota", tipo: "rota", titulo: txt(args?.destino) ? `Até ${txt(args?.destino)}` : "Trajeto", destaque: { valor: (cabeca ?? t).split(" (")[0]!, rotulo: opcional((cabeca ?? "").replace(/^[^(]*/, "").trim()) }, itens: resto.map((r) => ({ titulo: r })) };
  }
  if (tool === "aniversarios") {
    const linhas = t.split("\n").map((l) => l.trim()).filter(Boolean);
    const vazio = linhas.length === 1 && !linhas[0]!.includes(":");
    return {
      id: "aniversarios",
      tipo: "aniversarios",
      titulo: "Aniversários",
      itens: vazio ? [] : linhas.map((l) => {
        const [nome, ...quando] = l.split(":");
        return { titulo: nome!.trim(), detalhe: opcional(quando.join(":").trim()) };
      }),
      vazio: vazio ? linhas[0] : undefined,
    };
  }
  return null;
}

/**
 * Os cartões de UM resultado de tool. A maioria é escolhida pelo nome da tool
 * (cada uma tem formato próprio); o que vem em texto só vira cartão nas tools
 * em que o texto É a resposta (cotação, trajeto, aniversários).
 */
export function cartoesDoResultado(tool: string, resultado: unknown, argumentos?: unknown, agora = new Date()): CartaoDaTela[] {
  const args = obj(argumentos);
  if (typeof resultado === "string") {
    const c = deTexto(tool, resultado, args);
    return c ? [c] : [];
  }
  const r = obj(resultado);
  if (!r || "erro" in r || "error" in r || r.permitido === false) return [];
  const hoje = agora.toISOString().slice(0, 10);
  let c: CartaoDaTela | null = null;
  switch (tool) {
    case "meus_emails": c = emailsTriados(r); break;
    case "meu_trabalho": c = trabalho(r, hoje); break;
    case "ler_emails": c = emails(r, "google"); break;
    case "outlook_ler_emails": c = emails(r, "outlook"); break;
    case "listar_eventos": c = agenda(r, "google"); break;
    case "outlook_listar_eventos": c = agenda(r, "outlook"); break;
    case "listar_tarefas": c = tarefas(r, hoje); break;
    case "jira_minhas_tarefas": c = jira(r, hoje); break;
    case "noticias_dos_meus_temas": c = noticias(r, args); break;
    case "previsao_tempo": c = clima(r); break;
    case "resumo_financeiro": c = financas(r, args); break;
    case "contas_a_vencer": c = contasAVencer(r); break;
    case "quem_esta_em_casa": c = presenca(r); break;
  }
  return c ? [c] : [];
}

/** As fontes de uma busca na web também viram cartão na mesa (no chat, continuam a pilha). */
export function cartaoDasFontes(fontes: FonteDaWeb[]): CartaoDaTela | null {
  if (!fontes.length) return null;
  return {
    id: "fontes",
    tipo: "fontes",
    titulo: "O que encontrei na web",
    resumo: plural(fontes.length, "fonte", "fontes"),
    itens: fontes.map((f) => ({ titulo: f.titulo, detalhe: f.site, texto: opcional(f.trecho), url: f.url })),
  };
}

const DIAS_DA_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/**
 * "hoje 14:00", "amanhã", "ontem 09:12", "qua 08/10", "08/10/2025". Data sem
 * hora ("2026-10-08", vencimento de conta e de tarefa) é dia do CALENDÁRIO:
 * lida como meia-noite UTC, o fuso de Brasília a jogaria para o dia anterior.
 * A hora sai no fuso do navegador, que é o da casa.
 */
export function quandoLegivel(quando: string, agora = new Date()): string {
  const soDia = /^\d{4}-\d{2}-\d{2}$/.test(quando);
  const d = soDia ? new Date(`${quando}T12:00:00`) : new Date(quando);
  if (Number.isNaN(d.getTime())) return quando;
  const meiaNoite = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((meiaNoite(d) - meiaNoite(agora)) / 86_400_000);
  const hora = soDia ? "" : ` ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const ddmm = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (dias === 0) return `hoje${hora}`;
  if (dias === 1) return `amanhã${hora}`;
  if (dias === -1) return `ontem${hora}`;
  if (dias > 1 && dias < 7) return `${DIAS_DA_SEMANA[d.getDay()]} ${ddmm}${hora}`;
  return d.getFullYear() === agora.getFullYear() ? `${ddmm}${hora}` : `${ddmm}/${d.getFullYear()}`;
}
