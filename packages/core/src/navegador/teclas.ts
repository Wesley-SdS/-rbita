/**
 * TECLAS: o texto que o modelo manda ("Enter", "ctrl+a", "Backspace Backspace",
 * "Return", "Page_Down") vira os eventos do CDP (`Input.dispatchKeyEvent`),
 * que as duas mãos (extensão e perfil dedicado) usam iguais. Puro.
 *
 * O Claude usa os nomes do xdotool ("Return", "Page_Down") e também os do DOM
 * ("Enter", "PageDown"): os dois valem. Tecla desconhecida é erro, nunca um
 * palpite: uma tecla errada num formulário pode enviar o que não devia.
 */

export interface TeclaCdp {
  key: string;
  code: string;
  keyCode: number;
  /** o caractere que a tecla produz (Enter produz "\r", e é isso que envia formulário) */
  text?: string;
}

export interface Combinacao {
  teclas: TeclaCdp;
  /** Alt=1, Ctrl=2, Meta=4, Shift=8 (bitmask do CDP) */
  modificadores: number;
}

const ESPECIAIS: Record<string, TeclaCdp> = {
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  del: { key: "Delete", code: "Delete", keyCode: 46 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
  " ": { key: " ", code: "Space", keyCode: 32, text: " " },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  page_up: { key: "PageUp", code: "PageUp", keyCode: 33 },
  prior: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  page_down: { key: "PageDown", code: "PageDown", keyCode: 34 },
  next: { key: "PageDown", code: "PageDown", keyCode: 34 },
};
for (let i = 1; i <= 12; i++) ESPECIAIS[`f${i}`] = { key: `F${i}`, code: `F${i}`, keyCode: 111 + i };

const MODIFICADOR: Record<string, number> = { alt: 1, ctrl: 2, control: 2, cmd: 4, meta: 4, super: 4, win: 4, shift: 8 };

function teclaSimples(nome: string): TeclaCdp | null {
  const n = nome.trim();
  if (!n) return null;
  const esp = ESPECIAIS[n.toLowerCase()];
  if (esp) return esp;
  if (n.length === 1) {
    const ch = n;
    const upper = ch.toUpperCase();
    if (/[a-z]/i.test(ch)) return { key: ch, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: ch };
    if (/[0-9]/.test(ch)) return { key: ch, code: `Digit${ch}`, keyCode: ch.charCodeAt(0), text: ch };
    return { key: ch, code: "", keyCode: 0, text: ch };
  }
  return null;
}

/**
 * "ctrl+shift+a Enter" → duas combinações, em ordem. Lança com a frase do
 * problema quando alguma tecla não existe. Puro.
 */
export function traduzirTeclas(texto: string): Combinacao[] {
  const out: Combinacao[] = [];
  // "+" sozinho é a própria tecla, não um separador
  const sequencia = texto.trim().split(/\s+/).filter(Boolean);
  if (!sequencia.length) throw new Error("Diga qual tecla apertar.");
  if (sequencia.length > 50) throw new Error("Teclas demais de uma vez.");
  for (const parte of sequencia) {
    const pedacos = parte === "+" ? ["+"] : parte.split("+").filter((x) => x !== "");
    let mods = 0;
    for (const m of pedacos.slice(0, -1)) {
      const v = MODIFICADOR[m.toLowerCase()];
      if (v === undefined) throw new Error(`Modificador desconhecido: "${m}".`);
      mods |= v;
    }
    const ultima = pedacos[pedacos.length - 1] ?? "";
    // "ctrl+shift" sem tecla: o último também é modificador
    if (MODIFICADOR[ultima.toLowerCase()] !== undefined && pedacos.length > 1) throw new Error(`Falta a tecla depois de "${parte}".`);
    const t = teclaSimples(ultima);
    if (!t) throw new Error(`Tecla desconhecida: "${ultima}".`);
    // com Ctrl/Alt/Meta a letra não vira texto (Ctrl+A seleciona, não escreve "a")
    out.push({ teclas: mods & 7 ? { ...t, text: undefined } : t, modificadores: mods });
  }
  return out;
}

/** A sequência aperta Enter sem modificador? É o que envia formulário. Puro. */
export function apertaEnter(c: Combinacao[]): boolean {
  return c.some((x) => x.teclas.key === "Enter" && (x.modificadores & 7) === 0);
}

/**
 * O que uma sequência de teclas pode DISPARAR, para o risco (B3 da revisão).
 * Enter não é só "envia formulário": Ctrl+Enter e Alt+Enter enviam no Gmail,
 * no Slack e em quase todo campo de comentário, Enter num campo de conversa
 * (contenteditable) manda a mensagem, e Enter ou Espaço num botão com o foco é
 * o mesmo que clicar nele. Puro.
 */
export function efeitosDasTeclas(c: Combinacao[]): { enter: boolean; enterComModificador: boolean; ativa: boolean } {
  const enter = c.some((x) => x.teclas.key === "Enter");
  const enterComModificador = c.some((x) => x.teclas.key === "Enter" && (x.modificadores & 7) !== 0);
  // Enter e Espaço sem Ctrl/Alt/Meta ativam o elemento com o foco (botão, link, caixa)
  const ativa = c.some((x) => (x.teclas.key === "Enter" || x.teclas.key === " ") && (x.modificadores & 7) === 0);
  return { enter, enterComModificador, ativa };
}

const SETAS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export interface LeituraDaSequencia {
  /** alguma tecla tira o foco do lugar: Tab (com ou sem Shift) ou seta fora de campo de texto */
  moveFoco: boolean;
  /** uma tecla que escreve ou ativa vem DEPOIS de uma que moveu o foco: não dá para saber onde ela cai */
  atuaDepoisDeMover: boolean;
  /** alguma tecla escreve texto (letra, número, símbolo, espaço; Enter não) */
  escreve: boolean;
  /** Delete ou Backspace */
  apaga: boolean;
  /** letra, número ou símbolo sem Ctrl/Alt/Meta: fora de um campo de texto é atalho do site ("e" arquiva no Gmail) */
  atalhoDeTecla: boolean;
}

/**
 * Lê a sequência inteira, na ordem (B-1 e I-17 da auditoria). O risco olhava
 * só o campo com o foco ANTES de apertar, e "Tab Enter" numa busca saía como
 * escrita com o Enter caindo no botão seguinte. `campoDeTexto`: o foco está
 * num campo onde as setas andam no texto (aí elas não movem o foco). Puro.
 */
export function lerSequencia(c: readonly Combinacao[], campoDeTexto: boolean): LeituraDaSequencia {
  let moveFoco = false;
  let atuaDepoisDeMover = false;
  let escreve = false;
  let apaga = false;
  let atalhoDeTecla = false;
  for (const x of c) {
    const k = x.teclas.key;
    const semMod = (x.modificadores & 7) === 0;
    const escreveAqui = !!x.teclas.text && k !== "Enter";
    const ativaAqui = semMod && (k === "Enter" || k === " ");
    if ((escreveAqui || ativaAqui) && moveFoco) atuaDepoisDeMover = true;
    if (k === "Tab" || (SETAS.has(k) && !campoDeTexto)) moveFoco = true;
    if (escreveAqui) escreve = true;
    if (k === "Delete" || k === "Backspace") apaga = true;
    if (escreveAqui && semMod && k !== " ") atalhoDeTecla = true;
  }
  return { moveFoco, atuaDepoisDeMover, escreve, apaga, atalhoDeTecla };
}

/** "ctrl+shift" (o campo `modifiers` do Claude) → bitmask. Puro. */
export function modificadoresDe(texto: string | null | undefined): number {
  if (!texto) return 0;
  let m = 0;
  for (const p of texto.split("+")) {
    const v = MODIFICADOR[p.trim().toLowerCase()];
    if (v !== undefined) m |= v;
  }
  return m;
}
