"""Peças comuns dos testes das mãos.

Os testes rodam no Windows de verdade (é o que as mãos controlam): Job Object,
PowerShell, captura e UIA são os reais. O que NÃO acontece aqui é entrada
injetada na tela do dono: nenhum teste clica, digita ou move o mouse. O roteiro
de ponta a ponta com o Bloco de Notas (core de verdade + estas mãos) é rodado à
mão, e o que ele mediu está em `MEDICAO.md`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

# como no servir.py: DPI por monitor antes de qualquer janela, senao as coordenadas mentem
from maos.dpi import ligar_dpi_por_monitor  # noqa: E402

ligar_dpi_por_monitor()

TOKEN = "token-de-teste-com-tamanho-suficiente"


@pytest.fixture()
def maos():
    from main import Maos

    m = Maos(TOKEN, "http://127.0.0.1:9")  # porta 9 (discard): aviso nenhum sai do teste
    yield m
    m.terminal.parar_todos("fim do teste")
    m.pty.fechar_todas("fim do teste")


@pytest.fixture()
def cliente(maos):
    from fastapi.testclient import TestClient

    from main import criar_app

    # o TestClient manda Host "testserver": as mãos só aceitam host local
    return TestClient(criar_app(maos), base_url="http://127.0.0.1")


@pytest.fixture()
def cab():
    return {"x-orbita-maos": TOKEN}
