"""Mouse e teclado por `SendInput` (PRD A7), com corte no meio.

Toda entrada daqui sai marcada pelo Windows como INJETADA (`LLMHF_INJECTED`),
e é isso que deixa o gancho distinguir a Órbita do dono (`gui.py`). O
`dwExtraInfo` leva `MARCA_ORBITA` só para o log ter certeza de quem foi.

`Interruptor` é conferido entre UM evento e o próximo: um "parar" no meio de
um texto longo corta a digitação na tecla seguinte, não no fim do texto.
"""

from __future__ import annotations

import ctypes
import threading
import time

from .win32 import (
    INPUT,
    INPUT_KEYBOARD,
    INPUT_MOUSE,
    KEYEVENTF_EXTENDEDKEY,
    KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE,
    MARCA_ORBITA,
    MOUSEEVENTF_ABSOLUTE,
    MOUSEEVENTF_HWHEEL,
    MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MIDDLEDOWN,
    MOUSEEVENTF_MIDDLEUP,
    MOUSEEVENTF_MOVE,
    MOUSEEVENTF_RIGHTDOWN,
    MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_VIRTUALDESK,
    MOUSEEVENTF_WHEEL,
    user32,
)


class Interrompido(Exception):
    pass


class Interruptor:
    """Um por processo. `cortar()` vale para tudo que está em andamento; `rearmar()` libera de novo."""

    def __init__(self) -> None:
        self._cortado = threading.Event()
        self.ultima_injecao: float | None = None

    def cortar(self) -> None:
        self._cortado.set()

    def rearmar(self) -> None:
        self._cortado.clear()

    def cortado(self) -> bool:
        return self._cortado.is_set()

    def conferir(self) -> None:
        if self._cortado.is_set():
            raise Interrompido("parado no meio da ação")


INTERRUPTOR = Interruptor()

VK = {
    "backspace": 0x08, "tab": 0x09, "enter": 0x0D, "return": 0x0D, "shift": 0x10, "ctrl": 0x11, "control": 0x11, "alt": 0x12,
    "pause": 0x13, "capslock": 0x14, "esc": 0x1B, "escape": 0x1B, "space": 0x20, "espaco": 0x20, "pageup": 0x21, "page_up": 0x21,
    "pagedown": 0x22, "page_down": 0x22, "end": 0x23, "home": 0x24, "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
    "printscreen": 0x2C, "insert": 0x2D, "delete": 0x2E, "del": 0x2E, "win": 0x5B, "super": 0x5B, "cmd": 0x5B, "meta": 0x5B,
    "menu": 0x5D, "apps": 0x5D, "numlock": 0x90, "scrolllock": 0x91,
    "volume_mute": 0xAD, "volume_down": 0xAE, "volume_up": 0xAF, "media_next": 0xB0, "media_prev": 0xB1, "media_stop": 0xB2,
    "media_play_pause": 0xB3,
}
for i in range(1, 25):
    VK[f"f{i}"] = 0x6F + i
# teclas que exigem a flag de tecla estendida (senão o Windows as lê como as do teclado numérico)
ESTENDIDAS = {0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0x5D, 0x2C, 0x90, 0xAD, 0xAE, 0xAF, 0xB0, 0xB1, 0xB2, 0xB3}


def vk_da_tecla(nome: str) -> int:
    n = nome.strip().lower().replace(" ", "_")
    if n in VK:
        return VK[n]
    if len(n) == 1:
        r = user32.VkKeyScanW(n)
        if r == -1:
            raise ValueError(f"tecla desconhecida: {nome}")
        return r & 0xFF
    raise ValueError(f"tecla desconhecida: {nome}")


def _enviar(eventos: list[INPUT]) -> None:
    arr = (INPUT * len(eventos))(*eventos)
    n = user32.SendInput(len(eventos), arr, ctypes.sizeof(INPUT))
    INTERRUPTOR.ultima_injecao = time.time()
    if n != len(eventos):
        # a UIPI recusa em silêncio: janela elevada ou a tela de bloqueio
        raise PermissionError("O Windows recusou a entrada (janela de administrador, UAC ou tela bloqueada).")


def _tecla(vk: int, solta: bool) -> INPUT:
    i = INPUT(type=INPUT_KEYBOARD)
    i.ki.wVk = vk
    i.ki.wScan = user32.MapVirtualKeyW(vk, 0)
    i.ki.dwFlags = (KEYEVENTF_KEYUP if solta else 0) | (KEYEVENTF_EXTENDEDKEY if vk in ESTENDIDAS else 0)
    i.ki.dwExtraInfo = MARCA_ORBITA
    return i


def _unicode(ch: int, solta: bool) -> INPUT:
    i = INPUT(type=INPUT_KEYBOARD)
    i.ki.wVk = 0
    i.ki.wScan = ch
    i.ki.dwFlags = KEYEVENTF_UNICODE | (KEYEVENTF_KEYUP if solta else 0)
    i.ki.dwExtraInfo = MARCA_ORBITA
    return i


def atalho(combinacao: str, repetir: int = 1, conferir: bool = True) -> None:
    """"ctrl+shift+s", "alt+Tab", "Enter". Modificadores descem em ordem e sobem ao contrário.

    `conferir=False` é só para a mídia (PRD A5): ela age SEM sessão, e o
    interruptor fica cortado depois de todo fim de sessão até chegar um
    envelope novo. Sem isto, "pausa a música" falhava depois de qualquer parar.
    """
    partes = [p for p in combinacao.replace(" ", "").split("+") if p]
    if not partes:
        raise ValueError("atalho vazio")
    vks = [vk_da_tecla(p) for p in partes]
    for _ in range(max(1, min(repetir, 100))):
        if conferir:
            INTERRUPTOR.conferir()
        _enviar([_tecla(v, False) for v in vks] + [_tecla(v, True) for v in reversed(vks)])


def digitar(texto: str, atraso: float = 0.0, eco=None, espera_eco: float = 0.5) -> None:
    """Texto por caractere Unicode (acento e emoji sem depender do layout do teclado).

    `eco()` devolve o tamanho do texto do alvo (pela UIA), quando dá para ler. Com
    ele, cada caractere espera o app mostrar o anterior: com a CPU cheia, o app
    WinUI (o Bloco de Notas do Windows 11) lia pacotes enfileirados como o ÚLTIMO
    caractere enviado ("Teste ......" no lugar do texto, medido em 11/10/2026).
    """
    for ch in texto:
        INTERRUPTOR.conferir()
        antes = eco() if eco else None
        if ch == "\n":
            _enviar([_tecla(0x0D, False), _tecla(0x0D, True)])
        else:
            unidades = ch.encode("utf-16-le")
            codigos = [int.from_bytes(unidades[i : i + 2], "little") for i in range(0, len(unidades), 2)]
            _enviar([_unicode(c, False) for c in codigos] + [_unicode(c, True) for c in codigos])
        if antes is not None:
            fim = time.perf_counter() + espera_eco
            while time.perf_counter() < fim and not INTERRUPTOR.cortado():
                agora = eco()
                if agora is None or agora > antes:
                    break
                time.sleep(0.005)
        if atraso:
            time.sleep(atraso)


def _absoluto(x: int, y: int) -> tuple[int, int]:
    """Coordenada física -> 0..65535 sobre a área de trabalho virtual inteira (todos os monitores)."""
    vx, vy = user32.GetSystemMetrics(76), user32.GetSystemMetrics(77)
    vw, vh = max(1, user32.GetSystemMetrics(78)), max(1, user32.GetSystemMetrics(79))
    return (int(round((x - vx) * 65535 / max(1, vw - 1))), int(round((y - vy) * 65535 / max(1, vh - 1))))


def _mouse(flags: int, x: int | None = None, y: int | None = None, dados: int = 0) -> INPUT:
    i = INPUT(type=INPUT_MOUSE)
    if x is not None and y is not None:
        ax, ay = _absoluto(x, y)
        i.mi.dx, i.mi.dy = ax, ay
        flags |= MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK | MOUSEEVENTF_MOVE
    i.mi.mouseData = dados & 0xFFFFFFFF
    i.mi.dwFlags = flags
    i.mi.dwExtraInfo = MARCA_ORBITA
    return i


BOTOES = {"esquerdo": (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP), "direito": (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP), "meio": (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP)}


def clicar(x: int, y: int, botao: str = "esquerdo", vezes: int = 1, modificadores: str | None = None) -> None:
    INTERRUPTOR.conferir()
    desce, sobe = BOTOES[botao]
    mods = [vk_da_tecla(m) for m in (modificadores or "").split("+") if m.strip()]
    eventos = [_tecla(v, False) for v in mods] + [_mouse(0, x, y)]
    for _ in range(max(1, min(vezes, 3))):
        eventos += [_mouse(desce), _mouse(sobe)]
    eventos += [_tecla(v, True) for v in reversed(mods)]
    _enviar(eventos)


def arrastar(x1: int, y1: int, x2: int, y2: int, passos: int = 12) -> None:
    INTERRUPTOR.conferir()
    _enviar([_mouse(0, x1, y1), _mouse(MOUSEEVENTF_LEFTDOWN)])
    try:
        for k in range(1, passos + 1):
            INTERRUPTOR.conferir()
            _enviar([_mouse(0, x1 + (x2 - x1) * k // passos, y1 + (y2 - y1) * k // passos)])
            time.sleep(0.01)
    finally:
        # o botão nunca fica preso, nem quando o parar chega no meio do arraste
        _enviar([_mouse(MOUSEEVENTF_LEFTUP)])


def rolar(x: int | None, y: int | None, direcao: str, quantidade: int) -> None:
    INTERRUPTOR.conferir()
    q = max(1, min(int(quantidade), 50))
    eventos = [_mouse(0, x, y)] if x is not None and y is not None else []
    if direcao in ("cima", "up", "baixo", "down"):
        sinal = 1 if direcao in ("cima", "up") else -1
        eventos.append(_mouse(MOUSEEVENTF_WHEEL, dados=sinal * 120 * q))
    else:
        sinal = 1 if direcao in ("direita", "right") else -1
        eventos.append(_mouse(MOUSEEVENTF_HWHEEL, dados=sinal * 120 * q))
    _enviar(eventos)


def posicao_do_cursor() -> tuple[int, int]:
    from ctypes import wintypes as w

    p = w.POINT()
    user32.GetCursorPos(ctypes.byref(p))
    return (p.x, p.y)
