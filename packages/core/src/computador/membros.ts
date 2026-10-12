import { lerPonto, pontoNaCaptura, regiaoDoZoom, type Alvo, type CapturaVista, type RegiaoDoZoom } from "./escala";

/**
 * OS 17 MEMBROS DO `computer_toolset_20260801` (PRD-MOTOR-DESKTOP §6) e o que
 * cada um vira. Regra do desenho: NENHUM membro liga sem um alvo descritível que
 * o risco pelo alvo possa avaliar. Cada ação do Claude vira UMA chamada às tools
 * do registro (`computador_ver`, `computador_agir`); o motor não tem caminho
 * próprio para agir.
 *
 *   screenshot, zoom, cursor_position  → leitura
 *   *_click, scroll, type, key         → computador_agir (alvo `{captura, x, y}`)
 *   left_click_drag                    → computador_agir arrastar, SÓ com as duas pontas
 *   wait                               → espera no motor
 *   mouse_move, left_mouse_down/up, hold_key → DESLIGADOS (sem alvo único a conferir)
 *
 * Puro: testado sem rede e sem mãos.
 */

export const MEMBROS = [
  "screenshot", "zoom", "left_click", "right_click", "middle_click", "double_click", "triple_click", "left_click_drag",
  "mouse_move", "left_mouse_down", "left_mouse_up", "cursor_position", "scroll", "type", "key", "hold_key", "wait",
] as const;
export type Membro = (typeof MEMBROS)[number];

/** Desligados no `configs` e, se o modelo chamar mesmo assim, erro claro. */
export const MEMBROS_FORA = ["mouse_move", "left_mouse_down", "left_mouse_up", "hold_key"] as const;

export const MEMBROS_LIGADOS: readonly Membro[] = MEMBROS.filter((m) => !(MEMBROS_FORA as readonly string[]).includes(m));

/** A definição que vai na chamada: sem `name` nem tamanho de tela (a API devolve 400 com eles). */
export function toolsetDoComputador(): Record<string, unknown> {
  const configs: Record<string, { enabled: boolean }> = {};
  for (const m of MEMBROS_FORA) configs[m] = { enabled: false };
  return { type: "computer_toolset_20260801", configs };
}

/**
 * O toolset do Claude não tem "abrir app": ele tentaria a busca da barra de tarefas (Windows Explorer,
 * fora do envelope) e seria barrado. Esta ferramenta própria (custom tool) vira `computador_abrir`, que
 * passa por sessão, envelope e fila como qualquer outra. Medido no ponta a ponta de 11/10/2026.
 */
export const ABRIR_APLICATIVO = "abrir_aplicativo";

export function ferramentaAbrirAplicativo(): Record<string, unknown> {
  return {
    name: ABRIR_APLICATIVO,
    description: "Abre um aplicativo pelo nome (por exemplo Calculadora, Bloco de Notas, code). Use isto em vez do menu Iniciar ou da busca da barra de tarefas, que a Órbita não deixa usar. Só abre apps liberados na sessão; fora dela o dono precisa aprovar.",
    input_schema: { type: "object", properties: { app: { type: "string", description: "O nome do aplicativo." } }, required: ["app"] },
  };
}

/** Tudo que vai no campo `tools` da chamada: o toolset e a ferramenta de abrir app. */
export function ferramentasDoComputador(): Record<string, unknown>[] {
  return [toolsetDoComputador(), ferramentaAbrirAplicativo()];
}

/** Um passo de `computador_agir`, como o motor o monta. */
export interface PassoDoMotor {
  acao: "clicar" | "clique_duplo" | "clique_direito" | "clique_meio" | "clique_triplo" | "digitar" | "tecla" | "atalho" | "rolar" | "arrastar";
  alvo?: Alvo;
  destino?: Alvo;
  texto?: string;
  tecla?: string;
  direcao?: "cima" | "baixo" | "esquerda" | "direita";
  quantidade?: number;
  modificadores?: string;
}

export type Plano =
  | { tipo: "tela" }
  | { tipo: "zoom"; regiao: RegiaoDoZoom }
  | { tipo: "cursor" }
  | { tipo: "esperar"; seg: number }
  | { tipo: "agir"; passo: PassoDoMotor }
  | { tipo: "abrir"; app: string }
  | { tipo: "erro"; texto: string };

type Obj = Record<string, unknown>;
const erro = (texto: string): Plano => ({ tipo: "erro", texto });

const CLIQUES: Partial<Record<Membro, PassoDoMotor["acao"]>> = {
  left_click: "clicar",
  right_click: "clique_direito",
  middle_click: "clique_meio",
  double_click: "clique_duplo",
  triple_click: "clique_triplo",
};

const DIRECOES: Record<string, PassoDoMotor["direcao"]> = { up: "cima", down: "baixo", left: "esquerda", right: "direita" };

/** "ctrl+s" é atalho; "Enter" é tecla. */
const ehAtalho = (t: string) => t.includes("+") && t.length > 1;

/**
 * Traduz UM membro em um plano. `cap` é o último screenshot que o Claude viu:
 * é nele que os pontos valem. Nunca lança.
 */
export function traduzirMembro(nome: string, entrada: Obj, cap: CapturaVista | null, pausaMaxMs: number): Plano {
  if (nome === ABRIR_APLICATIVO) {
    const app = typeof entrada.app === "string" ? entrada.app.trim() : "";
    return app && app.length <= 120 ? { tipo: "abrir", app } : erro("abrir_aplicativo precisa de app (o nome, até 120 caracteres).");
  }
  if (!(MEMBROS as readonly string[]).includes(nome)) return erro(`${nome} is not a known action of this environment.`);
  if ((MEMBROS_FORA as readonly string[]).includes(nome)) return erro(`${nome} is not enabled in this environment.`);
  const m = nome as Membro;

  if (m === "screenshot") return { tipo: "tela" };
  if (m === "cursor_position") return { tipo: "cursor" };
  if (m === "zoom") {
    const r = regiaoDoZoom(entrada.region, cap);
    return "erro" in r ? erro(r.erro) : { tipo: "zoom", regiao: r };
  }
  if (m === "wait") {
    const s = Number(entrada.duration ?? 1);
    if (!Number.isFinite(s) || s < 0) return erro("duration inválida.");
    return { tipo: "esperar", seg: Math.min(s, pausaMaxMs / 1000) };
  }

  const acaoDeClique = CLIQUES[m];
  if (acaoDeClique) {
    const a = pontoNaCaptura(entrada.coordinate, cap);
    if ("erro" in a) return erro(a.erro);
    // o modificador (ctrl, shift) vem em `text` no computer use, e em `modifiers` no browser use
    const mod = typeof entrada.text === "string" ? entrada.text : typeof entrada.modifiers === "string" ? entrada.modifiers : undefined;
    return { tipo: "agir", passo: { acao: acaoDeClique, alvo: a, ...(mod ? { modificadores: mod.slice(0, 40) } : {}) } };
  }

  if (m === "left_click_drag") {
    // as DUAS pontas resolvidas e conferidas, senão o risco não tem o que avaliar
    const de = pontoNaCaptura(entrada.start_coordinate, cap);
    if ("erro" in de) return erro(`Origem do arrasto: ${de.erro}`);
    const para = pontoNaCaptura(entrada.coordinate, cap);
    if ("erro" in para) return erro(`Destino do arrasto: ${para.erro}`);
    return { tipo: "agir", passo: { acao: "arrastar", alvo: de, destino: para } };
  }

  if (m === "scroll") {
    const direcao = DIRECOES[String(entrada.scroll_direction)] ?? (["cima", "baixo", "esquerda", "direita"].includes(String(entrada.scroll_direction)) ? (entrada.scroll_direction as PassoDoMotor["direcao"]) : undefined);
    if (!direcao) return erro("scroll_direction inválida (up, down, left, right).");
    const quantidade = Math.max(1, Math.min(Math.round(Number(entrada.scroll_amount ?? 3)) || 3, 50));
    // rolar sem ponto vai para o que tem o foco; com ponto, a ação ganha o alvo descrito pelas mãos
    if (lerPonto(entrada.coordinate)) {
      const a = pontoNaCaptura(entrada.coordinate, cap);
      if ("erro" in a) return erro(a.erro);
      return { tipo: "agir", passo: { acao: "rolar", alvo: a, direcao, quantidade } };
    }
    return { tipo: "agir", passo: { acao: "rolar", direcao, quantidade } };
  }

  if (m === "type") {
    const texto = typeof entrada.text === "string" ? entrada.text : "";
    if (!texto) return erro("type sem text.");
    if (texto.length > 5000) return erro("Texto longo demais (máximo 5000 caracteres por type).");
    return { tipo: "agir", passo: { acao: "digitar", texto } };
  }

  // key
  const tecla = typeof entrada.text === "string" ? entrada.text.trim() : "";
  if (!tecla) return erro("key sem text.");
  const repeat = Math.max(1, Math.min(Math.round(Number(entrada.repeat ?? 1)) || 1, 50));
  return { tipo: "agir", passo: { acao: ehAtalho(tecla) ? "atalho" : "tecla", tecla: tecla.slice(0, 60), ...(repeat > 1 ? { quantidade: repeat } : {}) } };
}
