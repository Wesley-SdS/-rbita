"""O lado VISÍVEL das mãos (PRD F6, A1): bandeja, borda, atalho de parar e o gancho do mouse.

Uma thread só, com a fila de mensagens do Windows, cuida de tudo que é janela:

  - ATALHO GLOBAL (`controle.atalhoParar`, `RegisterHotKey`): para tudo do
    lado de cá PRIMEIRO (mata o terminal, corta a digitação, tira a borda) e só
    depois avisa o api. O parar não espera rede nenhuma;
  - BANDEJA: verde (ligado), laranja (no controle), vermelho (parado), com
    "Parar tudo" no menu;
  - BORDA colorida por cima de cada monitor enquanto há sessão ativa. Não pega
    clique (`WS_EX_TRANSPARENT`) e não aparece na captura
    (`WDA_EXCLUDEFROMCAPTURE`): o dono vê, o modelo não;
  - GANCHO de baixo nível de mouse e teclado, SÓ com sessão ativa (gancho
    global custa latência em toda entrada da máquina): entrada que o Windows
    não marcou como injetada (`LLMHF_INJECTED`) é o dono mexendo, e a sessão
    pausa na hora.

O callback do gancho tem de voltar em microssegundos (o Windows remove gancho
lento sem avisar, `LowLevelHooksTimeout`): ele só marca e solta uma thread.
"""

from __future__ import annotations

import ctypes
import logging
import os
import tempfile
import threading
import time
from typing import Callable

import win32api
import win32con
import win32gui

from .dpi import monitores
from .envelope import EstadoDoEspelho
from .uia import registrar_janela_propria
from .win32 import (
    HOOKPROC,
    KBDLLHOOKSTRUCT,
    LLKHF_INJECTED,
    LLKHF_LOWER_IL_INJECTED,
    LLMHF_INJECTED,
    LLMHF_LOWER_IL_INJECTED,
    MOD_ALT,
    MOD_CONTROL,
    MOD_NOREPEAT,
    MOD_SHIFT,
    MOD_WIN,
    MSLLHOOKSTRUCT,
    WDA_EXCLUDEFROMCAPTURE,
    WH_KEYBOARD_LL,
    WH_MOUSE_LL,
    kernel32,
    user32,
)

log = logging.getLogger("maos.gui")

WM_BANDEJA = win32con.WM_APP + 1
WM_ESTADO = win32con.WM_APP + 2
WM_ATALHO_NOVO = win32con.WM_APP + 3
WM_SAIR = win32con.WM_APP + 4
ID_ATALHO = 0xB17
MENU_PARAR = 1001
COR_BORDA = (255, 140, 0)
ESPESSURA = 6
MOVIMENTO_REAL_PX = 6

TECLAS_DO_ATALHO = {"esc": 0x1B, "escape": 0x1B, "pause": 0x13, "break": 0x13, "space": 0x20, "enter": 0x0D, "tab": 0x09, "backspace": 0x08, "delete": 0x2E, "insert": 0x2D, "home": 0x24, "end": 0x23}


def interpretar_atalho(texto: str) -> tuple[int, int]:
    """"Ctrl+Alt+Esc" -> (modificadores, vk). Inválido levanta ValueError."""
    partes = [p.strip().lower() for p in texto.split("+") if p.strip()]
    if len(partes) < 2:
        raise ValueError("o atalho precisa de modificador e tecla")
    modificadores = {"ctrl": MOD_CONTROL, "control": MOD_CONTROL, "alt": MOD_ALT, "shift": MOD_SHIFT, "win": MOD_WIN}
    mods = 0
    for p in partes[:-1]:
        if p not in modificadores:
            raise ValueError(f"modificador desconhecido: {p}")
        mods |= modificadores[p]
    tecla = partes[-1]
    if tecla in TECLAS_DO_ATALHO:
        vk = TECLAS_DO_ATALHO[tecla]
    elif len(tecla) >= 2 and tecla[0] == "f" and tecla[1:].isdigit() and 1 <= int(tecla[1:]) <= 24:
        vk = 0x6F + int(tecla[1:])
    elif len(tecla) == 1 and tecla.isalnum():
        vk = ord(tecla.upper())
    else:
        raise ValueError(f"tecla desconhecida: {tecla}")
    return mods, vk


def _icone(cor: tuple[int, int, int], pasta: str, nome: str) -> int:
    from PIL import Image, ImageDraw

    caminho = os.path.join(pasta, f"{nome}.ico")
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([4, 4, 60, 60], fill=cor + (255,), outline=(255, 255, 255, 255), width=4)
    d.ellipse([22, 22, 42, 42], fill=(255, 255, 255, 255))
    img.save(caminho, sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    return win32gui.LoadImage(0, caminho, win32con.IMAGE_ICON, 0, 0, win32con.LR_LOADFROMFILE | win32con.LR_DEFAULTSIZE)


class Gui:
    def __init__(self, ao_parar: Callable[[str], None], ao_pausar: Callable[[str], None]) -> None:
        self.ao_parar = ao_parar
        self.ao_pausar = ao_pausar
        self.hwnd: int | None = None
        self.thread_id: int | None = None
        self.bordas: list[int] = []
        self.atalho_texto: str | None = None
        self.atalho_ok = False
        self.atalho_erro: str | None = None
        self._estado: EstadoDoEspelho | None = None
        self._ganchos: list[int] = []
        self._procs: list[object] = []
        self._disparou = False
        self._origem_mouse: tuple[int, int] | None = None
        self._pronta = threading.Event()
        self._icones: dict[str, int] = {}
        self.ultimo_parar_ms: float | None = None
        self.erro: str | None = None

    # ── ciclo de vida ──────────────────────────────────────────────────────
    def iniciar(self, atalho: str) -> None:
        self.atalho_texto = atalho
        threading.Thread(target=self._rodar, name="maos-gui", daemon=True).start()
        self._pronta.wait(10)

    def _rodar(self) -> None:
        try:
            self.thread_id = kernel32.GetCurrentThreadId()
            pasta = tempfile.mkdtemp(prefix="orbita-maos-")
            self._icones = {"ligado": _icone((40, 160, 80), pasta, "ligado"), "controle": _icone((255, 140, 0), pasta, "controle"), "parado": _icone((210, 40, 40), pasta, "parado")}
            inst = win32api.GetModuleHandle(None)
            wc = win32gui.WNDCLASS()
            wc.hInstance = inst
            wc.lpszClassName = "OrbitaMaosMensagens"
            wc.lpfnWndProc = self._proc_principal
            win32gui.RegisterClass(wc)
            self.hwnd = win32gui.CreateWindow(wc.lpszClassName, "Órbita: mãos", 0, 0, 0, 0, 0, 0, 0, inst, None)
            registrar_janela_propria(self.hwnd)
            wb = win32gui.WNDCLASS()
            wb.hInstance = inst
            wb.lpszClassName = "OrbitaMaosBorda"
            wb.lpfnWndProc = self._proc_borda
            wb.hbrBackground = win32gui.GetStockObject(win32con.BLACK_BRUSH)
            win32gui.RegisterClass(wb)
            win32gui.Shell_NotifyIcon(win32gui.NIM_ADD, (self.hwnd, 1, win32gui.NIF_ICON | win32gui.NIF_MESSAGE | win32gui.NIF_TIP, WM_BANDEJA, self._icones["ligado"], "Órbita: mãos ligadas"))
            self._registrar_atalho()
        except Exception as e:  # noqa: BLE001 - sem bandeja, o serviço ainda serve (e o /health conta)
            self.erro = str(e)[:200]
            log.exception("gui.falhou")
        finally:
            self._pronta.set()
        win32gui.PumpMessages()

    def parar_thread(self) -> None:
        if self.hwnd:
            win32gui.PostMessage(self.hwnd, WM_SAIR, 0, 0)

    # ── atalho ─────────────────────────────────────────────────────────────
    def _registrar_atalho(self) -> None:
        user32.UnregisterHotKey(self.hwnd, ID_ATALHO)
        try:
            mods, vk = interpretar_atalho(self.atalho_texto or "Ctrl+Alt+Esc")
        except ValueError as e:
            self.atalho_ok, self.atalho_erro = False, str(e)
            return
        ok = bool(user32.RegisterHotKey(self.hwnd, ID_ATALHO, mods | MOD_NOREPEAT, vk))
        self.atalho_ok = ok
        self.atalho_erro = None if ok else f"outro programa já usa {self.atalho_texto} (erro {ctypes.get_last_error()})"

    def trocar_atalho(self, atalho: str) -> None:
        if atalho == self.atalho_texto:
            return
        self.atalho_texto = atalho
        if self.hwnd:
            win32gui.PostMessage(self.hwnd, WM_ATALHO_NOVO, 0, 0)

    # ── estado (chamado de qualquer thread) ────────────────────────────────
    def mostrar(self, estado: EstadoDoEspelho) -> None:
        self._estado = estado
        if self.hwnd:
            win32gui.PostMessage(self.hwnd, WM_ESTADO, 0, 0)

    def _aplicar_estado(self) -> None:
        e = self._estado
        ativa = bool(e and e.status == "ativa")
        parado = bool(e and e.status == "parado")
        nome = "controle" if ativa else ("parado" if parado else "ligado")
        dica = {"controle": f"Órbita no controle: {(e.envelope.objetivo if e and e.envelope else '')[:90]}", "parado": "Órbita: parada", "ligado": "Órbita: mãos ligadas"}[nome]
        try:
            win32gui.Shell_NotifyIcon(win32gui.NIM_MODIFY, (self.hwnd, 1, win32gui.NIF_ICON | win32gui.NIF_TIP, WM_BANDEJA, self._icones[nome], dica[:127]))
        except Exception:  # noqa: BLE001 - explorer reiniciando: a bandeja volta no próximo estado
            pass
        if ativa:
            self._mostrar_bordas()
            self._instalar_ganchos()
        else:
            self._tirar_bordas()
            self._tirar_ganchos()

    # ── borda ──────────────────────────────────────────────────────────────
    def _mostrar_bordas(self) -> None:
        if self.bordas:
            return
        estilo_ex = win32con.WS_EX_LAYERED | win32con.WS_EX_TRANSPARENT | win32con.WS_EX_TOPMOST | win32con.WS_EX_TOOLWINDOW | win32con.WS_EX_NOACTIVATE
        for m in monitores():
            h = win32gui.CreateWindowEx(estilo_ex, "OrbitaMaosBorda", "Órbita: borda", win32con.WS_POPUP, m.x, m.y, m.largura, m.altura, 0, 0, win32api.GetModuleHandle(None), None)
            # preto é a cor transparente: só o contorno aparece
            win32gui.SetLayeredWindowAttributes(h, 0x000000, 255, win32con.LWA_COLORKEY)
            user32.SetWindowDisplayAffinity(h, WDA_EXCLUDEFROMCAPTURE)
            win32gui.SetWindowPos(h, win32con.HWND_TOPMOST, m.x, m.y, m.largura, m.altura, win32con.SWP_NOACTIVATE | win32con.SWP_SHOWWINDOW)
            registrar_janela_propria(h)
            self.bordas.append(h)

    def _tirar_bordas(self) -> None:
        for h in self.bordas:
            try:
                win32gui.DestroyWindow(h)
            except Exception:  # noqa: BLE001
                pass
        self.bordas = []

    def _proc_borda(self, hwnd, msg, wp, lp):
        if msg == win32con.WM_PAINT:
            hdc, ps = win32gui.BeginPaint(hwnd)
            l, t, r, b = win32gui.GetClientRect(hwnd)
            preto = win32gui.CreateSolidBrush(0)
            cor = win32gui.CreateSolidBrush(win32api.RGB(*COR_BORDA))
            win32gui.FillRect(hdc, (l, t, r, b), preto)
            for ret in ((l, t, r, t + ESPESSURA), (l, b - ESPESSURA, r, b), (l, t, l + ESPESSURA, b), (r - ESPESSURA, t, r, b)):
                win32gui.FillRect(hdc, ret, cor)
            win32gui.DeleteObject(preto)
            win32gui.DeleteObject(cor)
            win32gui.EndPaint(hwnd, ps)
            return 0
        return win32gui.DefWindowProc(hwnd, msg, wp, lp)

    # ── ganchos ────────────────────────────────────────────────────────────
    def _instalar_ganchos(self) -> None:
        if self._ganchos:
            return
        self._disparou = False
        self._origem_mouse = None
        mod = kernel32.GetModuleHandleW(None)
        pm = HOOKPROC(self._gancho_mouse)
        pk = HOOKPROC(self._gancho_teclado)
        self._procs = [pm, pk]
        for tipo, proc in ((WH_MOUSE_LL, pm), (WH_KEYBOARD_LL, pk)):
            h = user32.SetWindowsHookExW(tipo, proc, mod, 0)
            if h:
                self._ganchos.append(h)
            else:
                log.warning("gui.gancho_falhou tipo=%s erro=%s", tipo, ctypes.get_last_error())

    def _tirar_ganchos(self) -> None:
        for h in self._ganchos:
            user32.UnhookWindowsHookEx(h)
        self._ganchos = []

    def _real(self, motivo: str) -> None:
        if self._disparou:
            return
        self._disparou = True
        threading.Thread(target=self.ao_pausar, args=(motivo,), daemon=True).start()

    def _gancho_mouse(self, codigo, wp, lp):
        if codigo >= 0 and not self._disparou:
            s = ctypes.cast(lp, ctypes.POINTER(MSLLHOOKSTRUCT)).contents
            if not (s.flags & (LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED)):
                if wp == win32con.WM_MOUSEMOVE:
                    if self._origem_mouse is None:
                        self._origem_mouse = (s.pt.x, s.pt.y)
                    elif abs(s.pt.x - self._origem_mouse[0]) + abs(s.pt.y - self._origem_mouse[1]) > MOVIMENTO_REAL_PX:
                        self._real("o dono mexeu no mouse")
                else:
                    self._real("o dono clicou")
        return user32.CallNextHookEx(None, codigo, wp, lp)

    def _gancho_teclado(self, codigo, wp, lp):
        if codigo >= 0 and not self._disparou and wp in (win32con.WM_KEYDOWN, win32con.WM_SYSKEYDOWN):
            s = ctypes.cast(lp, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
            if not (s.flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)):
                self._real("o dono usou o teclado")
        return user32.CallNextHookEx(None, codigo, wp, lp)

    # ── janela de mensagens ────────────────────────────────────────────────
    def _proc_principal(self, hwnd, msg, wp, lp):
        if msg == win32con.WM_HOTKEY and wp == ID_ATALHO:
            comeco = time.perf_counter()
            self.ao_parar("atalho")
            self.ultimo_parar_ms = round((time.perf_counter() - comeco) * 1000, 1)
            return 0
        if msg == WM_ESTADO:
            self._aplicar_estado()
            return 0
        if msg == WM_ATALHO_NOVO:
            self._registrar_atalho()
            return 0
        if msg == WM_BANDEJA:
            if lp in (win32con.WM_RBUTTONUP, win32con.WM_CONTEXTMENU, win32con.WM_LBUTTONUP):
                menu = win32gui.CreatePopupMenu()
                win32gui.AppendMenu(menu, win32con.MF_STRING, MENU_PARAR, f"Parar tudo ({self.atalho_texto})")
                win32gui.SetForegroundWindow(hwnd)
                x, y = win32gui.GetCursorPos()
                win32gui.TrackPopupMenu(menu, win32con.TPM_LEFTALIGN | win32con.TPM_BOTTOMALIGN, x, y, 0, hwnd, None)
                win32gui.PostMessage(hwnd, win32con.WM_NULL, 0, 0)
            return 0
        if msg == win32con.WM_COMMAND and win32api.LOWORD(wp) == MENU_PARAR:
            self.ao_parar("bandeja")
            return 0
        if msg == WM_SAIR:
            self._tirar_ganchos()
            self._tirar_bordas()
            user32.UnregisterHotKey(hwnd, ID_ATALHO)
            try:
                win32gui.Shell_NotifyIcon(win32gui.NIM_DELETE, (hwnd, 1))
            except Exception:  # noqa: BLE001
                pass
            win32gui.PostQuitMessage(0)
            return 0
        return win32gui.DefWindowProc(hwnd, msg, wp, lp)
