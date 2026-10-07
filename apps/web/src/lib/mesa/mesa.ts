import type { CartaoDaTela } from "@orbita/core/chat/cartoes-da-tela";

/**
 * A MESA: os cartões que a Órbita abriu enquanto falava, soltos na tela.
 *
 * O dono quer gerenciar o que ela abre ("arrastar, minimizar etc."), como
 * janelas. Este arquivo é o estado e as regras, sem React: onde um cartão
 * nasce sem cobrir os outros, o que acontece quando ela abre o MESMO cartão
 * de novo, e o limite de abertos ao mesmo tempo. A tela só desenha e repassa
 * os gestos.
 *
 * Vive fora dos componentes (uma loja do módulo) porque quem abre e quem
 * mostra estão em lugares diferentes: a Visão geral e o Modo foco abastecem,
 * e a mesa é desenhada uma vez, na casca, por cima de qualquer tela.
 */

export interface NaMesa {
  cartao: CartaoDaTela;
  x: number;
  y: number;
  /** ordem de empilhamento: o último tocado fica por cima */
  z: number;
  minimizado: boolean;
}

export interface EstadoDaMesa {
  cartoes: NaMesa[];
  proximoZ: number;
}

export interface Area {
  largura: number;
  altura: number;
}

export const LARGURA_DO_CARTAO = 340;
const ALTURA_ESTIMADA = 300;
const MARGEM = 16;
const TOPO = 84; // abaixo da barra do topo

export const vazia = (): EstadoDaMesa => ({ cartoes: [], proximoZ: 1 });

const sobrepoe = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.abs(a.x - b.x) < LARGURA_DO_CARTAO - 40 && Math.abs(a.y - b.y) < ALTURA_ESTIMADA - 60;

/** Mantém o cabeçalho do cartão alcançável: arrastado para fora, ele volta para a borda. */
export function dentroDaArea(x: number, y: number, area: Area): { x: number; y: number } {
  return {
    x: Math.round(Math.min(Math.max(x, MARGEM - LARGURA_DO_CARTAO + 120), area.largura - 120)),
    y: Math.round(Math.min(Math.max(y, MARGEM), area.altura - 56)),
  };
}

/**
 * Onde um cartão novo nasce: no lugar em que o dono deixou o último cartão
 * DESTE tipo (ele arrumou a mesa e quer os e-mails sempre ali), senão na
 * primeira vaga livre, da direita para a esquerda (o núcleo fica no meio e à
 * esquerda), senão em cascata por cima do último.
 */
export function vagaPara(estado: EstadoDaMesa, area: Area, lembrada?: { x: number; y: number } | null): { x: number; y: number } {
  const abertos = estado.cartoes.filter((c) => !c.minimizado);
  if (lembrada && !abertos.some((c) => sobrepoe(c, lembrada))) return dentroDaArea(lembrada.x, lembrada.y, area);
  const colunas = Math.max(1, Math.floor((area.largura - MARGEM) / (LARGURA_DO_CARTAO + MARGEM)));
  const linhas = Math.max(1, Math.floor((area.altura - TOPO) / (ALTURA_ESTIMADA + MARGEM)));
  for (let col = 0; col < colunas; col++) {
    for (let lin = 0; lin < linhas; lin++) {
      const v = { x: area.largura - (col + 1) * (LARGURA_DO_CARTAO + MARGEM), y: TOPO + lin * (ALTURA_ESTIMADA + MARGEM) };
      if (!abertos.some((c) => sobrepoe(c, v))) return dentroDaArea(v.x, v.y, area);
    }
  }
  const n = abertos.length;
  return dentroDaArea(area.largura - LARGURA_DO_CARTAO - MARGEM - (n % 6) * 28, TOPO + (n % 6) * 28, area);
}

/**
 * A Órbita abriu cartões. O mesmo cartão (mesmo `id`) é ATUALIZADO no lugar
 * em que está e volta para a frente, sem abrir outro: "e agora, meus
 * e-mails?" não pode virar dois cartões de e-mail. Passou do limite de
 * abertos, os mais antigos vão para a bandeja (minimizados, não fechados).
 */
export function abrir(
  estado: EstadoDaMesa,
  novos: CartaoDaTela[],
  area: Area,
  maxAbertos: number,
  lembrar: (tipo: string) => { x: number; y: number } | null = () => null,
): EstadoDaMesa {
  let { cartoes, proximoZ } = estado;
  for (const cartao of novos) {
    const existente = cartoes.find((c) => c.cartao.id === cartao.id);
    if (existente) {
      cartoes = cartoes.map((c) => (c === existente ? { ...c, cartao, minimizado: false, z: proximoZ } : c));
    } else {
      const { x, y } = vagaPara({ cartoes, proximoZ }, area, lembrar(cartao.tipo));
      cartoes = [...cartoes, { cartao, x, y, z: proximoZ, minimizado: false }];
    }
    proximoZ++;
  }
  const abertos = cartoes.filter((c) => !c.minimizado).sort((a, b) => b.z - a.z);
  const excesso = new Set(abertos.slice(Math.max(1, maxAbertos)).map((c) => c.cartao.id));
  if (excesso.size) cartoes = cartoes.map((c) => (excesso.has(c.cartao.id) ? { ...c, minimizado: true } : c));
  return { cartoes, proximoZ };
}

export function mover(estado: EstadoDaMesa, id: string, x: number, y: number, area: Area): EstadoDaMesa {
  const p = dentroDaArea(x, y, area);
  return { ...estado, cartoes: estado.cartoes.map((c) => (c.cartao.id === id ? { ...c, ...p } : c)) };
}

export function paraFrente(estado: EstadoDaMesa, id: string): EstadoDaMesa {
  const alvo = estado.cartoes.find((c) => c.cartao.id === id);
  if (!alvo || alvo.z === estado.proximoZ - 1) return estado;
  return { cartoes: estado.cartoes.map((c) => (c === alvo ? { ...c, z: estado.proximoZ } : c)), proximoZ: estado.proximoZ + 1 };
}

/** Minimizar e restaurar. Restaurar traz para a frente e respeita o limite de abertos. */
export function alternarMinimizado(estado: EstadoDaMesa, id: string, maxAbertos: number, area: Area): EstadoDaMesa {
  const alvo = estado.cartoes.find((c) => c.cartao.id === id);
  if (!alvo) return estado;
  if (!alvo.minimizado) return { ...estado, cartoes: estado.cartoes.map((c) => (c === alvo ? { ...c, minimizado: true } : c)) };
  return abrir(estado, [alvo.cartao], area, maxAbertos);
}

export function fechar(estado: EstadoDaMesa, id: string): EstadoDaMesa {
  return { ...estado, cartoes: estado.cartoes.filter((c) => c.cartao.id !== id) };
}

// ── a loja do módulo ────────────────────────────────────────────────────────

const CHAVE_POSICOES = "orbita.mesa.posicoes";
let estado = vazia();
const ouvintes = new Set<() => void>();

function publicar(novo: EstadoDaMesa) {
  if (novo === estado) return;
  estado = novo;
  for (const o of ouvintes) o();
}

/**
 * Onde o dono deixou cada TIPO de cartão. É conveniência deste aparelho (a
 * mesa do celular não é a do computador), então mora no navegador; sem
 * armazenamento (aba anônima, bloqueio), a mesa só deixa de lembrar.
 */
function posicoesLembradas(): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_POSICOES) ?? "{}") as Record<string, { x: number; y: number }>;
  } catch {
    return {};
  }
}
function lembrarPosicao(tipo: string, x: number, y: number) {
  try {
    localStorage.setItem(CHAVE_POSICOES, JSON.stringify({ ...posicoesLembradas(), [tipo]: { x, y } }));
  } catch {
    // sem armazenamento, a mesa só não lembra
  }
}

const areaDaJanela = (): Area => ({ largura: window.innerWidth, altura: window.innerHeight });

export const mesa = {
  ler: () => estado,
  ouvir(fn: () => void) {
    ouvintes.add(fn);
    return () => void ouvintes.delete(fn);
  },
  abrir(cartoes: CartaoDaTela[], maxAbertos: number) {
    if (!cartoes.length || typeof window === "undefined") return;
    const lembradas = posicoesLembradas();
    publicar(abrir(estado, cartoes, areaDaJanela(), maxAbertos, (tipo) => lembradas[tipo] ?? null));
  },
  mover(id: string, x: number, y: number) {
    publicar(mover(estado, id, x, y, areaDaJanela()));
  },
  /** Fim do arraste: aí, e só aí, a posição vira a preferida daquele tipo. */
  soltar(id: string) {
    const c = estado.cartoes.find((x) => x.cartao.id === id);
    if (c) lembrarPosicao(c.cartao.tipo, c.x, c.y);
  },
  paraFrente: (id: string) => publicar(paraFrente(estado, id)),
  alternarMinimizado: (id: string, maxAbertos: number) => publicar(alternarMinimizado(estado, id, maxAbertos, areaDaJanela())),
  fechar: (id: string) => publicar(fechar(estado, id)),
  limpar: () => publicar(vazia()),
};
