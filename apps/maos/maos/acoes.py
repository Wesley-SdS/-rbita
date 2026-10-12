"""Agir no Windows (PRD A7): uma ordem concreta, conferida de novo AQUI.

O core já decidiu risco, crítico e fila. Mesmo assim, antes de cada ação:

  1. o espelho do envelope: sessão ativa, a MESMA sessão da ordem, app no envelope;
  2. app oculto e janela elevada são recusados (a UIPI recusaria em silêncio);
  3. a ASSINATURA do alvo: o elemento que está naquele ponto agora tem de ser
     o que foi mostrado ao modelo (ou um ancestral dele, porque o ponto cai no
     texto de dentro do botão). Mudou, "a tela mudou", e nada é clicado;
  4. digitar (ou colar) em campo de SENHA é recusado, sempre;
  5. o padrão de acessibilidade primeiro (Invoke, Toggle, Value: não dependem
     de onde o mouse está), a coordenada só de reserva.
"""

from __future__ import annotations

import threading
import time

from . import entrada
from .captura import CAPTURADOR
from .envelope import Espelho
from .uia import (
    GA_ROOT,
    PADRAO_INVOKE,
    PADRAO_SELITEM,
    PADRAO_TOGGLE,
    PADRAO_VALUE,
    _cache_request,
    _descrever,
    _focado,
    _propriedades,
    _uia,
    assinatura_de,
    centro,
    do_cache,
    info_da_janela,
    janela_do_ponto,
    na_thread_da_uia,
    publico,
)
from .win32 import user32
from ctypes import wintypes as w

# As MESMAS de `ACOES_DO_COMPUTADOR` no core. Mover o mouse sem clicar e segurar ou soltar o botão
# não existem de propósito: não têm um alvo único que o risco possa avaliar (o core os desliga no
# toolset do Claude), e uma ação que o core nunca manda é só porta aberta aqui.
ACOES = {"clicar", "clique_duplo", "clique_direito", "clique_meio", "clique_triplo", "digitar", "tecla", "atalho", "rolar", "arrastar", "focar"}
PRECISA_DE_ALVO = {"clique_duplo", "clique_direito", "clique_meio", "clique_triplo", "arrastar", "focar"}


class Recusa(Exception):
    """Recusa com motivo para o modelo (não é erro do serviço)."""


def _ponto_do_alvo(alvo: dict | None) -> tuple[tuple[int, int] | None, dict | None]:
    """(ponto físico, elemento da leitura) a partir de leitura+elemento, captura+x+y, captura+marca ou x+y físico."""
    if not alvo:
        return None, None
    if alvo.get("leitura") and alvo.get("elemento") is not None:
        c = do_cache(str(alvo["leitura"]), int(alvo["elemento"]))
        if not c:
            raise Recusa("Essa leitura da tela expirou ou o elemento não existe nela: veja a janela de novo.")
        return centro(c["rect"]), c
    if alvo.get("captura") and alvo.get("marca") is not None:
        return CAPTURADOR.marca(str(alvo["captura"]), int(alvo["marca"])), None
    if alvo.get("x") is not None and alvo.get("y") is not None:
        if alvo.get("captura"):
            return CAPTURADOR.para_fisico(str(alvo["captura"]), float(alvo["x"]), float(alvo["y"])), None
        return (int(alvo["x"]), int(alvo["y"])), None
    return None, None


def _no_ponto_conferido(ponto: tuple[int, int], assinatura: str | None, ocultos: list[str]) -> dict:
    """O elemento do ponto; com assinatura, ele ou um ancestral próximo tem de bater."""
    ia = _uia()
    e = ia.ElementFromPoint(w.POINT(*ponto))
    hwnd = janela_do_ponto(*ponto)
    desc = _descrever(e, hwnd, ocultos)
    if not assinatura or desc["assinatura"] == assinatura:
        return desc
    cr = _cache_request()
    walker = ia.ControlViewWalker
    atual = desc["_elemento"]
    for _ in range(6):
        try:
            atual = walker.GetParentElementBuildCache(atual, cr)
        except Exception:  # noqa: BLE001
            break
        if not atual:
            break
        pr = _propriedades(atual)
        if assinatura_de(pr["tipo"], pr["nome"], pr["autoid"], pr["pid"]) == assinatura:
            return _descrever(atual, hwnd, ocultos)
    raise Recusa(f"A tela mudou: no lugar do alvo agora está \"{desc['nome'] or desc['papel']}\" ({desc['papel']}). Veja a tela de novo antes de agir.")


def _trazer_para_frente(hwnd: int) -> None:
    if not hwnd or int(user32.GetForegroundWindow() or 0) == hwnd:
        return
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    # Primeiro sem tecla nenhuma: ligar a fila de entrada desta thread à da janela da
    # frente dá o direito de trocar o foco. O Alt injetado (o truque de antes) virava
    # "abrir o menu": o Bloco de Notas ficava com as teclas de acesso por cima, o
    # elemento sob o ponto mudava e toda ação seguinte era recusada (11/10/2026).
    from .win32 import kernel32

    frente = int(user32.GetForegroundWindow() or 0)
    dela = int(user32.GetWindowThreadProcessId(frente, None)) if frente else 0
    minha = int(kernel32.GetCurrentThreadId())
    ligou = bool(dela and dela != minha and user32.AttachThreadInput(minha, dela, True))
    try:
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
    finally:
        if ligou:
            user32.AttachThreadInput(minha, dela, False)
    time.sleep(0.08)
    if int(user32.GetForegroundWindow() or 0) != hwnd:
        # reserva: qualquer tecla injetada faz deste processo o dono da "última entrada", e quem
        # deu a última entrada pode trocar o foco. F24 não existe no teclado e nenhum app a usa
        # (o Alt de antes abria o menu da janela que estava na frente)
        entrada.atalho("f24")
        user32.SetForegroundWindow(hwnd)
        time.sleep(0.08)


def _padrao(elemento, pid: int):
    from comtypes.gen import UIAutomationClient as UIA

    iface = {
        PADRAO_INVOKE: UIA.IUIAutomationInvokePattern,
        PADRAO_VALUE: UIA.IUIAutomationValuePattern,
        PADRAO_TOGGLE: UIA.IUIAutomationTogglePattern,
        PADRAO_SELITEM: UIA.IUIAutomationSelectionItemPattern,
    }[pid]
    p = elemento.GetCurrentPattern(pid)
    return p.QueryInterface(iface) if p else None


# acima disto (um editor com um arquivo enorme), ler o valor a cada tecla custaria mais que digitar
VALOR_MAX_CONFERIDO = 200_000


def _valor_atual(elemento) -> str | None:
    """O texto do alvo pelo padrão Value, ou None se ele não expõe."""
    try:
        p = _padrao(elemento, PADRAO_VALUE)
        return None if p is None else str(p.CurrentValue or "")
    except Exception:  # noqa: BLE001 - alvo sem o padrão, ou que sumiu
        return None


def _quebras(s: str) -> str:
    return s.replace("\r\n", "\n").replace("\r", "\n")


def _com_prazo(fn, segundos: float = 4.0) -> bool:
    """Invoke de um botão que abre diálogo modal pode só voltar quando o diálogo fecha:
    o clique aconteceu, e a resposta não espera por isso."""
    pronto = threading.Event()
    erro: list[BaseException] = []

    def rodar():
        try:
            na_thread_da_uia(fn, timeout=segundos + 1)
        except BaseException as e:  # noqa: BLE001
            erro.append(e)
        finally:
            pronto.set()

    threading.Thread(target=rodar, daemon=True).start()
    pronto.wait(segundos)
    if erro and not isinstance(erro[0], TimeoutError):
        raise erro[0]
    return pronto.is_set()


def agir(ordem: dict, espelho: Espelho, ocultos: list[str]) -> dict:
    acao = ordem.get("acao")
    if acao not in ACOES:
        raise Recusa(f"Ação desconhecida: {acao}.")
    entrada.INTERRUPTOR.conferir()
    alvo = ordem.get("alvo") or None
    ponto, do_cache_ = _ponto_do_alvo(alvo)
    if acao in PRECISA_DE_ALVO and ponto is None:
        raise Recusa(f"A ação {acao} precisa de um alvo (elemento da leitura ou ponto da captura).")
    assinatura = ordem.get("assinatura") or (do_cache_ or {}).get("assinatura")

    if ponto is not None:
        desc = na_thread_da_uia(_no_ponto_conferido, ponto, assinatura, ocultos)
    else:
        desc = na_thread_da_uia(_focado, ocultos)
        if not desc:
            raise Recusa("Não há elemento com foco para receber a ação.")
    hwnd = int(desc["janela"] or 0)
    if do_cache_ and hwnd and int(user32.GetAncestor(hwnd, GA_ROOT) or hwnd) != int(do_cache_["hwnd"]):
        raise Recusa("A tela mudou: outra janela está por cima do alvo. Veja a tela de novo.")
    info = info_da_janela(hwnd, ocultos) if hwnd else None
    if info and info["oculta"]:
        raise Recusa("Esta janela é de um app oculto pela configuração: a Órbita não age nela.")
    if info and info["elevada"]:
        raise Recusa("Esta janela roda como administrador: a Órbita nunca age em janela elevada.")
    motivo = espelho.conferir(ordem.get("sessaoId"), info["nomes"] if info else [])
    if motivo:
        raise Recusa(motivo)

    texto = ordem.get("texto") or ""
    tecla = ordem.get("tecla") or ""
    if acao == "digitar" or (acao == "atalho" and tecla.replace(" ", "").lower() in ("ctrl+v", "shift+insert")):
        foco = na_thread_da_uia(_focado, ocultos) if ponto is None else desc
        if desc.get("senha") or (foco and foco.get("senha")):
            raise Recusa("Este é um campo de senha: a Órbita nunca digita senha. Peça ao dono para digitar.")

    el = desc["_elemento"]
    padroes = desc["padroes"]
    usado = "mouse"
    if acao in ("clicar", "focar", "digitar", "tecla", "atalho") and hwnd:
        if acao != "clicar" or not ({"invoke", "toggle", "selecao"} & set(padroes)):
            _trazer_para_frente(hwnd)

    if acao == "clicar":
        if "invoke" in padroes:
            _com_prazo(lambda: _padrao(el, PADRAO_INVOKE).Invoke())
            usado = "invoke"
        elif "toggle" in padroes:
            _com_prazo(lambda: _padrao(el, PADRAO_TOGGLE).Toggle())
            usado = "toggle"
        elif "selecao" in padroes:
            _com_prazo(lambda: _padrao(el, PADRAO_SELITEM).Select())
            usado = "selecao"
        else:
            p = ponto or centro(desc["retangulo"])
            _trazer_para_frente(hwnd)
            entrada.clicar(*p, modificadores=ordem.get("modificadores"))
    elif acao in ("clique_duplo", "clique_triplo", "clique_direito", "clique_meio"):
        _trazer_para_frente(hwnd)
        botao = {"clique_direito": "direito", "clique_meio": "meio"}.get(acao, "esquerdo")
        entrada.clicar(*ponto, botao=botao, vezes={"clique_duplo": 2, "clique_triplo": 3}.get(acao, 1), modificadores=ordem.get("modificadores"))  # type: ignore[misc]
    elif acao == "digitar":
        if not texto:
            raise Recusa("Diga o texto a digitar.")
        if ponto is not None and "value" in padroes and desc["_tipo"] in (50004, 50003) and not desc["_props"]["somente_leitura"]:
            na_thread_da_uia(lambda: _padrao(el, PADRAO_VALUE).SetValue(texto))
            usado = "value"
        else:
            if ponto is not None:
                na_thread_da_uia(lambda: el.SetFocus())
            antes = na_thread_da_uia(_valor_atual, el) if "value" in padroes else None
            if antes is not None and len(antes) <= VALOR_MAX_CONFERIDO:

                def eco() -> int | None:
                    v = na_thread_da_uia(_valor_atual, el)
                    return len(v) if v is not None else None

                entrada.digitar(texto, eco=eco)
                time.sleep(0.3)
                depois = na_thread_da_uia(_valor_atual, el) or ""
                # dizer "feito" com o texto errado na tela seria pior que falhar: o dono aprovou ESTE texto
                if _quebras(texto) not in _quebras(depois):
                    raise Recusa("O texto não chegou inteiro ao app (o Windows perdeu ou trocou teclas, o que acontece com o PC sobrecarregado). Veja a tela e corrija antes de seguir.")
            else:
                entrada.digitar(texto)
            usado = "teclado"
    elif acao in ("tecla", "atalho"):
        if not tecla:
            raise Recusa("Diga a tecla ou o atalho.")
        if ponto is not None:
            na_thread_da_uia(lambda: el.SetFocus())
        entrada.atalho(tecla, int(ordem.get("quantidade") or 1))
        usado = "teclado"
    elif acao == "rolar":
        entrada.rolar(ponto[0] if ponto else None, ponto[1] if ponto else None, ordem.get("direcao") or "baixo", int(ordem.get("quantidade") or 3))
    elif acao == "arrastar":
        destino, _ = _ponto_do_alvo(ordem.get("destino"))
        if destino is None:
            raise Recusa("Diga para onde arrastar (destino).")
        _trazer_para_frente(hwnd)
        entrada.arrastar(*ponto, *destino)  # type: ignore[misc]
    elif acao == "focar":
        na_thread_da_uia(lambda: el.SetFocus())
        usado = "foco"

    return {"ok": True, "acao": acao, "via": usado, "alvo": publico(desc), "ponto": list(ponto) if ponto else None}

