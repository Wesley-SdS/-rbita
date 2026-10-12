/**
 * O QUE RODA DENTRO DA PÁGINA (PRD B2 e B3): ler, descrever um alvo, preparar
 * uma ação e mascarar o que é sensível, ANTES de qualquer byte sair do
 * navegador.
 *
 * É UMA função autocontida (`orbitaNaPagina`), sem nada do escopo do módulo:
 * ela é serializada e injetada. A extensão a injeta com
 * `chrome.scripting.executeScript({ func, world: "ISOLATED" })` (o mundo
 * isolado da extensão, que a página não enxerga, guarda o mapa de refs), e o
 * perfil dedicado (B6) com o `page.evaluate` do Playwright. Por isso todo
 * ajudante mora DENTRO dela, e o módulo não importa nada.
 *
 * Por que aqui e não na extensão: as duas mãos (o Chrome do dono e o perfil
 * dedicado) leem e mascaram com o MESMO código; uma correção de máscara vale
 * para as duas de uma vez.
 *
 * Sanitização (PRD §5.5): some o que o dono não vê. `display:none`,
 * `visibility:hidden`, opacidade zero, tamanho zero, recorte de leitor de tela
 * (1x1 com clip), fora da página, texto da cor do fundo, fonte microscópica,
 * `aria-hidden`, `<template>`, `<noscript>`, comentário HTML (que nem é nó de
 * texto) e o fragmento `#` da URL. É o mesmo truque dos ataques publicados
 * (texto branco no branco, campo oculto, HashJack), e todos eles dependem de o
 * leitor enxergar o que o humano não enxerga.
 */

export type PapelDoAlvo = string;

export interface ElementoLido {
  ref: string;
  papel: PapelDoAlvo;
  nome: string;
  valor?: string;
  estados?: string[];
  /** profundidade de marco (main, nav, form…), só para indentar */
  nivel: number;
}

export interface Leitura {
  url: string;
  titulo: string;
  texto?: string;
  elementos?: ElementoLido[];
  textoTruncado?: boolean;
  elementosTruncados?: boolean;
  /** login, captcha ou segundo fator visível: a Órbita para e avisa (B3) */
  bloqueio: "login" | "captcha" | "2fa" | null;
  /** quantos elementos escondidos foram tirados (para a medição e a bancada) */
  escondidos: number;
  /** endereços dos links VISÍVEIS (sem fragmento): ficam no core, para abrir um link visto não pedir aprovação; nunca vão ao modelo */
  links?: string[];
  viewport: { largura: number; altura: number; dpr: number };
}

export interface DescricaoDoAlvo {
  ref: string;
  papel: PapelDoAlvo;
  nome: string;
  /** o `type` do input, quando é input */
  tipo?: string;
  /** a tag em minúsculas ("select", "input", "div"): lista nativa e combobox ARIA têm o mesmo papel e se usam diferente */
  tag?: string;
  /** caixa de marcar, botão de opção ou interruptor: está marcado agora? */
  marcado?: boolean;
  /** senha, cartão, CVV, código de uso único: a Órbita não digita nem lê o valor */
  sensivel: boolean;
  /** clicar aqui envia um formulário */
  submit: boolean;
  /** campo de subir arquivo */
  upload: boolean;
  /** dentro de um formulário (Enter num campo envia) */
  emFormulario: boolean;
  href?: string;
  /** centro do alvo na janela, em pixels CSS */
  centro: { x: number; y: number };
  visivel: boolean;
  /** seletor CSS de reserva, para o roteiro achar o alvo quando o nome mudar um pouco */
  seletor: string;
}

export type PedidoNaPagina =
  | { tipo: "ler"; modo: "texto" | "arvore" | "ambos"; filtro: "interativos" | "visiveis" | "tudo"; maxElementos: number; maxCaracteres: number; ref?: string | null }
  | { tipo: "descrever"; ref?: string | null; x?: number | null; y?: number | null }
  | { tipo: "focado" }
  | { tipo: "preparar"; ref: string; assinatura: { papel: string; nome: string }; acao: string; agindoMs: number }
  | { tipo: "selecionar"; ref: string; assinatura: { papel: string; nome: string }; valor: string }
  | { tipo: "preencher_valor"; ref: string; assinatura: { papel: string; nome: string }; valor: string | number | boolean }
  | { tipo: "rolar"; ref?: string | null; x?: number | null; y?: number | null; direcao?: "cima" | "baixo" | "esquerda" | "direita" | null; quantidade: number }
  | { tipo: "achar"; papel?: string | null; nome?: string | null; texto?: string | null; seletor?: string | null }
  | { tipo: "agindo"; ms: number }
  | { tipo: "mascarar"; ligar: boolean };

export type RespostaNaPagina =
  | { ok: true; leitura: Leitura }
  | { ok: true; alvo: DescricaoDoAlvo }
  | { ok: true; focado: DescricaoDoAlvo | null }
  | { ok: true; feito: string }
  | { ok: false; erro: string; codigo: "sem_alvo" | "tela_mudou" | "sensivel" | "invalido" };

/**
 * A função injetada. Devolve só dado serializável. NÃO referencie nada fora
 * dela (nem tipos em tempo de execução, nem constantes do módulo).
 */
export function orbitaNaPagina(p: PedidoNaPagina): RespostaNaPagina {
  type Estado = { refs: Map<string, WeakRef<Element>>; porElemento: WeakMap<Element, string>; proximo: number; agindoAte: number };
  const g = globalThis as unknown as { __orbita?: Estado };
  if (!g.__orbita) g.__orbita = { refs: new Map(), porElemento: new WeakMap(), proximo: 1, agindoAte: 0 };
  const est = g.__orbita;

  const CONTROLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g;
  const limpo = (s: string, max: number) => s.replace(CONTROLE, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const urlSemFragmento = (u: string) => {
    try {
      const x = new URL(u);
      x.hash = "";
      return x.toString();
    } catch {
      return "";
    }
  };

  const refDe = (el: Element): string => {
    const r = est.porElemento.get(el);
    if (r && est.refs.get(r)?.deref() === el) return r;
    const novo = `ref_${est.proximo++}`;
    est.porElemento.set(el, novo);
    est.refs.set(novo, new WeakRef(el));
    return novo;
  };
  const elementoDe = (ref: string): Element | null => {
    const el = est.refs.get(ref)?.deref() ?? null;
    return el && el.isConnected ? el : null;
  };

  // ── visibilidade: o que o dono enxerga ──
  const corParaRgba = (c: string): [number, number, number, number] | null => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const v = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
    return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v.length > 3 ? (v[3] ?? 1) : 1];
  };
  const fundoEfetivo = (el: Element | null): [number, number, number] => {
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = corParaRgba(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0.5) return [c[0], c[1], c[2]];
    }
    return [255, 255, 255];
  };
  const cacheVisivel = new WeakMap<Element, boolean>();
  const cacheOpacidade = new WeakMap<Element, number>();
  const cacheFixo = new WeakMap<Element, boolean>();
  const doc = document.documentElement;
  const larguraDoc = Math.max(doc.scrollWidth, window.innerWidth);
  const alturaDoc = Math.max(doc.scrollHeight, window.innerHeight);
  let escondidos = 0;

  /** A opacidade que chega ao olho: a do elemento vezes a de todos os ancestrais (0,2 dentro de 0,2 é 0,04). */
  const opacidadeEfetiva = (el: Element): number => {
    const c = cacheOpacidade.get(el);
    if (c !== undefined) return c;
    const propria = Number(getComputedStyle(el).opacity);
    const o = (Number.isFinite(propria) ? propria : 1) * (el.parentElement ? opacidadeEfetiva(el.parentElement) : 1);
    cacheOpacidade.set(el, o);
    return o;
  };
  /** O elemento (ou um ancestral) fica parado na tela enquanto a página rola. */
  const fixo = (el: Element): boolean => {
    const c = cacheFixo.get(el);
    if (c !== undefined) return c;
    const p = getComputedStyle(el).position;
    const f = p === "fixed" || p === "sticky" || (!!el.parentElement && fixo(el.parentElement));
    cacheFixo.set(el, f);
    return f;
  };
  /** `clip: rect(...)` que não deixa sobrar nem um pixel. */
  const clipSemArea = (clip: string): boolean => {
    const m = clip.match(/rect\(([^)]{0,120})\)/);
    if (!m) return false;
    const v = m[1]!.split(/[\s,]+/).filter(Boolean).map((x) => (x === "auto" ? NaN : parseFloat(x)));
    if (v.length !== 4) return false;
    const [topo, direita, baixo, esquerda] = v as [number, number, number, number];
    return (Number.isFinite(baixo) && Number.isFinite(topo) && baixo - topo <= 1) || (Number.isFinite(direita) && Number.isFinite(esquerda) && direita - esquerda <= 1);
  };
  /** `clip-path` que esconde tudo: inset de metade ou mais, círculo ou elipse de raio zero, polígono num ponto só. */
  const clipPathSemArea = (cp: string): boolean => {
    if (!cp || cp === "none") return false;
    if (/inset\(\s*(4[5-9]|[5-9]\d|\d{3,})(\.\d+)?%/.test(cp)) return true;
    if (/(circle|ellipse)\(\s*0(px|%)?[\s)]/.test(cp)) return true;
    const poli = cp.match(/polygon\(([^)]{0,400})\)/);
    if (poli) {
      const pontos = new Set(poli[1]!.split(",").map((p) => p.trim().replace(/\s+/g, " ")));
      return pontos.size <= 1;
    }
    return false;
  };
  /**
   * Um ancestral que corta o que transborda (`overflow` hidden ou clip) e não
   * tem nenhum pedaço em comum com o elemento: o texto está lá, mas o dono não
   * vê. É o `height:0; overflow:hidden` com um parágrafo dentro. Ancestral que
   * rola (auto, scroll) só esconde se não tiver tamanho para rolar.
   */
  const cortadoPorAncestral = (el: Element, r: DOMRect): boolean => {
    for (let e = el.parentElement; e && e !== document.body && e !== doc; e = e.parentElement) {
      const s = getComputedStyle(e);
      const corta = (v: string) => v === "hidden" || v === "clip";
      const rola = (v: string) => v === "auto" || v === "scroll";
      if (!corta(s.overflowX) && !corta(s.overflowY) && !rola(s.overflowX) && !rola(s.overflowY)) continue;
      const a = e.getBoundingClientRect();
      if ((rola(s.overflowX) || rola(s.overflowY)) && !corta(s.overflowX) && !corta(s.overflowY)) {
        if (a.width < 2 || a.height < 2) return true;
        // dentro de uma área que ROLA, o dono chega rolando: o recorte de um ancestral mais de fora (o app inteiro
        // num `overflow:hidden` de 100vh, como Jira e Gmail) não esconde o que está abaixo da dobra
        return false;
      }
      const largura = Math.min(r.right, a.right) - Math.max(r.left, a.left);
      const altura = Math.min(r.bottom, a.bottom) - Math.max(r.top, a.top);
      if ((corta(s.overflowX) && largura < 1) || (corta(s.overflowY) && altura < 1)) return true;
    }
    return false;
  };
  /** Conteúdo de `<details>` fechado (fora do `<summary>` dele): o navegador não desenha. */
  const dentroDeDetailsFechado = (el: Element): boolean => {
    // começa no PAI: o próprio <details> fechado aparece (com o resumo); o que está dentro dele, fora do resumo, não
    for (let d = el.parentElement?.closest("details:not([open])") ?? null; d; d = d.parentElement?.closest("details:not([open])") ?? null) {
      const sum = el.closest("summary");
      if (!sum || sum.parentElement !== d) return true;
    }
    return false;
  };

  const visivel = (el: Element): boolean => {
    const c = cacheVisivel.get(el);
    if (c !== undefined) return c;
    let v = true;
    if (el.closest('[aria-hidden="true"], template, noscript, [hidden], [inert]') || dentroDeDetailsFechado(el)) v = false;
    else {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse" || s.contentVisibility === "hidden") v = false;
      else if (opacidadeEfetiva(el) < 0.05) v = false;
      else {
        const r = el.getBoundingClientRect();
        const comFilhos = el.children.length > 0;
        if ((r.width < 2 || r.height < 2) && !comFilhos) v = false;
        // recorte de leitor de tela: 1x1 com clip, a casa clássica do texto escondido
        else if ((r.width <= 2 || r.height <= 2) && ((s.clip !== "auto" && s.clip !== "") || /inset\(\s*(50|100)%/.test(s.clipPath))) v = false;
        else if (clipPathSemArea(s.clipPath) || (/^(absolute|fixed)$/.test(s.position) && clipSemArea(s.clip))) v = false;
        // fora da página: nem rolando o dono chega lá
        else if (r.right + window.scrollX <= 0 || r.bottom + window.scrollY <= 0 || r.left + window.scrollX >= larguraDoc || r.top + window.scrollY >= alturaDoc + 2000) v = false;
        else if (cortadoPorAncestral(el, r)) v = false;
      }
      if (v && el.parentElement && el.parentElement !== document.body) v = visivel(el.parentElement);
    }
    cacheVisivel.set(el, v);
    return v;
  };
  /**
   * Outro elemento opaco por cima, no MESMO plano de rolagem: o texto está ali,
   * mas o dono vê a capa. Um cabeçalho fixo sobre um texto que rola não conta
   * (rolando, o dono lê), e só dá para conferir o que está na janela. A borda
   * da própria Órbita não conta como capa.
   */
  const cacheCoberto = new WeakMap<Element, boolean>();
  const coberto = (el: Element): boolean => {
    const c = cacheCoberto.get(el);
    if (c !== undefined) return c;
    let v = false;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + Math.min(r.height / 2, 12);
    if (r.width >= 1 && r.height >= 1 && x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight) {
      const topo = document.elementFromPoint(x, y);
      if (topo && topo !== el && !el.contains(topo) && !topo.contains(el) && topo.tagName !== "ORBITA-BORDA") {
        const s = getComputedStyle(topo);
        const fundo = corParaRgba(s.backgroundColor);
        const opaco = (!!fundo && fundo[3] > 0.5) || (s.backgroundImage !== "none" && s.backgroundImage !== "");
        v = opaco && opacidadeEfetiva(topo) > 0.5 && fixo(topo) === fixo(el);
      }
    }
    cacheCoberto.set(el, v);
    return v;
  };
  /** texto que o dono não lê: fonte microscópica, transparente, da cor do fundo, empurrado para fora (text-indent) ou coberto */
  const textoInvisivel = (el: Element): boolean => {
    const s = getComputedStyle(el);
    if (parseFloat(s.fontSize) < 3) return true;
    const recuo = parseFloat(s.textIndent);
    if (Number.isFinite(recuo) && (recuo <= -200 || recuo >= Math.max(window.innerWidth, larguraDoc))) return true;
    const cor = corParaRgba(s.color);
    if (cor) {
      if (cor[3] < 0.1) return true;
      const f = fundoEfetivo(el);
      const dist = Math.abs(cor[0] - f[0]) + Math.abs(cor[1] - f[1]) + Math.abs(cor[2] - f[2]);
      if (dist < 24) return true;
    }
    return coberto(el);
  };
  const naJanela = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
  };

  // ── o que é sensível: a Órbita não lê o valor nem digita ──
  // UM conjunto de pistas para as duas perguntas ("este campo é sensível?" e "a página pede segundo fator?"):
  // com dois conjuntos, "Código recebido por SMS" pausava a tarefa como 2FA e mesmo assim saía como campo comum.
  // Cada pedaço é cortado ANTES da regex e nenhuma regex tem `.*`: "cod".repeat(20000) num <label> levava 6 s.
  const PISTA_FORTE =
    /(passw|senha|\bpwd\b|passcode|cvv|cvc|\bcsc\b|\bcvn\b|security code|c[oó]d(igo)?\b.{0,40}\bseg|cart[aã]o|card (number|num|no)\b|cardnumber|\bcc (num|number|exp|csc)|credit|n[uú]mero do cart|validade|expira|expiry|expiration|\bmm ?\/ ?(aa|yy)\b|\botp\b|totp|one ?time|\btoken\b|\bsms\b|2fa|\bmfa\b|\bpin\b|pin ?code|pincode|verifica|verification|autentica|authenticat)/i;
  const PISTA_FRACA = /(c[oó]digo|\bcode\b|\bcodigo\b)/i;
  /** "código postal", "código promocional", "código de barras": código que não é segredo */
  const CODIGO_COMUM = /(postal|\bcep\b|\bzip\b|promo|cupom|coupon|voucher|barras|barcode|produto|product|rastre|tracking|desconto|discount|\bpa[ií]s\b|country|\barea\b|\bddd\b|\bsku\b|refer[eê]ncia|reference|pedido|order)/i;
  const pistasDe = (el: Element): string => {
    const partes: string[] = [el.id, el.getAttribute("name") ?? "", el.getAttribute("aria-label") ?? "", el.getAttribute("placeholder") ?? "", el.getAttribute("title") ?? ""];
    const labels = (el as HTMLInputElement).labels;
    if (labels) for (const l of [...labels].slice(0, 3)) partes.push(l.textContent ?? "");
    const lb = el.getAttribute("aria-labelledby");
    if (lb) for (const id of lb.split(/\s+/).slice(0, 3)) partes.push(document.getElementById(id)?.textContent ?? "");
    // camelCase e separadores viram espaço: "smsCode", "sms_code" e "pin-code" passam a ter palavras
    return partes
      .map((p) => p.slice(0, 300))
      .join(" ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_\-.[\]]+/g, " ")
      .slice(0, 1200);
  };
  const pistaSensivel = (p: string): boolean => PISTA_FORTE.test(p) || (PISTA_FRACA.test(p) && !CODIGO_COMUM.test(p));
  /** Número de cartão pelo dígito verificador (Luhn): 13 a 19 dígitos. Barato, e pega o campo sem pista nenhuma. */
  const pareceCartao = (valor: string): boolean => {
    if (valor.length > 30 || !/^[\d\s-]+$/.test(valor)) return false;
    const d = valor.replace(/\D/g, "");
    if (d.length < 13 || d.length > 19) return false;
    let soma = 0;
    for (let i = 0; i < d.length; i++) {
      let n = d.charCodeAt(d.length - 1 - i) - 48;
      if (i % 2 === 1) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      soma += n;
    }
    return soma % 10 === 0;
  };
  /** Campo de código de uso único: o autocomplete diz, ou é numérico curto com pista de código, ou é uma das caixinhas de 1 dígito. */
  const ehOtp = (el: Element): boolean => {
    if (!(el instanceof HTMLInputElement)) return false;
    const auto = (el.getAttribute("autocomplete") ?? "").toLowerCase();
    if (auto.includes("one-time-code")) return true;
    const p = pistasDe(el);
    if (/(\botp\b|totp|one ?time|\bsms\b|2fa|\bmfa\b|\btoken\b|verifica|verification|\bpin\b|pin ?code|pincode|passcode)/i.test(p)) return true;
    const numerico = (el.getAttribute("inputmode") ?? "").toLowerCase() === "numeric" || /^\\?d|\[0-9\]/.test(el.getAttribute("pattern") ?? "") || el.type === "number" || el.type === "tel";
    const max = el.maxLength;
    if (numerico && max >= 4 && max <= 8 && PISTA_FRACA.test(p) && !CODIGO_COMUM.test(p)) return true;
    // 4 a 8 caixinhas de um dígito lado a lado: o código de verificação partido
    if (max === 1 && el.parentElement) {
      const irmas = [...el.parentElement.querySelectorAll("input")].filter((i) => i.maxLength === 1);
      if (irmas.length >= 4 && irmas.length <= 8) return true;
    }
    return false;
  };
  const sensivel = (el: Element): boolean => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
      return el instanceof HTMLElement && el.isContentEditable ? pistaSensivel(pistasDe(el)) : false;
    }
    const tipo = (el.getAttribute("type") ?? "").toLowerCase();
    if (tipo === "password") return true;
    const auto = (el.getAttribute("autocomplete") ?? "").toLowerCase();
    if (/\bcc-|one-time-code|current-password|new-password/.test(auto)) return true;
    if (ehOtp(el)) return true;
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && pareceCartao(el.value.trim())) return true;
    return pistaSensivel(pistasDe(el));
  };
  /** O contenteditable sensível em volta deste nó (o texto dele nunca sai). */
  const dentroDeEditavelSensivel = (el: Element): boolean => {
    const ed = el.closest('[contenteditable]:not([contenteditable="false"])');
    return !!ed && sensivel(ed);
  };

  // ── papel e nome acessíveis (a versão simples do accname, a mesma na leitura e na execução) ──
  const PAPEL_DA_TAG: Record<string, string> = {
    A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox", H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading",
    NAV: "navigation", MAIN: "main", FORM: "form", HEADER: "banner", FOOTER: "contentinfo", ASIDE: "complementary", IMG: "img", SUMMARY: "button", DIALOG: "dialog",
    TABLE: "table", LI: "listitem", OPTION: "option", LABEL: "label",
  };
  const papel = (el: Element): string => {
    // o `role` é texto da página: só um papel de verdade (letras, curto) passa, senão "generic"
    const r = el.getAttribute("role");
    if (r) {
      const p = r.trim().split(/\s+/)[0]!.toLowerCase();
      return /^[a-z]{2,20}$/.test(p) ? p : "generic";
    }
    if (el instanceof HTMLInputElement) {
      const t = (el.type || "text").toLowerCase();
      return t === "checkbox" ? "checkbox" : t === "radio" ? "radio" : t === "submit" || t === "button" || t === "reset" || t === "image" ? "button" : t === "range" ? "slider" : t === "file" ? "button" : t === "search" ? "searchbox" : "textbox";
    }
    if (el.tagName === "A" && !el.hasAttribute("href")) return "generic";
    if (el instanceof HTMLElement && el.isContentEditable) return "textbox";
    return PAPEL_DA_TAG[el.tagName] ?? "generic";
  };
  const textoVisivelDe = (el: Element, max: number): string => {
    let out = "";
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n && out.length < max; n = w.nextNode()) {
      const pai = n.parentElement;
      // o texto padrão de um <textarea> é o VALOR dele (sai por `valorDe`, mascarado se for sensível)
      if (!pai || pai.tagName === "TEXTAREA" || !visivel(pai) || textoInvisivel(pai) || dentroDeEditavelSensivel(pai)) continue;
      out += ` ${(n.nodeValue ?? "").slice(0, max)}`;
    }
    return limpo(out, max);
  };
  const nome = (el: Element): string => {
    // o conteúdo de um editável sensível nunca vira nome: só o rótulo dele
    if (el instanceof HTMLElement && el.isContentEditable && sensivel(el)) return limpo(el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "", 120);
    const aria = el.getAttribute("aria-label");
    if (aria?.trim()) return limpo(aria, 120);
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)).filter((x): x is HTMLElement => !!x).map((x) => textoVisivelDe(x, 120)).join(" ");
      if (t.trim()) return limpo(t, 120);
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      const l = el.labels?.[0];
      if (l) {
        const t = textoVisivelDe(l, 120);
        if (t) return t;
      }
      if (el instanceof HTMLInputElement && ["submit", "button", "reset"].includes(el.type) && el.value) return limpo(el.value, 120);
      const ph = el.getAttribute("placeholder") ?? el.getAttribute("title");
      if (ph) return limpo(ph, 120);
      return limpo(el.getAttribute("name") ?? "", 60);
    }
    if (el instanceof HTMLImageElement) return limpo(el.alt || el.title || "", 120);
    const t = textoVisivelDe(el, 120);
    if (t) return t;
    return limpo(el.getAttribute("title") ?? "", 120);
  };
  const INTERATIVO = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="combobox"], [role="textbox"], [role="searchbox"], [contenteditable="true"], [contenteditable=""], [tabindex]:not([tabindex="-1"])';
  const ehInterativo = (el: Element) => el.matches(INTERATIVO);
  /** Campo de formulário: o que está dentro dele (as <option>, o texto) não é outro alvo. */
  const folhaDeCampo = (el: Element) => /^(INPUT|SELECT|TEXTAREA|OPTION)$/.test(el.tagName) || /^(textbox|searchbox|combobox|slider|option)$/.test(papel(el));

  /** O que está de fato no ponto, descendo pelos shadow roots abertos (o clique cai nele, não no host). */
  const noPonto = (x: number, y: number): Element | null => {
    let hit = document.elementFromPoint(x, y);
    for (let i = 0; hit?.shadowRoot && i < 10; i++) {
      const dentro = hit.shadowRoot.elementFromPoint(x, y);
      if (!dentro || dentro === hit) break;
      hit = dentro;
    }
    return hit;
  };
  /** O ponto acerta o alvo: o próprio, ou um pedaço dele que não seja OUTRO alvo (o "Excluir" dentro do card). */
  const acerta = (el: Element, hit: Element | null): boolean => {
    // sobe do que está no ponto até o alvo (atravessando shadow roots); outro alvo no caminho é outra coisa
    for (let e: Element | null = hit, i = 0; e && i < 200; e = e.parentElement ?? (((e.getRootNode() as ShadowRoot).host as Element | undefined) ?? null), i++) {
      if (e === el) return true;
      if (ehInterativo(e)) return false;
    }
    return false;
  };
  /**
   * Onde clicar para acertar SÓ o alvo. O centro primeiro; se ali houver outra
   * coisa (um banner de cookies, um modal, um cabeçalho fixo, um botão dentro do
   * card), tenta uma grade de pontos do alvo. Nenhum serve: null, e quem chamou
   * recusa com `tela_mudou` em vez de clicar no que estiver lá.
   */
  const pontoQueAcerta = (el: Element): { x: number; y: number } | null => {
    const r = el.getBoundingClientRect();
    const centro = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    if (acerta(el, noPonto(centro.x, centro.y))) return centro;
    const passos = [0.5, 0.25, 0.75, 0.1, 0.9];
    for (const fy of passos) {
      for (const fx of passos) {
        const x = Math.round(r.left + r.width * fx);
        const y = Math.round(r.top + r.height * fy);
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
        if (acerta(el, noPonto(x, y))) return { x, y };
      }
    }
    return null;
  };
  const ehMarco = (el: Element) => /^(main|navigation|form|banner|contentinfo|complementary|dialog|heading|table)$/.test(papel(el));

  const valorDe = (el: Element): string | undefined => {
    if (el instanceof HTMLInputElement) {
      if (el.type === "checkbox" || el.type === "radio" || el.type === "file") return undefined;
      if (!el.value) return undefined;
      return sensivel(el) ? "[oculto]" : limpo(el.value, 200);
    }
    if (el instanceof HTMLTextAreaElement) return el.value ? (sensivel(el) ? "[oculto]" : limpo(el.value, 200)) : undefined;
    if (el instanceof HTMLSelectElement) return sensivel(el) ? "[oculto]" : limpo(el.selectedOptions[0]?.textContent ?? "", 120) || undefined;
    return undefined;
  };
  const estadosDe = (el: Element): string[] => {
    const s: string[] = [];
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) s.push(el.checked ? "marcado" : "desmarcado");
    const ac = el.getAttribute("aria-checked");
    if (ac) s.push(ac === "true" ? "marcado" : "desmarcado");
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") s.push("desativado");
    if (el.getAttribute("aria-expanded") === "true") s.push("aberto");
    if ((el as HTMLInputElement).required) s.push("obrigatório");
    if (sensivel(el)) s.push("sensível");
    return s;
  };
  const ehSubmit = (el: Element): boolean => {
    if (el instanceof HTMLButtonElement) return (el.getAttribute("type") ?? "submit").toLowerCase() === "submit" && !!el.form;
    if (el instanceof HTMLInputElement) return (el.type === "submit" || el.type === "image") && !!el.form;
    return false;
  };
  const seletorDe = (el: Element): string => {
    const partes: string[] = [];
    for (let e: Element | null = el; e && e !== document.documentElement && partes.length < 6; e = e.parentElement) {
      if (e.id && /^[A-Za-z][\w-]*$/.test(e.id)) {
        partes.unshift(`#${e.id}`);
        break;
      }
      const pai: Element | null = e.parentElement;
      const tag = e.tagName.toLowerCase();
      const irmaos = pai ? [...pai.children].filter((x) => x.tagName === e!.tagName) : [];
      partes.unshift(irmaos.length > 1 ? `${tag}:nth-of-type(${irmaos.indexOf(e) + 1})` : tag);
    }
    return partes.join(" > ");
  };
  const descrever = (el: Element): DescricaoDoAlvo => {
    const r = el.getBoundingClientRect();
    return {
      ref: refDe(el),
      papel: papel(el),
      nome: nome(el),
      tipo: el instanceof HTMLInputElement ? (el.type || "text").toLowerCase() : undefined,
      tag: el.tagName.toLowerCase().slice(0, 30),
      ...(el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")
        ? { marcado: el.checked }
        : el.getAttribute("aria-checked")
          ? { marcado: el.getAttribute("aria-checked") === "true" }
          : {}),
      sensivel: sensivel(el),
      submit: ehSubmit(el),
      upload: el instanceof HTMLInputElement && el.type === "file",
      emFormulario: !!el.closest("form"),
      href: el instanceof HTMLAnchorElement ? urlSemFragmento(el.href) || undefined : undefined,
      centro: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
      visivel: visivel(el),
      seletor: seletorDe(el),
    };
  };
  const conferir = (ref: string, a: { papel: string; nome: string }): Element | RespostaNaPagina => {
    const el = elementoDe(ref);
    if (!el) return { ok: false, erro: `O alvo ${ref} não está mais na página. Leia a página de novo.`, codigo: "sem_alvo" };
    // a assinatura do que o dono (ou o crítico) viu: se o botão mudou de nome, não é o mesmo botão
    if (papel(el) !== a.papel || nome(el) !== a.nome) return { ok: false, erro: "A tela mudou entre propor e executar: o alvo não é mais o mesmo. Leia a página de novo.", codigo: "tela_mudou" };
    return el;
  };
  const bloqueio = (): Leitura["bloqueio"] => {
    const iframes = [...document.querySelectorAll("iframe")].map((f) => f.getAttribute("src") ?? "").join(" ");
    if (/recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha/i.test(iframes) || document.querySelector(".g-recaptcha, .h-captcha, .cf-turnstile, #challenge-form")) return "captcha";
    const campos = [...document.querySelectorAll("input")].filter((i) => visivel(i));
    // as mesmas pistas do campo sensível: o código que a Órbita não digita é o que pausa a tarefa
    if (campos.some((i) => ehOtp(i))) return "2fa";
    // tela de LOGIN é senha vazia com no máximo dois outros campos (usuário, e-mail): um formulário longo que
    // também pede uma senha não é login, e tratá-lo como login parou a tarefa inteira à espera do dono (B0, 10/10/2026)
    const senhas = campos.filter((i) => i.type === "password");
    const outros = campos.filter((i) => i.type !== "password" && !["hidden", "submit", "button", "checkbox", "radio", "image", "reset"].includes(i.type));
    const vazia = senhas.find((i) => !i.value);
    if (vazia) {
      const botoes = [...(vazia.form ?? document).querySelectorAll("button, input[type=submit]")].map((b) => (b as HTMLInputElement).value || b.textContent || "").join(" ");
      const pistas = `${document.title} ${document.querySelector("h1")?.textContent ?? ""} ${botoes}`;
      const ehLogin = (vazia.getAttribute("autocomplete") ?? "").includes("current-password") || /\b(entrar|login|log in|sign in|acessar|autenticar|iniciar sess)/i.test(pistas) || outros.length <= 1;
      if (ehLogin) return "login";
    }
    return null;
  };

  try {
    switch (p.tipo) {
      case "agindo": {
        est.agindoAte = Date.now() + Math.max(0, Math.min(p.ms, 10_000));
        return { ok: true, feito: "agindo" };
      }
      case "mascarar": {
        // na hora do screenshot, o texto de campo sensível some da imagem também
        const id = "__orbita_mascara";
        document.getElementById(id)?.remove();
        if (p.ligar) {
          const st = document.createElement("style");
          st.id = id;
          // Sem `text-shadow`: a sombra de um texto transparente DESENHA o glifo (a versão antiga com
          // `text-shadow: 0 0 0 #888` mostrava a senha em cinza). O fundo chapado diz que ali havia algo.
          st.textContent =
            'input[type="password"], input[autocomplete*="cc-"], input[autocomplete*="one-time-code"], [data-orbita-sensivel], [data-orbita-sensivel] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; -webkit-text-security: disc !important; background-image: none !important; background-color: #c8c8c8 !important; }';
          for (const el of document.querySelectorAll('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) if (sensivel(el)) el.setAttribute("data-orbita-sensivel", "");
          (document.head ?? document.documentElement).appendChild(st);
          // a página pode tirar o estilo no meio da captura: quem tira a foto confere que ele continua lá
          if (!document.getElementById(id)) return { ok: false, erro: "Não consegui esconder os campos sensíveis.", codigo: "invalido" };
        } else {
          for (const el of document.querySelectorAll("[data-orbita-sensivel]")) el.removeAttribute("data-orbita-sensivel");
        }
        return { ok: true, feito: p.ligar ? "mascarado" : "desmascarado" };
      }
      case "ler": {
        const raiz = p.ref ? elementoDe(p.ref) : document.body;
        if (!raiz) return { ok: false, erro: `O alvo ${p.ref} não está mais na página.`, codigo: "sem_alvo" };
        const leitura: Leitura = {
          url: urlSemFragmento(location.href),
          titulo: limpo(document.title, 200),
          bloqueio: bloqueio(),
          escondidos: 0,
          viewport: { largura: window.innerWidth, altura: window.innerHeight, dpr: window.devicePixelRatio || 1 },
        };
        if (p.modo !== "arvore") {
          // texto principal: o conteúdo, não o menu nem o rodapé, quando a página diz onde está
          const principal = p.ref ? raiz : (document.querySelector("main, [role=main], article") ?? raiz);
          const partes: string[] = [];
          let total = 0;
          const w = document.createTreeWalker(principal, NodeFilter.SHOW_TEXT);
          const vistos = new WeakSet<Element>();
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            const pai = n.parentElement;
            // TEXTAREA: o texto padrão é o valor do campo, que sai mascarado pelo `valorDe` abaixo
            if (!pai || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|TITLE|TEXTAREA)$/i.test(pai.tagName)) continue;
            const t = limpo((n.nodeValue ?? "").slice(0, 4000), 2000);
            if (!t) continue;
            if (dentroDeEditavelSensivel(pai)) continue;
            if (!visivel(pai) || textoInvisivel(pai)) {
              if (!vistos.has(pai)) {
                vistos.add(pai);
                escondidos++;
              }
              continue;
            }
            partes.push(t);
            total += t.length + 1;
            if (total > p.maxCaracteres) break;
          }
          // valores digitados que o dono vê na tela (mascarados quando sensíveis)
          for (const el of principal.querySelectorAll("input, textarea, select")) {
            if (!visivel(el)) continue;
            const v = valorDe(el);
            if (v) partes.push(`[${nome(el) || papel(el)}: ${v}]`);
          }
          const texto = partes.join(" ");
          leitura.texto = texto.slice(0, p.maxCaracteres);
          leitura.textoTruncado = texto.length > p.maxCaracteres;
        }
        if (p.modo !== "texto") {
          const lista: ElementoLido[] = [];
          let passou = false;
          const visitar = (el: Element, nivel: number) => {
            if (lista.length >= p.maxElementos) {
              passou = true;
              return;
            }
            if (!visivel(el)) {
              if (ehInterativo(el)) escondidos++;
              return;
            }
            let prox = nivel;
            const inter = ehInterativo(el);
            const marco = ehMarco(el);
            if (inter || marco) {
              const dentro = p.filtro === "tudo" || naJanela(el);
              if (dentro && (inter || p.filtro !== "interativos")) {
                const item: ElementoLido = { ref: refDe(el), papel: papel(el), nome: nome(el), nivel };
                const v = valorDe(el);
                if (v) item.valor = v;
                const e = estadosDe(el);
                if (e.length) item.estados = e;
                lista.push(item);
              }
              if (marco) prox = nivel + 1;
              // Dentro de um CAMPO não há outro alvo. Dentro de um card clicável (tabindex) ou de um link, pode
              // haver: um botão "Excluir" no meio de um card "Ver detalhes" precisa da ref dele, senão o modelo
              // clica no card, o risco sai do nome do card e o clique cai no botão de dentro.
              if (inter && (folhaDeCampo(el) || (el instanceof HTMLElement && el.isContentEditable))) return;
              if (inter) prox = nivel + 1;
            }
            for (const f of el.children) visitar(f, prox);
            // shadow DOM aberto: os componentes modernos guardam os botões ali
            const sr = (el as HTMLElement).shadowRoot;
            if (sr) for (const f of sr.children) visitar(f, prox);
          };
          visitar(raiz, 0);
          leitura.elementos = lista;
          leitura.elementosTruncados = passou;
        }
        const links = new Set<string>();
        for (const a of document.querySelectorAll("a[href]")) {
          if (links.size >= 400) break;
          const h = urlSemFragmento((a as HTMLAnchorElement).href);
          if (/^https?:/.test(h) && visivel(a)) links.add(h);
        }
        leitura.links = [...links];
        leitura.escondidos = escondidos;
        return { ok: true, leitura };
      }
      case "descrever": {
        let el: Element | null = null;
        if (p.ref) el = elementoDe(p.ref);
        else if (typeof p.x === "number" && typeof p.y === "number") {
          // coordenada do Claude vira ELEMENTO: o risco pelo alvo continua valendo
          el = noPonto(p.x, p.y);
          while (el && !ehInterativo(el) && el !== document.body) el = el.parentElement ?? (((el.getRootNode() as ShadowRoot).host as Element | undefined) ?? null);
        }
        if (!el || el === document.body || el === document.documentElement) return { ok: false, erro: "Não há um alvo que dê para usar ali.", codigo: "sem_alvo" };
        return { ok: true, alvo: descrever(el) };
      }
      case "focado": {
        const el = document.activeElement;
        return { ok: true, focado: el && el !== document.body && el !== document.documentElement ? descrever(el) : null };
      }
      case "preparar": {
        const el = conferir(p.ref, p.assinatura);
        if (!(el instanceof Element)) return el;
        if ((p.acao === "preencher" || p.acao === "digitar") && sensivel(el)) return { ok: false, erro: "Campo de senha, cartão ou código: a Órbita não digita aqui. Peça ao dono.", codigo: "sensivel" };
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" as ScrollBehavior });
        if (p.acao === "preencher" && el instanceof HTMLElement) {
          el.focus();
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
        }
        const alvo = descrever(el);
        if (p.acao !== "preencher") {
          // o clique cai num PONTO, e o ponto é de quem estiver por cima: confere quem está lá
          const ponto = pontoQueAcerta(el);
          if (!ponto) return { ok: false, erro: "Há outra coisa por cima do alvo (um aviso, uma janela ou outro botão dentro dele): nada foi feito. Leia a página de novo.", codigo: "tela_mudou" };
          alvo.centro = ponto;
        }
        est.agindoAte = Date.now() + Math.max(0, Math.min(p.agindoMs, 10_000));
        return { ok: true, alvo };
      }
      case "selecionar": {
        const el = conferir(p.ref, p.assinatura);
        if (!(el instanceof Element)) return el;
        if (!(el instanceof HTMLSelectElement)) return { ok: false, erro: "O alvo não é uma lista de opções.", codigo: "invalido" };
        if (sensivel(el)) return { ok: false, erro: "Campo sensível: a Órbita não escolhe aqui.", codigo: "sensivel" };
        const alvo = p.valor.trim().toLowerCase();
        const op = [...el.options].find((o) => o.value.toLowerCase() === alvo) ?? [...el.options].find((o) => limpo(o.textContent ?? "", 200).toLowerCase() === alvo);
        if (!op) return { ok: false, erro: `Não há a opção "${p.valor}" nessa lista.`, codigo: "invalido" };
        el.value = op.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        // o texto da opção é da página: não volta ao modelo como frase da Órbita
        return { ok: true, feito: "Opção escolhida." };
      }
      case "preencher_valor": {
        // o `form_input` do Claude: valor direto no campo (caixa de marcar com booleano)
        const el = conferir(p.ref, p.assinatura);
        if (!(el instanceof Element)) return el;
        if (sensivel(el)) return { ok: false, erro: "Campo de senha, cartão ou código: a Órbita não digita aqui. Peça ao dono.", codigo: "sensivel" };
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
          el.checked = Boolean(p.valor);
        } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          // o setter nativo: React e afins só percebem o valor por ele
          Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, String(p.valor));
        } else return { ok: false, erro: "O alvo não é um campo de formulário.", codigo: "invalido" };
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, feito: "Campo preenchido." };
      }
      case "rolar": {
        const passo = Math.max(1, Math.min(p.quantidade, 10)) * 120;
        const dx = p.direcao === "direita" ? passo : p.direcao === "esquerda" ? -passo : 0;
        const dy = p.direcao === "baixo" ? passo : p.direcao === "cima" ? -passo : 0;
        let el: Element | null = p.ref ? elementoDe(p.ref) : typeof p.x === "number" && typeof p.y === "number" ? document.elementFromPoint(p.x, p.y) : null;
        if (p.ref && !el) return { ok: false, erro: `O alvo ${p.ref} não está mais na página.`, codigo: "sem_alvo" };
        if (p.ref && el && !p.direcao) {
          el.scrollIntoView({ block: "center" });
          return { ok: true, feito: "Rolei até o alvo." };
        }
        // rola o primeiro ancestral que rola de verdade; sem ele, a página
        while (el && el !== document.body) {
          const s = getComputedStyle(el);
          if ((/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) || (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth)) break;
          el = el.parentElement;
        }
        if (el && el !== document.body) el.scrollBy({ left: dx, top: dy });
        else window.scrollBy({ left: dx, top: dy });
        return { ok: true, feito: `Rolei para ${p.direcao ?? "baixo"}.` };
      }
      case "achar": {
        // o alvo SEMÂNTICO do roteiro: papel e nome primeiro (sobrevive a mudança de layout), seletor de reserva
        const candidatos = [...document.querySelectorAll(INTERATIVO)].filter((e) => visivel(e));
        // sem nome, a busca por nome casaria o PRIMEIRO elemento do papel (outro botão qualquer): vai direto ao texto e ao seletor
        let el = p.nome ? (candidatos.find((e) => (!p.papel || papel(e) === p.papel) && nome(e) === p.nome) ?? null) : null;
        if (!el && p.texto) el = candidatos.find((e) => (!p.papel || papel(e) === p.papel) && textoVisivelDe(e, 200).includes(p.texto!)) ?? null;
        if (!el && p.seletor) {
          try {
            const s = document.querySelector(p.seletor);
            if (s && visivel(s) && (!p.papel || papel(s) === p.papel)) el = s;
          } catch {
            /* seletor velho que nem é mais válido */
          }
        }
        if (!el) return { ok: false, erro: "O alvo do roteiro não está na página.", codigo: "sem_alvo" };
        return { ok: true, alvo: descrever(el) };
      }
    }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message.slice(0, 200) : "falha na página", codigo: "invalido" };
  }
  return { ok: false, erro: "pedido desconhecido", codigo: "invalido" };
}
