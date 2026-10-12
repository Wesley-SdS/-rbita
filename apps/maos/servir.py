"""Sobe as mãos: é o que a tarefa de logon roda (`pythonw servir.py`, sem janela de console).

Ordem que importa:
  1. DPI por monitor ANTES de qualquer janela ou UIA (senão as coordenadas mentem);
  2. sem `MAOS_TOKEN`, não sobe (PRD §5.2);
  3. elevado, não sobe (PRD §2.7): é a trava que impede clicar em janela de
     administrador e no UAC;
  4. uma instância por porta (mutex), porque a tarefa de logon e um teste à mão
     não podem disputar o mesmo atalho global;
  5. só então a bandeja, o atalho e o servidor em 127.0.0.1.

Sem console, o log vai para %LOCALAPPDATA%/Orbita/maos/maos.log.
"""

from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from maos.dpi import ligar_dpi_por_monitor  # noqa: E402

ligar_dpi_por_monitor()

from maos.config import carregar  # noqa: E402
from maos.seguranca import processo_elevado  # noqa: E402

PASTA_LOG = Path(os.environ.get("LOCALAPPDATA", ".")) / "Orbita" / "maos"


def configurar_log() -> logging.Logger:
    PASTA_LOG.mkdir(parents=True, exist_ok=True)
    h = RotatingFileHandler(PASTA_LOG / "maos.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    raiz = logging.getLogger()
    raiz.setLevel(logging.INFO)
    raiz.addHandler(h)
    if sys.stderr is not None:
        raiz.addHandler(logging.StreamHandler())
    return logging.getLogger("maos.servir")


def main() -> int:
    log = configurar_log()
    cfg = carregar()
    if not cfg.token:
        log.error("maos.recusa sem MAOS_TOKEN: rode apps/maos/scripts/instalar.ps1 (ele gera o token no .env da raiz)")
        return 2
    if processo_elevado():
        log.error("maos.recusa processo elevado: as mãos nunca rodam como administrador")
        return 3
    porta = int(os.environ.get("MAOS_PORTA_TESTE") or cfg.porta)

    import ctypes
    from ctypes import wintypes

    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW.restype = wintypes.HANDLE
    k32.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
    mutex = k32.CreateMutexW(None, False, f"Local\\OrbitaMaos-{porta}")
    if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
        log.error("maos.recusa já há mãos rodando na porta %s", porta)
        return 4

    import threading

    import uvicorn

    from main import Maos, criar_app
    from maos.gui import Gui

    maos = Maos(cfg.token, cfg.api_url)
    gui = Gui(ao_parar=lambda origem: maos.parar_local(origem, avisar_api=True), ao_pausar=maos.pausar_local)
    maos.gui = gui
    maos.espelho.ouvir(gui.mostrar)
    if os.environ.get("MAOS_SEM_BANDEJA") != "1":
        gui.iniciar(maos.atalho)

    def aquecer():
        # a primeira análise de PowerShell paga a subida do processo e o JIT do parser
        try:
            from maos.analisar import AnalisadorPowerShell
            from maos.terminal import detectar_shells

            sh = detectar_shells()
            exe = sh.get("pwsh") or sh.get("powershell")
            if exe:
                maos.analisador_ps = AnalisadorPowerShell(exe)
                maos.analisador_ps.analisar("Get-Date")
            maos.isolamento()
        except Exception:  # noqa: BLE001
            log.exception("maos.aquecer_falhou")

    threading.Thread(target=aquecer, daemon=True).start()
    log.info("maos.up porta=%s api=%s", porta, cfg.api_url)
    try:
        uvicorn.run(criar_app(maos), host="127.0.0.1", port=porta, log_config=None, access_log=False, server_header=False)
    finally:
        maos.terminal.parar_todos("as mãos foram desligadas")
        maos.pty.fechar_todas("as mãos foram desligadas")
        gui.parar_thread()
        k32.CloseHandle(mutex)
    return 0


if __name__ == "__main__":
    sys.exit(main())
