"""DPI por monitor (Per-Monitor V2) e a lista de monitores.

Tem de ser a PRIMEIRA coisa do processo, antes de qualquer janela ou chamada
de UIA: sem Per-Monitor V2, o Windows mente as coordenadas em escala de 125% e
150% (virtualiza para 96 dpi), e o clique sai deslocado (PRD §12.5). Com ele,
UIA, `GetWindowRect`, captura e `SendInput` falam todos em pixel físico.
"""

from __future__ import annotations

import ctypes
from ctypes import wintypes as w
from dataclasses import asdict, dataclass

from .win32 import DPI_PMV2, MONITORENUMPROC, MONITORINFOEXW, MONITORINFOF_PRIMARY, shcore, user32

_estado = {"pmv2": False, "erro": None}


def ligar_dpi_por_monitor() -> bool:
    try:
        ok = bool(user32.SetProcessDpiAwarenessContext(DPI_PMV2))
    except AttributeError:
        ok = False
    if not ok:
        # já ligado (pelo manifesto do python ou por uma chamada anterior) também conta
        try:
            ok = bool(user32.AreDpiAwarenessContextsEqual(user32.GetThreadDpiAwarenessContext(), DPI_PMV2))
        except AttributeError:
            ok = False
        if not ok:
            _estado["erro"] = f"SetProcessDpiAwarenessContext falhou ({ctypes.get_last_error()})"
    _estado["pmv2"] = ok
    return ok


def dpi_por_monitor_ligado() -> bool:
    try:
        return bool(user32.AreDpiAwarenessContextsEqual(user32.GetThreadDpiAwarenessContext(), DPI_PMV2))
    except AttributeError:
        return _estado["pmv2"]


@dataclass
class Monitor:
    indice: int
    x: int
    y: int
    largura: int
    altura: int
    dpi: int
    escala: float
    primario: bool
    nome: str

    def contem(self, px: int, py: int) -> bool:
        return self.x <= px < self.x + self.largura and self.y <= py < self.y + self.altura

    def para_dict(self) -> dict:
        return asdict(self)


def monitores() -> list[Monitor]:
    achados: list[tuple[int, MONITORINFOEXW]] = []

    def cb(hmon, _hdc, _rect, _lp):
        info = MONITORINFOEXW()
        info.cbSize = ctypes.sizeof(MONITORINFOEXW)
        if user32.GetMonitorInfoW(hmon, ctypes.byref(info)):
            achados.append((hmon, info))
        return True

    user32.EnumDisplayMonitors(None, None, MONITORENUMPROC(cb), 0)
    out: list[Monitor] = []
    # o primário primeiro, os outros da esquerda para a direita: o índice é estável entre leituras
    achados.sort(key=lambda t: (not (t[1].dwFlags & MONITORINFOF_PRIMARY), t[1].rcMonitor.left, t[1].rcMonitor.top))
    for i, (hmon, info) in enumerate(achados):
        dx, dy = w.UINT(96), w.UINT(96)
        if shcore is not None:
            shcore.GetDpiForMonitor(hmon, 0, ctypes.byref(dx), ctypes.byref(dy))
        r = info.rcMonitor
        out.append(
            Monitor(
                indice=i,
                x=r.left,
                y=r.top,
                largura=r.right - r.left,
                altura=r.bottom - r.top,
                dpi=int(dx.value),
                escala=round(dx.value / 96, 3),
                primario=bool(info.dwFlags & MONITORINFOF_PRIMARY),
                nome=info.szDevice,
            )
        )
    return out


def monitor_do_ponto(px: int, py: int) -> Monitor | None:
    for m in monitores():
        if m.contem(px, py):
            return m
    return None


def erro_do_dpi() -> str | None:
    return _estado["erro"]
