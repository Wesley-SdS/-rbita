import type { ToolRisk } from "../tools/registry";
import type { DescricaoDoAlvo } from "./pagina";
import { efeitosDasTeclas, lerSequencia, traduzirTeclas } from "./teclas";
import type { AcaoDeAgir } from "./protocolo";
import type { ModoDoSite } from "./sites";

/**
 * RISCO PELO ALVO no Chrome (PRD §5.3, B3). Clicar em "Ver mais" e clicar em
 * "Pagar" são a mesma tool e riscos opostos: o que decide é o que vai ser
 * tocado. Tudo puro: a tool fixa o alvo no `preparar` (perguntando à página) e
 * o `elevarRisco` chama isto com o alvo já fixado.
 */

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** O rótulo bate com algum dos rótulos de efeito ("Enviar mensagem" bate com "enviar")? Palavra inteira. Puro. */
export function rotuloDeEfeito(nome: string, rotulos: readonly string[]): string | null {
  const n = ` ${normalizar(nome)} `;
  if (!n.trim()) return null;
  for (const r of rotulos) {
    const x = normalizar(r);
    if (x && n.includes(` ${x} `)) return r;
  }
  return null;
}

export interface DecisaoDeRisco {
  risco: ToolRisk;
  /** por que subiu, para o resumo da proposta */
  motivo: string | null;
}

export interface ContextoDeAgir {
  acao: AcaoDeAgir;
  alvo: DescricaoDoAlvo | null;
  /** o campo com o foco, para `digitar` e `tecla` */
  focado: DescricaoDoAlvo | null;
  /** a sequência de teclas, como o modelo mandou (`tecla`, ou `texto` quando ela veio lá) */
  tecla?: string | null;
  rotulos: readonly string[];
  /** o domínio da aba está no envelope da sessão */
  noEnvelope: boolean;
  /** "Enter" sem modificador na sequência */
  apertaEnter: boolean;
}

/** A sequência escreve texto? Com a sequência, olha tecla a tecla; sem ela (contexto antigo), vale o `apertaEnter`. */
function teclaEscreve(c: Pick<ContextoDeAgir, "apertaEnter"> & { tecla?: string | null }): boolean {
  if (!c.tecla) return !c.apertaEnter;
  try {
    return lerSequencia(traduzirTeclas(c.tecla), true).escreve;
  } catch {
    // tecla que não dá para ler: trata como se escrevesse (falha fechada)
    return true;
  }
}

/** A ação que a página nunca deixa: campo de senha, cartão ou código. Devolve a frase da recusa, ou null. Puro. */
export function recusaDeAgir(c: Pick<ContextoDeAgir, "acao" | "alvo" | "focado" | "apertaEnter"> & { tecla?: string | null }): string | null {
  // "1 2 3 Enter" ESCREVE no campo: o Enter no fim não desliga as outras teclas (B-1)
  const escreve = c.acao === "preencher" || c.acao === "digitar" || c.acao === "selecionar" || (c.acao === "tecla" && teclaEscreve(c));
  const campo = c.acao === "digitar" || c.acao === "tecla" ? c.focado : c.alvo;
  if (escreve && campo?.sensivel) return "Campo de senha, cartão ou código de uso único: a Órbita não digita aqui. Faça você mesmo e me diga quando terminar.";
  return null;
}

/** Clicar (ou ativar pelo teclado) este alvo tem efeito fora da tela? Sobe arquivo, envia formulário ou o rótulo diz. Puro. */
function efeitoDeAtivar(a: DescricaoDoAlvo, rotulos: readonly string[]): string | null {
  if (a.upload) return "sobe um arquivo";
  if (a.submit) return "envia um formulário";
  const r = rotuloDeEfeito(a.nome, rotulos);
  return r ? `botão "${a.nome.slice(0, 60)}" (${r})` : null;
}

/** Campo onde se escreve texto. Só o input de uma linha tem `tipo`: sem ele é textarea, contenteditable ou role=textbox. */
const CAMPO_DE_TEXTO = new Set(["textbox", "searchbox", "combobox"]);
const campoDeMensagem = (f: DescricaoDoAlvo) => (f.papel === "textbox" || f.papel === "searchbox") && !f.tipo;

/** O que a tecla dispara. Sem a sequência (contexto antigo), vale o `apertaEnter`. Null: tecla que não dá para ler. */
function efeitosDoContexto(c: ContextoDeAgir): ReturnType<typeof efeitosDasTeclas> | null {
  if (!c.tecla) return { enter: c.apertaEnter, enterComModificador: false, ativa: c.apertaEnter };
  try {
    return efeitosDasTeclas(traduzirTeclas(c.tecla));
  } catch {
    return null;
  }
}

/**
 * O risco de uma ação na página. Nunca abaixo de `escrita`. Puro.
 *
 * A TECLA segue a mesma regra do clique, aplicada ao elemento com o FOCO (B3
 * da revisão): antes só "Enter sem modificador dentro de <form>" subia, e
 * Enter ou Espaço num botão "Comprar" fora de formulário, Ctrl+Enter num
 * comentário e Enter na caixa de mensagem de um chat saíam como `escrita`,
 * sem passar pela fila.
 */
export function riscoDeAgir(c: ContextoDeAgir): DecisaoDeRisco {
  if (!c.noEnvelope) return { risco: "efeito_externo", motivo: "site fora do envelope da sessão" };
  const a = c.alvo;
  if (a?.upload) return { risco: "efeito_externo", motivo: "sobe um arquivo" };
  const clica = c.acao === "clicar" || c.acao === "clique_duplo" || c.acao === "clique_triplo" || c.acao === "marcar" || c.acao === "clique_meio";
  if (clica && a) {
    const efeito = efeitoDeAtivar(a, c.rotulos);
    if (efeito) return { risco: "efeito_externo", motivo: efeito };
  }
  if (c.acao === "tecla") {
    const t = efeitosDoContexto(c);
    if (!t) return { risco: "perigoso", motivo: "tecla que não dá para ler" };
    const f = c.focado;
    if (t.enterComModificador) return { risco: "efeito_externo", motivo: "Ctrl ou Alt com Enter costuma enviar" };
    const emCampoDeTexto = !!f && CAMPO_DE_TEXTO.has(f.papel);
    let seq: ReturnType<typeof lerSequencia> | null = null;
    try {
      seq = c.tecla ? lerSequencia(traduzirTeclas(c.tecla), emCampoDeTexto) : null;
    } catch {
      return { risco: "perigoso", motivo: "tecla que não dá para ler" };
    }
    if (seq) {
      // B-1: Tab (ou seta num menu) e depois Enter, Espaço ou texto: a tecla que age cai num elemento que ninguém viu
      if (seq.atuaDepoisDeMover) return { risco: "efeito_externo", motivo: "a sequência move o foco e depois escreve ou ativa algo que não foi visto" };
      // I-17: fora de um campo de texto, apagar é apagar o item selecionado (Drive, Trello, Jira)…
      if (seq.apaga && !emCampoDeTexto) return { risco: "efeito_externo", motivo: "Delete ou Backspace fora de um campo apaga o item selecionado" };
      // …e uma letra solta é atalho do site ("e" arquiva no Gmail, "#" apaga)
      if (seq.atalhoDeTecla && !emCampoDeTexto) return { risco: "efeito_externo", motivo: "tecla solta fora de um campo é atalho do site" };
    }
    // sem saber onde está o foco, um Enter pode cair em qualquer coisa
    if (t.enter && !f) return { risco: "efeito_externo", motivo: "Enter sem saber onde está o foco" };
    if (f && t.ativa && !CAMPO_DE_TEXTO.has(f.papel)) {
      const efeito = efeitoDeAtivar(f, c.rotulos);
      if (efeito) return { risco: "efeito_externo", motivo: `${efeito}, pela tecla` };
    }
    // Enter dentro de um formulário envia o formulário, igual ao botão
    if (t.enter && f?.emFormulario) return { risco: "efeito_externo", motivo: "Enter num formulário envia o formulário" };
    // e numa caixa de mensagem (WhatsApp Web, Slack, Teams) manda a mensagem
    if (t.enter && f && campoDeMensagem(f)) return { risco: "efeito_externo", motivo: "Enter numa caixa de mensagem envia a mensagem" };
  }
  return { risco: "escrita", motivo: null };
}

export interface ContextoDeAbrir {
  url: string;
  modo: ModoDoSite;
  noEnvelope: boolean;
  /** o endereço apareceu como link numa página que a Órbita leu, ou no pedido do dono */
  urlConhecida: boolean;
}

/**
 * Abrir um endereço. Endereço com consulta (`?x=…`) que ninguém viu antes é o
 * canal de vazamento clássico: o modelo monta a URL com o que leu numa página
 * e "abre", mandando o dado para fora. Por isso vira proposta. Puro.
 */
export function riscoDeAbrir(c: ContextoDeAbrir): DecisaoDeRisco {
  let temConsulta = false;
  try {
    const u = new URL(c.url);
    temConsulta = u.search.length > 1;
  } catch {
    return { risco: "perigoso", motivo: "endereço que não dá para ler" };
  }
  if (temConsulta && !c.urlConhecida) return { risco: "efeito_externo", motivo: "endereço com parâmetros montado pela Órbita" };
  if (c.noEnvelope || c.modo === "escrita") return { risco: "escrita", motivo: null };
  return { risco: "efeito_externo", motivo: "site fora do envelope da sessão" };
}

/**
 * Ler por endereço (abre a aba para ler): sem aprovação só em site que o dono
 * classificou à mão (leitura ou escrita) ou que está no envelope, e sem
 * consulta desconhecida. O resto vai para a fila. Puro.
 */
export function riscoDeLerUrl(c: { url: string; explicito: boolean; noEnvelope: boolean; urlConhecida: boolean }): DecisaoDeRisco {
  let temConsulta = false;
  try {
    temConsulta = new URL(c.url).search.length > 1;
  } catch {
    return { risco: "perigoso", motivo: "endereço que não dá para ler" };
  }
  if (temConsulta && !c.urlConhecida) return { risco: "efeito_externo", motivo: "endereço com parâmetros montado pela Órbita" };
  if (c.explicito || c.noEnvelope) return { risco: "leitura", motivo: null };
  return { risco: "efeito_externo", motivo: "site que você ainda não liberou para leitura" };
}

/** Normaliza para comparar endereços (sem fragmento, sem barra final). Puro. */
export function chaveDeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}
