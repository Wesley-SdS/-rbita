import type { PedidoNaPagina, RespostaNaPagina } from "./pagina";
import type { Ordem, ResultadoDaOrdem } from "./protocolo";
import { modificadoresDe, traduzirTeclas, type Combinacao } from "./teclas";

/**
 * AS MÃOS NUMA ABA, pelo CDP (PRD B3). A extensão (com `chrome.debugger`) e o
 * perfil dedicado (com a sessão CDP do Playwright) executam a ordem `agir` e
 * a captura com ESTE código: muda só como se fala com a aba (`MaosDaAba`).
 *
 * Por que CDP e não `element.click()`: evento sintético (`isTrusted: false`)
 * é recusado por boa parte dos sites, e o clique por CDP é igual ao do mouse.
 * O preço é que o evento do CDP TAMBÉM chega à página como `isTrusted`, então
 * a detecção de "o dono mexeu" não pode olhar só isso: antes de cada entrada
 * a página é marcada como "a Órbita está agindo" por alguns milissegundos
 * (`agindo`), e só o evento confiável FORA dessa janela é do dono.
 *
 * Toda ação com alvo passa pelo `preparar` da página, que confere a
 * assinatura (papel e nome) do alvo aprovado e recusa campo sensível: é a
 * trava dura do lado das mãos, que não depende do api.
 */

export interface MaosDaAba {
  cdp(metodo: string, params?: Record<string, unknown>): Promise<unknown>;
  pagina(p: PedidoNaPagina): Promise<RespostaNaPagina>;
  /**
   * O mesmo pedido em TODOS os quadros da aba (a máscara da captura): o campo
   * de cartão do Stripe, do Mercado Pago e do PagSeguro mora num iframe, e a
   * máscara só do documento principal deixava o número sair na imagem. Uma
   * resposta por quadro; sem isto, vale só o principal.
   */
  paginaEmTodosOsQuadros?(p: PedidoNaPagina): Promise<RespostaNaPagina[]>;
}

export class RecusaDasMaos extends Error {
  constructor(
    message: string,
    public readonly codigo: string,
  ) {
    super(message);
    this.name = "RecusaDasMaos";
  }
}

type OrdemAgir = Extract<Ordem, { tipo: "agir" }>;

function exigir<T extends RespostaNaPagina>(r: T): Exclude<T, { ok: false }> {
  if (!r.ok) throw new RecusaDasMaos(r.erro, r.codigo);
  return r as Exclude<T, { ok: false }>;
}

const BOTAO: Record<string, { button: "left" | "right" | "middle"; cliques: number }> = {
  clicar: { button: "left", cliques: 1 },
  marcar: { button: "left", cliques: 1 },
  clique_duplo: { button: "left", cliques: 2 },
  clique_triplo: { button: "left", cliques: 3 },
  clique_direito: { button: "right", cliques: 1 },
  clique_meio: { button: "middle", cliques: 1 },
};

async function clicarEm(m: MaosDaAba, x: number, y: number, button: "left" | "right" | "middle", cliques: number, modificadores: number): Promise<void> {
  await m.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers: modificadores });
  for (let i = 1; i <= cliques; i++) {
    await m.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: i, modifiers: modificadores });
    await m.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: i, modifiers: modificadores });
  }
}

/**
 * Aperta a sequência tecla a tecla. `antes` roda antes de cada combinação e
 * pode lançar (é onde o foco é conferido de novo): "Tab Enter" aprovado num
 * campo de busca não pode virar um Enter no botão "Comprar" que o Tab trouxe.
 */
async function apertar(m: MaosDaAba, texto: string, repetir = 1, antes?: (c: Combinacao) => Promise<void>): Promise<void> {
  const combos = traduzirTeclas(texto);
  for (let r = 0; r < Math.max(1, Math.min(repetir, 100)); r++) {
    for (const c of combos) {
      if (antes) await antes(c);
      const base = { key: c.teclas.key, code: c.teclas.code, windowsVirtualKeyCode: c.teclas.keyCode, nativeVirtualKeyCode: c.teclas.keyCode, modifiers: c.modificadores };
      await m.cdp("Input.dispatchKeyEvent", { type: c.teclas.text ? "keyDown" : "rawKeyDown", ...base, ...(c.teclas.text ? { text: c.teclas.text, unmodifiedText: c.teclas.text } : {}) });
      await m.cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    }
  }
}

/** A combinação escreve no campo (letra, número, espaço) ou ativa o que tem o foco (Enter, Espaço)? Puro. */
export function comboQueAtua(c: Combinacao): { escreve: boolean; ativa: boolean } {
  const semMod = (c.modificadores & 7) === 0;
  const ativa = semMod && (c.teclas.key === "Enter" || c.teclas.key === " ");
  const escreve = !!c.teclas.text && c.teclas.key !== "Enter";
  return { escreve, ativa };
}

/**
 * O campo com o foco é o mesmo que foi visto ao propor? Digitar e apertar
 * tecla não têm ref: sem isto, o Enter aprovado na busca caía no botão
 * "Comprar" se o foco tivesse ido para ele (B4 da revisão).
 */
function conferirFocado(o: OrdemAgir, agora: { papel: string; nome: string } | null | undefined): void {
  if (o.focado === undefined) return;
  const igual = !o.focado ? !agora : !!agora && agora.papel === o.focado.papel && agora.nome === o.focado.nome;
  if (!igual) throw new RecusaDasMaos(`${TELA_MUDOU} O campo com o foco não é mais o mesmo.`, "tela_mudou");
}

/** Parâmetros de rastreio que a página põe e tira sozinha: não mudam o que está na tela. */
const RASTREIO = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_eid|_ga|_gl|ref_src|igshid)$/i;

/**
 * A aba está na MESMA página que foi vista ao propor? Origem, caminho e
 * consulta (fora o rastreio): `/carrinho?item=1` e `/carrinho?item=2` são
 * carrinhos diferentes, e uma ação aprovada num não vale no outro. Só o
 * fragmento pode mudar. Puro.
 */
export function mesmaPagina(atual: string | null | undefined, esperada: string): boolean {
  try {
    const a = new URL(atual ?? "");
    const e = new URL(esperada);
    const caminho = (u: URL) => u.pathname.replace(/\/+$/, "") || "/";
    const consulta = (u: URL) =>
      [...u.searchParams.entries()]
        .filter(([k]) => !RASTREIO.test(k))
        .map(([k, v]) => `${k}=${v}`)
        .sort()
        .join("&");
    return a.origin === e.origin && caminho(a) === caminho(e) && consulta(a) === consulta(e);
  } catch {
    return false;
  }
}

const TELA_MUDOU = "A tela mudou entre propor e executar: nada foi feito. Leia a página de novo.";

/** Quanto a marca "a Órbita está agindo" dura DEPOIS da entrada: os eventos que o CDP já entregou chegam nisto. */
export const FIM_DA_MARCA_MS = 300;

/**
 * A ordem `agir` inteira. Devolve a frase do que foi feito.
 *
 * `urlAtual` é o endereço da aba AGORA, que só a mão sabe (a extensão pelo
 * `chrome.tabs`, o perfil dedicado pela página): a ordem que traz
 * `urlEsperada` é recusada se a aba estiver noutra página (B4 da revisão).
 */
export async function executarAgir(m: MaosDaAba, o: OrdemAgir, cfg: { agindoMs: number; urlAtual?: string | null }): Promise<ResultadoDaOrdem> {
  if (o.urlEsperada && !mesmaPagina(cfg.urlAtual, o.urlEsperada)) throw new RecusaDasMaos(`${TELA_MUDOU} A aba não está mais na página aprovada.`, "tela_mudou");
  const mods = modificadoresDe(o.modificadores);
  let ref = o.ref ?? null;
  let assinatura = o.assinatura ?? null;
  if (!ref && o.ponto && o.acao !== "rolar" && o.acao !== "digitar" && o.acao !== "tecla") {
    // coordenada sem ref: o alvo é o elemento ali, e ele passa pelas mesmas travas
    const d = exigir(await m.pagina({ tipo: "descrever", x: o.ponto.x, y: o.ponto.y }));
    if (!("alvo" in d)) throw new RecusaDasMaos("Não há alvo nesse ponto.", "sem_alvo");
    ref = d.alvo.ref;
    if (!assinatura) assinatura = { papel: d.alvo.papel, nome: d.alvo.nome };
  }
  /**
   * Marca a página como "a Órbita está agindo" logo ANTES da entrada e de novo DEPOIS dela: com a máquina
   * carregada, o tempo entre preparar o alvo e o clique já passou da janela, e o clique da própria Órbita
   * virou "o dono mexeu" (medido no B0, 10/10/2026). A marca do fim cobre os eventos ainda na fila.
   */
  const comAgindo = async (fn: () => Promise<void>) => {
    await m.pagina({ tipo: "agindo", ms: cfg.agindoMs });
    try {
      await fn();
    } finally {
      // a marca do fim é CURTA: só cobre os eventos ainda na fila. Com a janela inteira de novo, as ações de um
      // lote emendavam as janelas e um clique do dono entre elas não pausava a sessão
      await m.pagina({ tipo: "agindo", ms: Math.min(cfg.agindoMs, FIM_DA_MARCA_MS) }).catch(() => undefined);
    }
  };
  const precisaDeAlvo = !["digitar", "tecla", "rolar"].includes(o.acao);
  if (precisaDeAlvo && (!ref || !assinatura)) throw new RecusaDasMaos("Esta ação precisa de um alvo conferido (ref e assinatura).", "invalido");

  switch (o.acao) {
    case "clicar":
    case "marcar":
    case "clique_duplo":
    case "clique_triplo":
    case "clique_direito":
    case "clique_meio": {
      const p = exigir(await m.pagina({ tipo: "preparar", ref: ref!, assinatura: assinatura!, acao: o.acao, agindoMs: cfg.agindoMs }));
      if (!("alvo" in p)) throw new RecusaDasMaos("Falha ao preparar o alvo.", "invalido");
      // marcar com o valor pedido: a caixa que já está como pedido não leva clique (o clique INVERTERIA)
      if (o.acao === "marcar" && typeof o.valor === "boolean" && typeof p.alvo.marcado === "boolean" && p.alvo.marcado === o.valor) return { feito: `A caixa [${p.alvo.ref}] já estava ${o.valor ? "marcada" : "desmarcada"}.` };
      const b = BOTAO[o.acao]!;
      // o `centro` que o preparar devolve é um ponto conferido: ali está o alvo, e não um banner por cima dele
      await comAgindo(() => clicarEm(m, p.alvo.centro.x, p.alvo.centro.y, b.button, b.cliques, mods));
      // o nome do alvo é texto da página: a frase do que foi feito leva só o papel e a ref (I-6)
      return { feito: `${o.acao === "marcar" ? "Marquei" : "Cliquei em"} ${p.alvo.papel} [${p.alvo.ref}].` };
    }
    case "passar_mouse": {
      const p = exigir(await m.pagina({ tipo: "preparar", ref: ref!, assinatura: assinatura!, acao: o.acao, agindoMs: cfg.agindoMs }));
      if (!("alvo" in p)) throw new RecusaDasMaos("Falha ao preparar o alvo.", "invalido");
      await comAgindo(async () => void (await m.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.alvo.centro.x, y: p.alvo.centro.y })));
      return { feito: `Passei o mouse sobre ${p.alvo.papel} [${p.alvo.ref}].` };
    }
    case "selecionar": {
      const r = exigir(await m.pagina({ tipo: "selecionar", ref: ref!, assinatura: assinatura!, valor: String(o.valor ?? o.texto ?? "") }));
      return { feito: "feito" in r ? r.feito : "Opção escolhida." };
    }
    case "preencher": {
      if (o.valor !== undefined && o.valor !== null && typeof o.valor !== "string") {
        const r = exigir(await m.pagina({ tipo: "preencher_valor", ref: ref!, assinatura: assinatura!, valor: o.valor }));
        return { feito: "feito" in r ? r.feito : "Campo preenchido." };
      }
      const texto = String(o.texto ?? o.valor ?? "");
      const p = exigir(await m.pagina({ tipo: "preparar", ref: ref!, assinatura: assinatura!, acao: "preencher", agindoMs: cfg.agindoMs }));
      if (!("alvo" in p)) throw new RecusaDasMaos("Falha ao preparar o alvo.", "invalido");
      // o `select()` do preparar marcou o conteúdo antigo: o texto novo o substitui
      await comAgindo(async () => {
        if (texto) await m.cdp("Input.insertText", { text: texto });
        else await apertar(m, "Delete");
      });
      return { feito: `Preenchi o campo [${p.alvo.ref}].` };
    }
    case "digitar": {
      const f = exigir(await m.pagina({ tipo: "focado" }));
      conferirFocado(o, "focado" in f ? f.focado : null);
      if ("focado" in f && f.focado?.sensivel) throw new RecusaDasMaos("O campo com o foco é de senha, cartão ou código: a Órbita não digita aqui.", "sensivel");
      await comAgindo(async () => void (await m.cdp("Input.insertText", { text: String(o.texto ?? "") })));
      return { feito: "Digitei o texto." };
    }
    case "tecla": {
      const f = exigir(await m.pagina({ tipo: "focado" }));
      const inicial = "focado" in f ? f.focado : null;
      conferirFocado(o, inicial);
      const sequencia = String(o.tecla ?? o.texto ?? "");
      traduzirTeclas(sequencia);
      /**
       * B-1: o risco e a recusa olharam o campo com o foco ANTES da sequência.
       * Uma tecla que não escreve nem ativa (Tab, seta, Esc) pode levar o foco
       * para outro lugar, e a próxima que escreve ou ativa cairia lá: o "Tab
       * Enter" na busca virava Enter no "Comprar", e o "Tab 123456" digitava no
       * campo do código. Por isso, antes de cada tecla que escreve ou ativa, se
       * algo foi apertado desde a última conferência, o foco é lido de novo.
       */
      let atual = inicial;
      let mexeu = false;
      let primeira = true;
      const conferirAntes = async (c: Combinacao) => {
        // a marca "a Órbita está agindo" é renovada tecla a tecla, e não esticada pela sequência inteira
        if (!primeira) await m.pagina({ tipo: "agindo", ms: cfg.agindoMs });
        primeira = false;
        const { escreve, ativa } = comboQueAtua(c);
        if (!escreve && !ativa) {
          mexeu = true;
          return;
        }
        if (mexeu) {
          const g = exigir(await m.pagina({ tipo: "focado" }));
          atual = "focado" in g ? g.focado : null;
          mexeu = false;
        }
        if (escreve && atual?.sensivel) throw new RecusaDasMaos("O foco foi para um campo de senha, cartão ou código: a Órbita não digita aqui. Nada mais foi apertado.", "sensivel");
        const mesmoCampo = (!inicial && !atual) || (!!inicial && !!atual && inicial.ref === atual.ref);
        // sem aprovação, a tecla que escreve ou ativa só vale no campo que o dono (ou o crítico) viu
        if (!mesmoCampo && !o.aprovada) throw new RecusaDasMaos(`${TELA_MUDOU} O foco foi para outro elemento no meio da sequência; o resto não foi apertado.`, "tela_mudou");
        // a tecla seguinte escreve no mesmo campo: o próprio texto pode mover o foco (caixinhas de código que avançam sozinhas)
        mexeu = true;
      };
      await comAgindo(() => apertar(m, sequencia, o.quantidade ?? 1, conferirAntes));
      return { feito: `Apertei ${sequencia.slice(0, 100)}.` };
    }
    case "rolar": {
      // a rolagem é pela página (scrollBy), sem evento de entrada: a marca curta basta
      await m.pagina({ tipo: "agindo", ms: Math.min(cfg.agindoMs, FIM_DA_MARCA_MS) });
      const r = exigir(await m.pagina({ tipo: "rolar", ref, x: o.ponto?.x ?? null, y: o.ponto?.y ?? null, direcao: o.direcao ?? (ref ? null : "baixo"), quantidade: o.quantidade ?? 3 }));
      return { feito: "feito" in r ? r.feito : "Rolei." };
    }
  }
  throw new RecusaDasMaos("Ação desconhecida.", "invalido");
}

interface MetricasDeLayout {
  cssVisualViewport?: { clientWidth: number; clientHeight: number; pageX: number; pageY: number };
}

/**
 * Captura da aba por CDP (`Page.captureScreenshot`), já reduzida para
 * `larguraMax` e com os campos sensíveis apagados da imagem enquanto ela é
 * tirada. A escala vai junto, para o clique por coordenada voltar ao lugar
 * certo. Funciona com a aba em segundo plano (medido no B0).
 */
/** Largura da miniatura da trilha e do cartão "Órbita no controle" (só com `controle.guardarMiniaturas`). */
export const LARGURA_DA_MINIATURA = 320;

export async function capturarAba(m: MaosDaAba, o: { larguraMax: number; regiao?: [number, number, number, number] | null; escalaAnterior?: number; miniatura?: boolean }): Promise<NonNullable<ResultadoDaOrdem["imagem"]>> {
  const met = (await m.cdp("Page.getLayoutMetrics")) as MetricasDeLayout;
  const vv = met.cssVisualViewport ?? { clientWidth: 1280, clientHeight: 800, pageX: 0, pageY: 0 };
  const escala = Math.min(1, o.larguraMax / Math.max(1, vv.clientWidth));
  let clip = { x: vv.pageX, y: vv.pageY, width: vv.clientWidth, height: vv.clientHeight, scale: escala };
  if (o.regiao) {
    // a região vem em pixels da captura anterior: volta para pixels CSS antes de recortar
    const e = o.escalaAnterior && o.escalaAnterior > 0 ? o.escalaAnterior : escala;
    const [x0, y0, x1, y1] = o.regiao.map((v) => v / e) as [number, number, number, number];
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    clip = { x: vv.pageX + x0, y: vv.pageY + y0, width: w, height: h, scale: Math.min(4, o.larguraMax / w) };
  }
  // A máscara FALHA FECHADO: se a página (ou um dos quadros) não confirmar que escondeu os campos sensíveis,
  // não há captura. Antes a resposta era ignorada e um `{ok:false}` mandava a imagem sem máscara nenhuma.
  try {
    await mascararTudo(m);
    // aba em segundo plano não pinta quadro novo, e a captura ficava esperando um (de 2 s a mais de 15 s, medido
    // no B0); com o foco emulado ela sai em ~100 ms. Desligado logo depois, para a página não achar que tem foco.
    await m.cdp("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => undefined);
    const r = (await m.cdp("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: false, fromSurface: true })) as { data: string };
    // a miniatura sai AINDA com a máscara ligada: o que vai para o banco nunca tem a senha
    let miniatura: string | undefined;
    if (o.miniatura) {
      const mini = (await m
        .cdp("Page.captureScreenshot", { format: "jpeg", quality: 50, clip: { ...clip, scale: Math.min(1, LARGURA_DA_MINIATURA / Math.max(1, clip.width)) }, captureBeyondViewport: false, fromSurface: true })
        .catch(() => null)) as { data?: string } | null;
      if (mini?.data) miniatura = `data:image/jpeg;base64,${mini.data}`;
    }
    return { base64: r.data, mediaType: "image/png", largura: Math.round(clip.width * clip.scale), altura: Math.round(clip.height * clip.scale), escala: o.regiao ? clip.scale : escala, ...(miniatura ? { miniatura } : {}) };
  } finally {
    await m.cdp("Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => undefined);
    await (m.paginaEmTodosOsQuadros ? m.paginaEmTodosOsQuadros({ tipo: "mascarar", ligar: false }) : m.pagina({ tipo: "mascarar", ligar: false })).catch(() => undefined);
  }
}

async function mascararTudo(m: MaosDaAba): Promise<void> {
  const pedido: PedidoNaPagina = { tipo: "mascarar", ligar: true };
  const respostas = m.paginaEmTodosOsQuadros ? await m.paginaEmTodosOsQuadros(pedido) : [await m.pagina(pedido)];
  if (!respostas.length) throw new RecusaDasMaos("A página não confirmou a máscara dos campos sensíveis: sem captura.", "mascara");
  for (const r of respostas) if (!r || !r.ok) throw new RecusaDasMaos("A página não confirmou a máscara dos campos sensíveis: sem captura.", "mascara");
}
