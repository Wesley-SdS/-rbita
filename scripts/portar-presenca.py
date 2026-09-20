"""
Traz o protótipo `prototypes/orbita-presenca` para dentro do app.

Existe porque o protótipo continua evoluindo. Refazer o porte à mão a cada
mudança é como a interface do app e a proposta vão se separando sem ninguém
perceber: aqui é um comando, e o que ele gera é sempre derivado, nunca editado.

    python scripts/portar-presenca.py            # porta e mostra o que mudou
    python scripts/portar-presenca.py --conferir # só diz se está desatualizado

NÃO EDITE os arquivos gerados:
    apps/web/src/app/presenca.css
    apps/web/src/lib/presenca/motor-canvas.js
    apps/web/src/lib/presenca/motor-webgl.js
    apps/web/src/components/presenca/icones.tsx

O que é extensão do app (e não existe no protótipo) mora em
`apps/web/src/app/presenca-app.css`, que este script nunca toca.
"""

import argparse
import io
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROTO = os.path.join(RAIZ, "prototypes", "orbita-presenca")
WEB = os.path.join(RAIZ, "apps", "web", "src")


def ler(*partes):
    return io.open(os.path.join(*partes), encoding="utf-8").read()


def gravar(caminho, conteudo):
    """Grava e diz se mudou. Não reescreve arquivo idêntico: evita recompilação
    à toa do dev server quando só uma das peças mudou."""
    if os.path.exists(caminho) and ler(caminho) == conteudo:
        return False
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    io.open(caminho, "w", encoding="utf-8").write(conteudo)
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Folha de estilo
# ─────────────────────────────────────────────────────────────────────────────

# Os nomes do protótipo viram os tokens do app. Ordem importa: o mais longo
# primeiro, senão `--panel` comeria `--panel-soft`.
TOKENS = [
    ("--panel-soft", "--color-surface-soft"),
    ("--mint-bright", "--color-mint-bright"),
    ("--orb-bg", "--color-orb-bg"),
    ("--sidebar", "--color-sidebar"),
    ("--lavender", "--color-lavender"),
    ("--forest", "--color-forest"),
    ("--shadow", "--shadow-panel"),
    ("--radius", "--radius-panel"),
    ("--green", "--color-green"),
    ("--muted", "--color-ink-dim"),
    ("--panel", "--color-surface"),
    ("--peach", "--color-peach"),
    ("--mint", "--color-mint"),
    ("--line", "--color-line"),
    ("--ink", "--color-ink"),
    ("--bg", "--color-ground"),
]

# O protótipo fixa a cor do texto sobre o acento e sobre o vermelho em hex, o
# que no tema Floresta fica ilegível. Aqui eles passam a usar os tokens, que
# existem nos dois temas.
# Cores de TEXTO que o prototipo fixa em hex. Medidas no navegador, varias
# ficam abaixo do minimo de contraste no tema claro: a legenda do menu da
# 2,9:1, o rotulo de navegacao 3,7:1 e as coordenadas do nucleo somem no palco.
# Viram token, que ja passa AA nos dois temas e some com a necessidade de
# override escuro separado.
AJUSTES_CSS = [
    ("color:#90978d", "color:var(--color-ink-dim)"),
    ("color:#7c857c", "color:var(--color-ink-dim)"),
    ("color:#a2b19a", "color:var(--color-ink-dim)"),
    # a chamada do cartao de foco e acao, nao legenda: em cinza apagado ela
    # fica em 4,47:1 sobre o proprio fundo, raspando o minimo
    ("color:#7b8576", "color:var(--color-forest)"),
    ("color:#8f9b87", "color:var(--color-ink-dim)"),
    ("color:#74816b", "color:var(--color-ink-dim)"),
    ("color:#aabe9b", "color:var(--color-ink-dim)"),
    ("color:#8b9781", "color:var(--color-ink-dim)"),
    ("color:#bcc3b7", "color:var(--color-ink-dim)"),
    (".mint-period{color:#86aa70}", ".mint-period{color:var(--color-acento-suave)}"),
    # Icone que recebe so uma dimensao sai retangular: o `.icon` base e 20x20,
    # entao mexer so na largura deixa 16x20. Os dois casos do prototipo.
    (".workspace-icon .icon{width:16px}", ".workspace-icon .icon{width:16px;height:16px}"),
    (".profile .icon{height:15px}", ".profile .icon{width:15px;height:15px}"),
    # `color:white` sobre o acento: no Floresta o acento CLAREIA, e branco sobre
    # verde claro da 1,5:1. O token `accent-ink` existe exatamente para isto.
    ("background:var(--color-forest);color:white", "background:var(--color-forest);color:var(--color-accent-ink)"),
    # cinzas do cartao de presenca: a linha de estado e a frase de apoio ficam
    # em 3,1 e 3,6:1 e sao texto corrente, nao ornamento
    ("color:#748669", "color:var(--color-ink-dim)"),
    ("color:#84917b", "color:var(--color-ink-dim)"),
    ("color:#6e8261", "color:var(--color-green)"),
    ("color:#9daf91", "color:var(--color-ink-dim)"),
    # cartoes lilas: o roxo claro do prototipo da 2,6:1 sobre o proprio fundo
    ("color:#9b8cab", "color:var(--color-lavender-ink)"),
    ("color:#80758d", "color:var(--color-lavender-ink)"),
    ("color:#7b6c8e", "color:var(--color-lavender-ink)"),
    ("color:#9781b0", "color:var(--color-lavender-ink)"),
    ("color:#8d7c9c", "color:var(--color-lavender-ink)"),
    # ── o resto dos cinzas fixos do prototipo ──────────────────────────────
    # Medidos um a um no navegador: 27 cores de texto e de icone ficam abaixo
    # do minimo sobre fundo claro. As seis que sobraram em hex sao texto CLARO
    # sobre cartao ESCURO (a reuniao ao vivo e o aviso flutuante) e estao certas
    # como estao; trocar aquelas por token as apagaria no proprio fundo.
    ("color:#75866b", "color:var(--color-ink-dim)"),
    ("color:#809271", "color:var(--color-ink-dim)"),
    ("color:#8c9585", "color:var(--color-ink-dim)"),
    ("color:#98a08f", "color:var(--color-ink-dim)"),
    ("color:#9ba18f", "color:var(--color-ink-dim)"),
    ("color:#b3b8ad", "color:var(--color-ink-dim)"),
    ("color:#a4ad9d", "color:var(--color-ink-dim)"),
    ("color:#aab4a3", "color:var(--color-ink-dim)"),
    ("color:#708268", "color:var(--color-ink-dim)"),
    ("color:#92a086", "color:var(--color-ink-dim)"),
    ("color:#93a289", "color:var(--color-ink-dim)"),
    ("color:#6d8960", "color:var(--color-ink-dim)"),
    ("color:#98a380", "color:var(--color-green)"),
    ("color:#8ba273", "color:var(--color-green)"),
    ("color:#7b9b67", "color:var(--color-green)"),
    ("color:#63794e", "color:var(--color-forest)"),
    ("color:#79a05e", "color:var(--color-forest)"),
    ("color:#749377", "color:var(--color-acento-suave)"),
    # familia lilas
    ("color:#9c89b3", "color:var(--color-lavender-ink)"),
    ("color:#88719e", "color:var(--color-lavender-ink)"),
    # familia argila
    ("color:#a78262", "color:var(--color-peach-ink)"),
    ("color:#bd9a7d", "color:var(--color-peach-ink)"),
    ("color:#8b7a64", "color:var(--color-peach-ink)"),
    ("color:#998974", "color:var(--color-peach-ink)"),
    ("color:#a28c73", "color:var(--color-peach-ink)"),
    ("color:#8b694c", "color:var(--color-peach-ink)"),
    ("color:#f1f9ea;box-shadow:0 4px 8px #14301c0c", "color:var(--color-accent-ink);box-shadow:0 4px 8px #14301c0c"),
    (".danger{color:#a05343;background:#f8e9e2}", ".danger{color:var(--color-danger);background:var(--color-danger-soft)}"),
]

# ---------------------------------------------------------------------------
# Escala tipografica
# ---------------------------------------------------------------------------

# O prototipo e peca de apresentacao: usa de 5px a 56px, com o grosso do texto
# secundario entre 8 e 11. Bonito numa captura de tela, ilegivel em uso diario.
#
# A regra e SOMAR, nao multiplicar. Multiplicar mantem a proporcao do problema:
# 15% em cima de 7px da 8px, que continua sem se ler, enquanto os mesmos 15%
# incham um titulo de 35px em 5px sem necessidade. Somar um degrau fixo conserta
# a ponta de baixo, que e onde dói, e mal se nota na de cima.
#
# O PISO de 11px e o minimo das diretrizes de interface da Apple, e e o menor
# tamanho em que texto com espacamento de letra ainda se le com conforto. Nada
# no app fica abaixo disso. Texto corrente fica em 15px ou mais.
#
# Nao e edicao manual da folha (que e gerada): e transformacao aqui, para
# sobreviver ao proximo porte quando o prototipo mudar.
DEGRAU_FONTE = 3
PISO_FONTE = 11


def _escalar(valor):
    return str(max(PISO_FONTE, round(float(valor) + DEGRAU_FONTE)))


def escalar_fontes(css):
    """Sobe todo tamanho de fonte em px da folha, inclusive o atalho `font:`."""
    css = re.sub(r"font-size:([0-9.]+)px", lambda m: "font-size:%spx" % _escalar(m.group(1)), css)
    css = re.sub(r"font:([0-9.]+)px", lambda m: "font:%spx" % _escalar(m.group(1)), css)
    return css


CABECALHO_CSS = """/* GERADO por `scripts/portar-presenca.py` a partir de
   `prototypes/orbita-presenca/styles.css`. NÃO EDITE À MÃO: rode o script.

   É o design do protótipo, não uma reinterpretação. As regras vieram inteiras;
   só os nomes das variáveis foram trocados pelos tokens do app (`--bg` virou
   `--color-ground`, `--muted` virou `--color-ink-dim`). Os valores moram no
   `globals.css`, nos dois temas.

   Não vieram: o bloco de tokens claros e escuros (já existem no `globals.css`)
   e o reset (conflita com o preflight do Tailwind). O que o reset tinha de
   próprio está reescrito abaixo.

   Extensões do app, que não existem no protótipo, ficam em `presenca-app.css`.
   ────────────────────────────────────────────────────────────────────────── */

/* Do reset do protótipo, só o que o preflight do Tailwind não cobre. */
svg.icon {
  width: 20px;
  height: 20px;
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.65;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
}
button, a { touch-action: manipulation; }
button { transition: background .18s, transform .18s, color .18s, box-shadow .18s; }
button:active { transform: translateY(1px); }
button:disabled { opacity: .45; cursor: not-allowed; }
[hidden] { display: none !important; }

h1 { font-size: 35px; line-height: 1.25; }
h2 { font-size: 22px; }
h3 { font-size: 17px; }

.skip-link { position: fixed; top: -60px; left: 20px; z-index: 100; padding: 12px; background: var(--color-forest); color: var(--color-accent-ink); }
.skip-link:focus { top: 12px; }

"""


def portar_css():
    linhas = ler(PROTO, "styles.css").split("\n")
    # Os blocos de token do protótipo (claro e escuro) são pulados: os valores
    # já vivem no globals.css. Identificados pelo conteúdo, não pelo número da
    # linha, senão o script quebra na primeira vez que o protótipo cresce.
    corpo = []
    for linha in linhas:
        sem_espaco = linha.strip()
        if sem_espaco.startswith(":root{") or sem_espaco.startswith("[data-theme=dark]{"):
            continue
        if sem_espaco.startswith("*{box-sizing"):  # o reset
            continue
        corpo.append(linha)

    texto = "\n".join(corpo)
    for velho, novo in TOKENS:
        texto = re.sub(r"var\(" + re.escape(velho) + r"\)", "var(%s)" % novo, texto)
    for velho, novo in AJUSTES_CSS:
        texto = texto.replace(velho, novo)

    return CABECALHO_CSS + escalar_fontes(texto) + "\n"


# ─────────────────────────────────────────────────────────────────────────────
# Motores do núcleo
# ─────────────────────────────────────────────────────────────────────────────

CABECALHO_JS = """/* eslint-disable */
// @ts-nocheck
/* GERADO por `scripts/portar-presenca.py` a partir de
   `prototypes/orbita-presenca/%s`. NÃO EDITE À MÃO: rode o script.

   O miolo é verbatim. Só a casca mudou: o IIFE que pendurava em `window` virou
   módulo ES, e foi acrescentado um `destruir()` — no protótipo o núcleo vive
   enquanto a página vive, aqui ele monta e desmonta a cada troca de rota, e sem
   isso ficariam para trás um laço de animação e um listener por visita.

   O desenho, os tempos, as cores e a física não são reescritos em TypeScript de
   propósito: qualquer "melhoria" aqui vira diferença visual em relação à
   proposta aprovada. */

"""

DESTRUIR = """
    /* ACRÉSCIMO ao original: desliga o núcleo quando o React desmonta. */
    destruir(){cancelAnimationFrame(this.frameId);this.visible=false;this.ro?.disconnect();this.io?.disconnect();document.removeEventListener('visibilitychange',this.aoTrocarVisibilidade);
      /* O navegador guarda poucos contextos WebGL vivos (~16). Sem devolver o
         contexto aqui, cada visita a uma tela com núcleo consome um, e depois
         de algumas navegações o núcleo para de desenhar sem erro nenhum. */
      try{this.gl?.getExtension('WEBGL_lose_context')?.loseContext();}catch{}}
"""


def _adaptar_motor(texto):
    """Nomeia o listener de visibilidade e injeta o `destruir()`."""
    velho = "document.addEventListener('visibilitychange',()=>this.schedule());"
    if velho not in texto:
        raise SystemExit("porte: o motor mudou de forma e não achei o listener de visibilidade")
    texto = texto.replace(
        velho,
        "this.aoTrocarVisibilidade=()=>this.schedule();document.addEventListener('visibilitychange',this.aoTrocarVisibilidade);",
    )
    if texto.count("    schedule()") != 1:
        raise SystemExit("porte: esperava um único `schedule()` por motor")
    return texto.replace("    schedule()", DESTRUIR.rstrip() + "\n    schedule()")


def portar_motor_canvas():
    s = ler(PROTO, "orb.js")
    miolo = s[s.index("  const TAU=Math.PI*2;"):s.index("  window.ORBITA_STATES=definitions;")]
    return (CABECALHO_JS % "orb.js") + _adaptar_motor(miolo) + "\nexport { definitions as ESTADOS, PresenceOrb as NucleoCanvas };\n"


def portar_motor_webgl():
    s = ler(PROTO, "orb-3d.js")
    miolo = s[s.index("  const Fallback=window.PresenceOrb"):s.rindex("})();")]
    miolo = re.sub(r"const Fallback=window\.PresenceOrb,\s*TAU=Math\.PI\*2;", "const Fallback = NucleoCanvas, TAU = Math.PI * 2;", miolo)
    miolo = miolo.replace("window.ORBITA_STATES", "ESTADOS")
    miolo = miolo.replace("window.PresenceOrb=class{", "class Nucleo {")
    miolo = _adaptar_motor(miolo).rstrip()
    if not miolo.endswith("};"):
        raise SystemExit("porte: esperava que o envoltório do WebGL terminasse em `};`")
    miolo = miolo[:-2] + "}"
    return (
        (CABECALHO_JS % "orb-3d.js")
        + "import { ESTADOS, NucleoCanvas } from './motor-canvas.js';\n\n"
        + miolo
        + "\n\nexport { Nucleo, ESTADOS };\n"
    )


# ─────────────────────────────────────────────────────────────────────────────
# Ícones
# ─────────────────────────────────────────────────────────────────────────────

CABECALHO_ICONES = '''"use client";

/* GERADO por `scripts/portar-presenca.py` a partir de
   `prototypes/orbita-presenca/app.js`. NÃO EDITE À MÃO: rode o script.

   Traçado de 1,65 sobre grade de 24, sem preenchimento: é o que dá a eles o
   mesmo peso da tipografia. Foram desenhados à mão no protótipo, então não
   entra dependência nova nem fonte de ícone para carregar. */

/* O mapa é conteúdo estático deste arquivo, nunca entrada de usuário, então
   injetar como markup é seguro e poupa reescrever dezenas de ícones em JSX. */
const TRACOS: Record<string, string> = {
%s
};

export function Icone({ nome, className = "" }: { nome: string; className?: string }) {
  return (
    <svg
      className={`icon ${className}`.trim()}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: TRACOS[nome] ?? TRACOS.spark! }}
    />
  );
}
'''


def portar_icones():
    s = ler(PROTO, "app.js")
    bloco = s[s.index("const paths = {"):]
    bloco = bloco[:bloco.index("\n  };")]
    pares = re.findall(r"^\s*'?([a-z-]+)'?:\s*'(.*?)',\s*$", bloco, re.M)
    if len(pares) < 20:
        raise SystemExit("porte: achei só %d ícones, o formato do mapa deve ter mudado" % len(pares))
    linhas = ["  %s: `%s`," % (k if k.isalpha() else repr(k), v) for k, v in pares]
    return CABECALHO_ICONES % "\n".join(linhas), len(pares)




# ─────────────────────────────────────────────────────────────────────────────
# Falas dos estados
# ─────────────────────────────────────────────────────────────────────────────

# O protótipo é uma demonstração e diz isso no texto dos estados. No produto
# essas mesmas frases seriam falsas, e uma delas seria grave: em "escutando" o
# microfone está LIGADO de verdade, e prometer o contrário na tela é mentir
# sobre privacidade. Aqui ficam as únicas substituições de copy do porte, uma a
# uma e com o motivo à vista. Tom e ritmo das frases são preservados.
AJUSTES_ESTADOS = {
    ("listening", "description"): (
        "Escuta demonstrativa. Seu microfone continua desligado.",
        "Seu microfone está aberto. É só falar.",
    ),
    ("speaking", "description"): (
        "A estrutura inteira acompanha o ritmo de uma fala demonstrativa.",
        "A estrutura inteira acompanha o ritmo da fala.",
    ),
    ("searching", "description"): (
        "Percorrendo as fontes do cenário de demonstração.",
        "Percorrendo suas fontes e o que está conectado.",
    ),
    ("executing", "status"): (
        "Comando em execução · demonstração",
        "Comando em execução",
    ),
    ("executing", "description"): (
        "Acompanhe a execução visual. Nenhuma máquina real está conectada.",
        "Acompanhe cada passo. Só acontece o que você aprovou.",
    ),
}


CABECALHO_ESTADOS = '''/* GERADO por `scripts/portar-presenca.py` a partir de
   `prototypes/orbita-presenca/orb.js`. NÃO EDITE À MÃO: rode o script.

   O texto de cada estado do núcleo (o que a tela diz enquanto ele pensa, fala
   ou espera uma decisão) é parte do desenho, não da implementação. Vem daqui
   em vez de escrito nas telas porque, escrito à mão, ele diverge do protótipo
   em silêncio na primeira vez que a proposta muda uma frase. */

export interface FalaDoEstado {
  /** nome curto, para etiquetas */
  label: string;
  /** linha de status ao lado do ponto luminoso */
  status: string;
  /** título grande sob o núcleo */
  title: string;
  /** frase de apoio */
  description: string;
}

export const ESTADOS_NUCLEO = {
%s
} as const satisfies Record<string, FalaDoEstado>;

export type EstadoNucleo = keyof typeof ESTADOS_NUCLEO;
'''


def portar_estados():
    """Tira do motor só o texto de cada estado, tipado, para as telas usarem."""
    fonte = ler(PROTO, "orb.js")
    bloco = fonte[fonte.index("const definitions={"):]
    bloco = bloco[:bloco.index(chr(10) + "  };")]
    achados = re.findall(
        r"^\s*([a-z]+):\{label:'(.*?)',status:'(.*?)'.*?title:'(.*?)',description:'(.*?)'",
        bloco, re.M | re.S)
    if len(achados) < 6:
        raise SystemExit("porte: achei só %d estados, o formato deve ter mudado" % len(achados))

    def esc(t):
        return t.replace("\\", "\\\\").replace('"', '\\"')

    usados = set()

    def ajustar(chave, campo, valor):
        troca = AJUSTES_ESTADOS.get((chave, campo))
        if troca and troca[0] == valor:
            usados.add((chave, campo))
            return troca[1]
        return valor

    linhas = [
        '  %s: { label: "%s", status: "%s", title: "%s", description: "%s" },'
        % (chave, esc(label), esc(ajustar(chave, "status", status)),
           esc(ajustar(chave, "title", titulo)), esc(ajustar(chave, "description", desc)))
        for chave, label, status, titulo, desc in achados
    ]
    # Se o protótipo reescreveu uma dessas frases, o ajuste para de casar e
    # passaria em silêncio: o texto de demonstração voltaria para a tela.
    perdidos = set(AJUSTES_ESTADOS) - usados
    if perdidos:
        raise SystemExit(
            "porte: estes ajustes de copy não casaram mais (o protótipo mudou a frase): %s"
            % ", ".join("%s.%s" % k for k in sorted(perdidos)))
    return CABECALHO_ESTADOS % (chr(10).join(linhas)), len(achados)


# ─────────────────────────────────────────────────────────────────────────────
# Marca do app (favicon e ícones do PWA)
# ─────────────────────────────────────────────────────────────────────────────

# O mesmo desenho do favicon do protótipo: quadrado floresta, anel menta
# inclinado e núcleo cheio. Fica aqui em números para poder ser desenhado nos
# tamanhos que o PWA pede, sem depender de rasterizador de SVG.
FUNDO = (0x17, 0x30, 0x2B, 255)
MENTA = (0xC9, 0xF4, 0xB0, 255)

MARCA_SVG = (
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>"
    "<rect width='64' height='64' rx='18' fill='#17302b'/>"
    "<ellipse cx='32' cy='32' rx='23' ry='12' transform='rotate(-35 32 32)' "
    "fill='none' stroke='#c9f4b0' stroke-width='3'/>"
    "<circle cx='32' cy='32' r='10' fill='#c9f4b0'/>"
    "</svg>" + chr(10)
)


def _desenhar_marca(tamanho, escala=1.0, cantos_arredondados=True):
    """Desenha a marca com superamostragem de 8x e reduz no fim: o anel tem 3
    unidades de espessura em 64, e sem isso ele sai serrilhado."""
    from PIL import Image, ImageDraw

    S = 8
    px = tamanho * S
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if cantos_arredondados:
        d.rounded_rectangle([0, 0, px - 1, px - 1], radius=int(px * 18 / 64), fill=FUNDO)
    else:
        # Maskable: o sistema recorta o formato que quiser, então o fundo vai
        # até a borda e a marca encolhe para caber na zona segura.
        d.rectangle([0, 0, px, px], fill=FUNDO)

    centro = px / 2
    # O anel é desenhado numa camada própria porque precisa girar; girar a
    # imagem inteira levaria junto o fundo e os cantos.
    anel = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    ad = ImageDraw.Draw(anel)
    rx, ry = px * 23 / 64 * escala, px * 12 / 64 * escala
    ad.ellipse(
        [centro - rx, centro - ry, centro + rx, centro + ry],
        outline=MENTA,
        width=max(S, int(px * 3 / 64 * escala)),
    )
    # No SVG o eixo y cresce para baixo, então `rotate(-35)` é anti-horário na
    # tela; no Pillow o ângulo positivo já é anti-horário.
    img.alpha_composite(anel.rotate(35, resample=Image.BICUBIC, center=(centro, centro)))

    nucleo = px * 10 / 64 * escala
    d.ellipse([centro - nucleo, centro - nucleo, centro + nucleo, centro + nucleo], fill=MENTA)

    return img.resize((tamanho, tamanho), Image.LANCZOS)


def portar_marca(conferir):
    """Gera o favicon e os ícones do PWA. Sem Pillow, avisa e segue: o resto do
    porte não depende disto."""
    publico = os.path.join(RAIZ, "apps", "web", "public")
    mudou = []

    caminho_svg = os.path.join(publico, "icone.svg")
    if not os.path.exists(caminho_svg) or ler(caminho_svg) != MARCA_SVG:
        mudou.append("marca em SVG")
        if not conferir:
            gravar(caminho_svg, MARCA_SVG)

    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print("  pulado   ícones PNG (Pillow não instalado: pip install Pillow)")
        return mudou

    import hashlib

    for nome, tamanho, escala, cantos in [
        ("icon-192.png", 192, 1.0, True),
        ("icon-512.png", 512, 1.0, True),
        ("icon-512-maskable.png", 512, 0.62, False),
    ]:
        caminho = os.path.join(publico, nome)
        buffer = io.BytesIO()
        _desenhar_marca(tamanho, escala, cantos).save(buffer, "PNG", optimize=True)
        novo = buffer.getvalue()
        antigo = open(caminho, "rb").read() if os.path.exists(caminho) else None
        # Compara por conteúdo: o PNG é determinístico, então gravar igual só
        # sujaria o git e faria o service worker achar que o ícone mudou.
        if antigo is not None and hashlib.sha256(antigo).digest() == hashlib.sha256(novo).digest():
            continue
        mudou.append(nome)
        if not conferir:
            open(caminho, "wb").write(novo)

    return mudou


# ─────────────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="Porta o protótipo Presença para o app.")
    ap.add_argument("--conferir", action="store_true", help="não grava; sai com 1 se algo estiver desatualizado")
    args = ap.parse_args()

    icones, quantos = portar_icones()
    estados, quantos_estados = portar_estados()
    alvos = [
        (os.path.join(WEB, "app", "presenca.css"), portar_css(), "folha de estilo"),
        (os.path.join(WEB, "lib", "presenca", "motor-canvas.js"), portar_motor_canvas(), "motor Canvas"),
        (os.path.join(WEB, "lib", "presenca", "motor-webgl.js"), portar_motor_webgl(), "motor WebGL"),
        (os.path.join(WEB, "components", "presenca", "icones.tsx"), icones, "%d ícones" % quantos),
        (os.path.join(WEB, "components", "presenca", "estados.ts"), estados, "%d falas de estado" % quantos_estados),
    ]

    desatualizados = []
    for caminho, conteudo, rotulo in alvos:
        atual = ler(caminho) if os.path.exists(caminho) else None
        if atual == conteudo:
            print("  em dia    %s" % rotulo)
            continue
        desatualizados.append(rotulo)
        if args.conferir:
            print("  MUDOU     %s" % rotulo)
        else:
            gravar(caminho, conteudo)
            print("  atualizado %s" % rotulo)

    for rotulo in portar_marca(args.conferir):
        desatualizados.append(rotulo)
        print("  %s %s" % ("MUDOU    " if args.conferir else "atualizado", rotulo))

    if args.conferir and desatualizados:
        print("\nO protótipo mudou. Rode: python scripts/portar-presenca.py")
        sys.exit(1)
    if not desatualizados:
        print("\nNada a fazer: o app já reflete o protótipo.")


if __name__ == "__main__":
    main()
