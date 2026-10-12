"""Ver o Windows pela árvore de acessibilidade (PRD A6), e achar o alvo de uma ação.

Toda chamada de UIA roda numa thread SÓ, com o COM iniciado uma vez: a UIA
é COM, cada thread precisa do seu apartamento, e chamadas paralelas na mesma
árvore só disputam o mesmo processo do app do outro lado.

A leitura de uma janela vira uma LEITURA com id. Cada elemento ganha um
número dentro dela, e a ordem "clique no 17 da leitura X" é resolvida pelo
que foi guardado: identificador da UIA, retângulo e uma ASSINATURA (papel,
nome, id de automação e processo). Na hora de agir, o elemento que está
naquele lugar AGORA é comparado com a assinatura: se mudou, "a tela mudou"
(PRD §5.1, tempo entre checar e usar).

App oculto (`computador.appsOcultos`) não tem árvore: a janela some da lista
e a leitura dela é recusada, aqui, antes de qualquer byte sair.
"""

from __future__ import annotations

import ctypes
import hashlib
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from ctypes import wintypes as w

from .apps import app_oculto, identidade_do_pid
from .dpi import monitores
from .seguranca import pid_elevado
from .win32 import WNDENUMPROC, janela_escondida_pelo_dwm, pid_da_janela, retangulo_da_janela, texto_da_janela, user32

# ── a thread da UIA ─────────────────────────────────────────────────────────


RPC_E_CHANGED_MODE = -2147417850


def _iniciar_com() -> None:
    import sys

    # O comtypes inicia o COM da thread que o IMPORTA pela primeira vez, como STA
    # (o padrão de `sys.coinit_flags`). No serviço instalado é esta thread que o
    # importa primeiro, e o pedido de MTA logo abaixo falhava com "não é possível
    # alterar o modo de thread": o pool quebrava e nenhuma leitura de tela
    # funcionava mais. O pytest não pegava porque lá o import já tinha acontecido
    # na thread principal (test_uia_no_processo_novo reproduz o serviço).
    if "comtypes" not in sys.modules:
        sys.coinit_flags = 0  # COINIT_MULTITHREADED
    import comtypes

    try:
        comtypes.CoInitializeEx(comtypes.COINIT_MULTITHREADED)
    except OSError as e:
        if getattr(e, "winerror", None) != RPC_E_CHANGED_MODE:
            raise


_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="uia", initializer=_iniciar_com)
_ia = None


def _uia():
    global _ia
    if _ia is None:
        import uiautomation.uiautomation as U

        _ia = U._AutomationClient.instance().IUIAutomation
    return _ia


def na_thread_da_uia(fn, *args, timeout: float = 20.0, **kw):
    return _executor.submit(fn, *args, **kw).result(timeout=timeout)


# ── propriedades e papéis ───────────────────────────────────────────────────
P_RUNTIME, P_RECT, P_PID, P_TIPO, P_NOME, P_FOCO, P_FOCAVEL, P_ENABLED, P_AUTOID, P_CLASSE = 30000, 30001, 30002, 30003, 30005, 30008, 30009, 30010, 30011, 30012
P_OFFSCREEN, P_SENHA, P_HWND = 30022, 30019, 30020
P_INVOKE_OK, P_VALUE_OK, P_TOGGLE_OK, P_SELITEM_OK, P_EXPAND_OK = 30031, 30043, 30041, 30036, 30028
P_VALOR, P_VALOR_RO, P_TOGGLE, P_SELECIONADO, P_EXPANDIDO = 30045, 30046, 30086, 30079, 30070
PROPRIEDADES = (P_RUNTIME, P_RECT, P_PID, P_TIPO, P_NOME, P_FOCO, P_ENABLED, P_AUTOID, P_OFFSCREEN, P_SENHA, P_INVOKE_OK, P_VALUE_OK, P_TOGGLE_OK, P_SELITEM_OK, P_EXPAND_OK, P_VALOR, P_VALOR_RO, P_TOGGLE, P_SELECIONADO, P_EXPANDIDO)
PADRAO_INVOKE, PADRAO_VALUE, PADRAO_TOGGLE, PADRAO_SELITEM, PADRAO_EXPAND = 10000, 10002, 10015, 10010, 10005

PAPEIS = {
    50000: "botao", 50001: "calendario", 50002: "caixa_de_selecao", 50003: "combo", 50004: "campo", 50005: "link", 50006: "imagem",
    50007: "item_de_lista", 50008: "lista", 50009: "menu", 50010: "barra_de_menu", 50011: "item_de_menu", 50012: "barra_de_progresso",
    50013: "opcao", 50014: "barra_de_rolagem", 50015: "controle_deslizante", 50016: "spinner", 50017: "barra_de_status", 50018: "abas",
    50019: "aba", 50020: "texto", 50021: "barra_de_ferramentas", 50022: "dica", 50023: "arvore", 50024: "item_de_arvore", 50025: "outro",
    50026: "grupo", 50027: "polegar", 50028: "grade", 50029: "item_de_grade", 50030: "documento", 50031: "botao_dividido", 50032: "janela",
    50033: "painel", 50034: "cabecalho", 50035: "item_de_cabecalho", 50036: "tabela", 50037: "barra_de_titulo", 50038: "separador",
    50039: "mapa_semantico", 50040: "app_bar",
}
# o que dá para usar (clicar, digitar, escolher); texto e imagem entram só com nome, para dar contexto
INTERATIVOS = {50000, 50002, 50003, 50004, 50005, 50007, 50011, 50013, 50015, 50016, 50019, 50024, 50029, 50030, 50031, 50035}
CONTEXTO = {50020, 50006, 50034, 50017, 50026, 50021, 50009, 50010, 50018, 50008}

CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏‪-‮⁦-⁩]")


def limpo(s: object, maximo: int = 160) -> str:
    """Texto da tela sem caractere de controle nem marca de direção (truque de esconder instrução)."""
    t = CTRL.sub("", str(s or "")).strip()
    return t[:maximo]


def assinatura_de(tipo: int, nome: str, autoid: str, pid: int) -> str:
    return hashlib.sha1(f"{tipo}|{nome}|{autoid}|{pid}".encode("utf-8", "replace")).hexdigest()[:16]


# ── janelas ─────────────────────────────────────────────────────────────────
GA_ROOT = 2
user32.GetAncestor.argtypes = [w.HWND, w.UINT]
user32.GetAncestor.restype = w.HWND
user32.WindowFromPoint.argtypes = [w.POINT]
user32.WindowFromPoint.restype = w.HWND
GWL_EXSTYLE = -20
WS_EX_TOOLWINDOW = 0x80
_proprias: set[int] = set()


def registrar_janela_propria(hwnd: int) -> None:
    """A borda e a janela da bandeja são da Órbita: nunca aparecem na lista nem na árvore."""
    _proprias.add(int(hwnd))


def _monitor_de(ret: tuple[int, int, int, int]) -> int | None:
    cx, cy = (ret[0] + ret[2]) // 2, (ret[1] + ret[3]) // 2
    for m in monitores():
        if m.contem(cx, cy):
            return m.indice
    return None


user32.EnumChildWindows.argtypes = [w.HWND, WNDENUMPROC, w.LPARAM]
user32.GetClassNameW.argtypes = [w.HWND, w.LPWSTR, ctypes.c_int]

HOSPEDEIRO_UWP = "applicationframehost.exe"
CLASSE_DO_APP_UWP = "Windows.UI.Core.CoreWindow"


def pid_do_app_uwp(pid: int, exe: str, filhas: list[int]) -> int:
    """App da Microsoft Store (Calculadora, Configurações) roda hospedado: a janela de cima é do
    ApplicationFrameHost e o app de verdade é a janela filha CoreWindow, de OUTRO processo. Sem isto
    toda janela UWP aparecia como "Application Frame Host" e nenhum envelope a cobria. Só troca
    quando a janela É do hospedeiro e a filha é de outro processo; qualquer outra coisa fica como estava. Puro."""
    if (exe or "").lower() != HOSPEDEIRO_UWP:
        return pid
    return next((f for f in filhas if f and f != pid), pid)


def _pids_das_filhas_uwp(hwnd: int) -> list[int]:
    achados: list[int] = []

    def cb(h, _lp):
        buf = ctypes.create_unicode_buffer(80)
        user32.GetClassNameW(h, buf, 80)
        if buf.value == CLASSE_DO_APP_UWP:
            achados.append(pid_da_janela(h))
        return True

    try:
        user32.EnumChildWindows(hwnd, WNDENUMPROC(cb), 0)
    except Exception:  # noqa: BLE001 - janela que sumiu no meio: fica o hospedeiro
        return []
    return achados


def _identidade_da_janela(hwnd: int, pid: int) -> tuple[int, dict]:
    ident = identidade_do_pid(pid)
    real = pid_do_app_uwp(pid, ident["exe"], _pids_das_filhas_uwp(hwnd) if (ident["exe"] or "").lower() == HOSPEDEIRO_UWP else [])
    return (real, identidade_do_pid(real) if real != pid else ident)


def info_da_janela(hwnd: int, ocultos: list[str]) -> dict:
    pid_host = pid_da_janela(hwnd)
    pid, ident = _identidade_da_janela(hwnd, pid_host)
    titulo = texto_da_janela(hwnd)
    oculta = app_oculto(ident["nomes"], titulo, ocultos)
    ret = retangulo_da_janela(hwnd)
    return {
        "janela": int(hwnd),
        "titulo": "[janela oculta pela configuração]" if oculta else limpo(titulo, 200),
        "app": ident["app"],
        "exe": ident["exe"],
        "nomes": ident["nomes"],
        "pid": pid,
        "foco": int(user32.GetForegroundWindow() or 0) == int(hwnd),
        "minimizada": bool(user32.IsIconic(hwnd)),
        "monitor": _monitor_de(ret),
        "retangulo": list(ret),
        "elevada": pid_elevado(pid) is True,
        "oculta": oculta,
    }


def listar_janelas(ocultos: list[str]) -> list[dict]:
    hwnds: list[int] = []

    def cb(h, _lp):
        if user32.IsWindowVisible(h) and int(h) not in _proprias and texto_da_janela(h) and not janela_escondida_pelo_dwm(h):
            if not (user32.GetWindowLongW(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW):
                hwnds.append(int(h))
        return True

    user32.EnumWindows(WNDENUMPROC(cb), 0)
    # "Program Manager" é a área de trabalho, não uma janela de app
    return [i for i in (info_da_janela(h, ocultos) for h in hwnds) if i["exe"].lower() != "explorer.exe" or i["titulo"] != "Program Manager"]


def retangulos_ocultos(ocultos: list[str]) -> list[tuple[int, int, int, int]]:
    """Toda janela visível de app oculto, INCLUSIVE as sem título e as de ferramenta
    (o popup do gerenciador de senha não tem título): é o que a captura pinta de preto."""
    if not ocultos:
        return []
    out: list[tuple[int, int, int, int]] = []
    por_pid: dict[int, bool] = {}

    def cb(h, _lp):
        if not user32.IsWindowVisible(h) or user32.IsIconic(h) or int(h) in _proprias or janela_escondida_pelo_dwm(h):
            return True
        pid = pid_da_janela(h)
        if pid not in por_pid:
            por_pid[pid] = app_oculto(identidade_do_pid(pid)["nomes"], "", ocultos)
        if por_pid[pid] or app_oculto([], texto_da_janela(h), ocultos):
            out.append(retangulo_da_janela(h))
        return True

    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return out


def janela_do_ponto(x: int, y: int) -> int:
    h = user32.WindowFromPoint(w.POINT(x, y))
    return int(user32.GetAncestor(h, GA_ROOT) or h or 0)


# ── leituras ────────────────────────────────────────────────────────────────
_leituras: dict[str, dict] = {}
_lock = threading.Lock()


def _guardar_leitura(dados: dict) -> str:
    lid = uuid.uuid4().hex[:8]
    with _lock:
        _leituras[lid] = dados
        if len(_leituras) > 12:
            for k in sorted(_leituras, key=lambda k: _leituras[k]["quando"])[:-12]:
                del _leituras[k]
    return lid


def leitura(lid: str) -> dict | None:
    with _lock:
        return _leituras.get(lid)


def _cache_request():
    ia = _uia()
    cr = ia.CreateCacheRequest()
    for p in PROPRIEDADES:
        cr.AddProperty(p)
    return cr


def _propriedades(e) -> dict:
    g = e.GetCachedPropertyValue
    rect = g(P_RECT) or (0, 0, 0, 0)
    return {
        "runtime": tuple(g(P_RUNTIME) or ()),
        "rect": (int(rect[0]), int(rect[1]), int(rect[0] + rect[2]), int(rect[1] + rect[3])),
        "pid": int(g(P_PID) or 0),
        "tipo": int(g(P_TIPO) or 0),
        "nome": limpo(g(P_NOME)),
        "foco": bool(g(P_FOCO)),
        "habilitado": bool(g(P_ENABLED)),
        "autoid": limpo(g(P_AUTOID), 120),
        "fora_da_tela": bool(g(P_OFFSCREEN)),
        "senha": bool(g(P_SENHA)),
        "invoke": bool(g(P_INVOKE_OK)),
        "value": bool(g(P_VALUE_OK)),
        "toggle": bool(g(P_TOGGLE_OK)),
        "selitem": bool(g(P_SELITEM_OK)),
        "expand": bool(g(P_EXPAND_OK)),
        "valor": g(P_VALOR),
        "somente_leitura": bool(g(P_VALOR_RO)),
        "marcado": g(P_TOGGLE),
        "selecionado": bool(g(P_SELECIONADO)),
        "expandido": g(P_EXPANDIDO),
    }


def _estado(p: dict) -> list[str]:
    e = []
    if not p["habilitado"]:
        e.append("desabilitado")
    if p["foco"]:
        e.append("com_foco")
    if p["toggle"] and p["marcado"] in (0, 1):
        e.append("marcado" if p["marcado"] == 1 else "desmarcado")
    if p["selecionado"]:
        e.append("selecionado")
    if p["expand"] and p["expandido"] in (0, 1):
        e.append("expandido" if p["expandido"] == 1 else "recolhido")
    if p["senha"]:
        e.append("senha")
    return e


def _ler_janela(hwnd: int, maximo: int, ocultos: list[str]) -> dict:
    info = info_da_janela(hwnd, ocultos)
    if info["oculta"]:
        raise PermissionError("Esta janela é de um app oculto pela configuração: a Órbita não a lê.")
    ia = _uia()
    comeco = time.perf_counter()
    raiz = ia.ElementFromHandle(hwnd)
    arr = raiz.FindAllBuildCache(4, ia.ControlViewCondition, _cache_request())
    n = arr.Length if arr else 0
    uteis: list[dict] = []
    for i in range(n):
        try:
            p = _propriedades(arr.GetElement(i))
        except Exception:  # noqa: BLE001 - elemento sumiu no meio da leitura
            continue
        l, t, r, b = p["rect"]
        if p["fora_da_tela"] or r - l < 2 or b - t < 2:
            continue
        if p["tipo"] in INTERATIVOS or (p["tipo"] in CONTEXTO and p["nome"]):
            p["ordem"] = len(uteis)
            uteis.append(p)
    # interativos primeiro (na ordem da árvore), o contexto depois, até o teto
    ordenados = [p for p in uteis if p["tipo"] in INTERATIVOS] + [p for p in uteis if p["tipo"] not in INTERATIVOS]
    escolhidos = ordenados[:maximo]
    mapa: dict[int, dict] = {}
    elementos = []
    for k, p in enumerate(sorted(escolhidos, key=lambda p: p["ordem"]), start=1):
        p["assinatura"] = assinatura_de(p["tipo"], p["nome"], p["autoid"], p["pid"])
        mapa[k] = p
        item = {"id": k, "papel": PAPEIS.get(p["tipo"], "outro"), "nome": p["nome"], "retangulo": list(p["rect"])}
        if p["value"] and not p["senha"] and isinstance(p["valor"], str) and p["valor"] and p["tipo"] in (50004, 50003, 50015, 50016):
            item["valor"] = limpo(p["valor"], 200)
        est = _estado(p)
        if est:
            item["estado"] = est
        elementos.append(item)
    lid = _guardar_leitura({"hwnd": hwnd, "pid": info["pid"], "nomes": info["nomes"], "app": info["app"], "quando": time.time(), "elementos": mapa})
    return {
        "leitura": lid,
        "janela": info,
        "elementos": elementos,
        "total_na_arvore": n,
        "uteis": len(uteis),
        "cortados": max(0, len(uteis) - len(escolhidos)),
        "ms": round((time.perf_counter() - comeco) * 1000),
    }


def ler_janela(hwnd: int, maximo: int, ocultos: list[str]) -> dict:
    return na_thread_da_uia(_ler_janela, hwnd, maximo, ocultos, timeout=30)


def _descrever(e, hwnd: int, ocultos: list[str]) -> dict:
    ia = _uia()
    cr = _cache_request()
    e = e.BuildUpdatedCache(cr)
    p = _propriedades(e)
    info = info_da_janela(hwnd, ocultos) if hwnd else {"app": "", "nomes": [], "oculta": False, "elevada": False, "titulo": "", "pid": p["pid"]}
    return {
        "papel": PAPEIS.get(p["tipo"], "outro"),
        "nome": p["nome"],
        "automation_id": p["autoid"],
        "retangulo": list(p["rect"]),
        "senha": p["senha"],
        "habilitado": p["habilitado"],
        "padroes": [n for n, ok in (("invoke", p["invoke"]), ("value", p["value"]), ("toggle", p["toggle"]), ("selecao", p["selitem"]), ("expandir", p["expand"])) if ok],
        "janela": int(hwnd),
        "pid": p["pid"],
        "app": info["app"],
        "nomes_do_app": info["nomes"],
        "oculto": info["oculta"],
        "elevado": info["elevada"],
        "assinatura": assinatura_de(p["tipo"], p["nome"], p["autoid"], p["pid"]),
        "_elemento": e,
        "_tipo": p["tipo"],
        "_props": p,
    }


def _no_ponto(x: int, y: int, ocultos: list[str]) -> dict:
    ia = _uia()
    e = ia.ElementFromPoint(w.POINT(x, y))
    return _descrever(e, janela_do_ponto(x, y), ocultos)


def descrever_no_ponto(x: int, y: int, ocultos: list[str]) -> dict:
    """O que a UIA diz que está NESTE ponto da tela (o "clique em 640,320" do Claude vira "o botão Enviar")."""
    d = na_thread_da_uia(_no_ponto, x, y, ocultos)
    return publico(d)


def publico(d: dict) -> dict:
    return {k: v for k, v in d.items() if not k.startswith("_")}


def _focado(ocultos: list[str]) -> dict | None:
    ia = _uia()
    try:
        e = ia.GetFocusedElement()
    except Exception:  # noqa: BLE001
        return None
    hwnd = int(e.CurrentNativeWindowHandle or 0)
    if not hwnd:
        hwnd = int(user32.GetForegroundWindow() or 0)
    else:
        hwnd = int(user32.GetAncestor(hwnd, GA_ROOT) or hwnd)
    return _descrever(e, hwnd, ocultos)


def elemento_focado(ocultos: list[str]) -> dict | None:
    return na_thread_da_uia(_focado, ocultos)


def centro(rect: list[int] | tuple[int, ...]) -> tuple[int, int]:
    return ((rect[0] + rect[2]) // 2, (rect[1] + rect[3]) // 2)


def do_cache(lid: str, eid: int) -> dict | None:
    """O elemento `eid` da leitura `lid`, como foi guardado (sem tocar na UIA)."""
    lei = leitura(lid)
    if not lei:
        return None
    p = lei["elementos"].get(int(eid))
    if not p:
        return None
    return {"hwnd": lei["hwnd"], "pid": lei["pid"], "nomes": lei["nomes"], "app": lei["app"], **p}
