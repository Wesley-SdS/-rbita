"""Captura (PRD A6): o app oculto sai PRETO, ja nas maos, e a escala leva o ponto de volta ao pixel fisico.

Abre uma janela de verdade (de um segundo, no canto da tela) com um titulo
proprio e pede a captura com esse titulo na lista de ocultos.
"""

from __future__ import annotations

import base64
import io
import threading
import time

import numpy as np
import pytest
import win32con
import win32gui
from PIL import Image

from maos.captura import CAPTURADOR
from maos.dpi import monitores

TITULO = "OrbitaTesteCofre"


@pytest.fixture()
def janela():
    m = next((x for x in monitores() if x.primario), None)
    if not m:
        pytest.skip("sem monitor")
    x, y, lw, lh = m.x + 120, m.y + 120, 360, 240
    # a janela vive numa thread com fila de mensagens propria, como a de um app
    # de verdade: ler o titulo dela manda WM_GETTEXT, e a thread do teste esta
    # esperando a UIA (na mesma thread, seria um impasse que nao existe em producao)
    pronta, sair, caixa = threading.Event(), threading.Event(), {}

    def rodar():
        h = win32gui.CreateWindowEx(
            win32con.WS_EX_TOPMOST | win32con.WS_EX_TOOLWINDOW | win32con.WS_EX_NOACTIVATE,
            "STATIC", TITULO, win32con.WS_POPUP | win32con.WS_VISIBLE | win32con.WS_BORDER, x, y, lw, lh, 0, 0, 0, None,
        )
        win32gui.UpdateWindow(h)
        caixa["h"] = h
        pronta.set()
        while not sair.is_set():
            win32gui.PumpWaitingMessages()
            time.sleep(0.02)
        win32gui.DestroyWindow(h)

    t = threading.Thread(target=rodar, daemon=True)
    t.start()
    pronta.wait(5)
    time.sleep(0.3)
    yield caixa["h"], (x, y, x + lw, y + lh), m
    sair.set()
    t.join(5)


def _imagem(cap: dict) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(base64.b64decode(cap["base64"]))).convert("RGB"))


def _regiao(cap: dict, ret, m) -> np.ndarray:
    img = _imagem(cap)
    e = cap["escala"]
    l, t, r, b = ret
    # um pouco para dentro: a borda da janela e o reescalonamento borram o contorno
    x0, y0 = int((l - m.x) * e) + 6, int((t - m.y) * e) + 6
    x1, y1 = int((r - m.x) * e) - 6, int((b - m.y) * e) - 6
    return img[y0:y1, x0:x1]


def test_janela_de_app_oculto_sai_preta(janela):
    h, ret, m = janela
    # controle: sem a lista, a janela (cinza claro do STATIC) aparece
    normal = CAPTURADOR.capturar([], (m.largura, m.altura), m.indice, None, "png")
    assert _regiao(normal, ret, m).mean() > 60
    oculta = CAPTURADOR.capturar([TITULO], (m.largura, m.altura), m.indice, None, "png")
    assert oculta["ocultas_pintadas"] >= 1
    assert _regiao(oculta, ret, m).max() == 0, "o app oculto vazou na captura"


def test_miniatura_tambem_sai_preta(janela):
    h, ret, m = janela
    cap = CAPTURADOR.capturar([TITULO], (1280, 720), m.indice, None, "png")
    mini = np.asarray(Image.open(io.BytesIO(base64.b64decode(cap["miniatura"].split(",", 1)[1]))).convert("RGB"))
    esc = mini.shape[1] / m.largura
    l, t, r, b = ret
    trecho = mini[int((t - m.y) * esc) + 3 : int((b - m.y) * esc) - 3, int((l - m.x) * esc) + 3 : int((r - m.x) * esc) - 3]
    assert trecho.size and trecho.mean() < 25


def test_janela_oculta_nao_tem_arvore_nem_titulo(janela):
    from maos.uia import ler_janela, listar_janelas

    h, _ret, _m = janela
    # STATIC com WS_EX_TOOLWINDOW nao entra na lista de janelas de app; a leitura direta e recusada
    with pytest.raises(PermissionError):
        ler_janela(h, 50, [TITULO])
    assert all(TITULO not in j["titulo"] for j in listar_janelas([TITULO]))


def test_escala_leva_o_ponto_ao_pixel_fisico():
    m = next(x for x in monitores() if x.primario)
    cap = CAPTURADOR.capturar([], (1280, 720), m.indice, None, "jpeg")
    e = cap["escala"]
    assert cap["largura"] <= 1280 and cap["altura"] <= 720
    px, py = CAPTURADOR.para_fisico(cap["captura"], 640, 360)
    assert abs(px - (m.x + 640 / e)) <= 1 and abs(py - (m.y + 360 / e)) <= 1
    with pytest.raises(ValueError):
        CAPTURADOR.para_fisico(cap["captura"], 99999, 1)
    with pytest.raises(LookupError):
        CAPTURADOR.para_fisico("naoexiste", 1, 1)


def test_rota_capturar_pede_token(cliente, cab):
    assert cliente.post("/computador/capturar", json={}).status_code == 401
    r = cliente.post("/computador/capturar", json={"formato": "jpeg"}, headers=cab)
    assert r.status_code == 200 and r.json()["mediaType"] == "image/jpeg"


def test_zoom_amplia_um_trecho_e_o_ponto_volta_ao_fisico(cliente, cab):
    base = cliente.post("/computador/capturar", json={"formato": "jpeg"}, headers=cab).json()
    r = cliente.post("/computador/capturar", json={"formato": "jpeg", "regiao": {"captura": base["captura"], "x0": 100, "y0": 100, "x1": 420, "y1": 280}}, headers=cab)
    assert r.status_code == 200, r.text
    z = r.json()
    assert z["escala"] > base["escala"]
    # o canto do zoom e o mesmo pixel fisico do ponto (100, 100) da captura base
    canto = CAPTURADOR.para_fisico(z["captura"], 0, 0)
    esperado = CAPTURADOR.para_fisico(base["captura"], 100, 100)
    assert abs(canto[0] - esperado[0]) <= 2 and abs(canto[1] - esperado[1]) <= 2


def test_no_ponto_por_marca_e_focado(cliente, cab):
    cap = cliente.post("/computador/capturar", json={"formato": "jpeg", "marcas": "grade"}, headers=cab).json()
    r = cliente.post("/computador/no-ponto", json={"captura": cap["captura"], "marca": 1}, headers=cab)
    assert r.status_code == 200 and "papel" in r.json()
    f = cliente.post("/computador/focado", json={}, headers=cab)
    assert f.status_code in (200, 404)
    assert cliente.get("/apps/nomes", params={"nome": "Bloco de Notas"}, headers=cab).json()["nomes"].__contains__("notepad")


def test_cursor_volta_no_espaco_da_imagem(cliente, cab):
    base = cliente.post("/computador/capturar", json={"formato": "jpeg"}, headers=cab).json()
    r = cliente.post("/computador/cursor", json={"captura": base["captura"]}, headers=cab)
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["captura"] == base["captura"] and isinstance(c["x"], int) and isinstance(c["dentro_da_imagem"], bool)
    # ida e volta: o ponto da imagem leva ao fisico e o fisico traz o mesmo ponto
    if c["dentro_da_imagem"]:
        fis = CAPTURADOR.para_fisico(base["captura"], c["x"], c["y"])
        assert CAPTURADOR.para_imagem(base["captura"], *fis) == (c["x"], c["y"])
    assert cliente.post("/computador/cursor", json={"captura": "naoexiste"}, headers=cab).status_code == 404


def test_app_uwp_hospedado_vira_o_app_de_verdade():
    from maos.uia import pid_do_app_uwp

    # a janela é do ApplicationFrameHost (pid 10) e a CoreWindow filha é da Calculadora (pid 77)
    assert pid_do_app_uwp(10, "ApplicationFrameHost.exe", [77]) == 77
    # filha do próprio hospedeiro, sem filha, ou janela que não é do hospedeiro: nada muda
    assert pid_do_app_uwp(10, "ApplicationFrameHost.exe", [10]) == 10
    assert pid_do_app_uwp(10, "ApplicationFrameHost.exe", []) == 10
    assert pid_do_app_uwp(10, "notepad.exe", [77]) == 10
    assert pid_do_app_uwp(10, "", [77]) == 10
