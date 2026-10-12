"""Arquivos do lado do Windows (PRD A4, C4): raizes, `..`, link para fora, salvar sem sobrescrever e nunca abrir executavel."""

from __future__ import annotations

import _winapi
import os
from pathlib import Path

import pytest

from maos import arquivos as arq


@pytest.fixture()
def raiz(tmp_path: Path) -> Path:
    r = tmp_path / "liberada"
    r.mkdir()
    (r / "doc.txt").write_text("oi", encoding="utf-8")
    return r


def test_dentro_da_raiz_ok(raiz: Path):
    assert arq.dentro_das_raizes(str(raiz / "doc.txt"), [str(raiz)]) == (raiz / "doc.txt").resolve()


def test_a_raiz_inteira_nao(raiz: Path):
    with pytest.raises(PermissionError):
        arq.dentro_das_raizes(str(raiz), [str(raiz)])


def test_dois_pontos_nao_escapam(raiz: Path, tmp_path: Path):
    (tmp_path / "fora.txt").write_text("x", encoding="utf-8")
    with pytest.raises(PermissionError):
        arq.dentro_das_raizes(str(raiz / ".." / "fora.txt"), [str(raiz)])


def test_juncao_que_aponta_para_fora_e_recusada(raiz: Path, tmp_path: Path):
    fora = tmp_path / "segredo"
    fora.mkdir()
    (fora / "chave.txt").write_text("x", encoding="utf-8")
    # juncao (mklink /J) nao precisa de administrador, ao contrario do link simbolico
    _winapi.CreateJunction(str(fora), str(raiz / "atalho"))
    with pytest.raises(PermissionError):
        arq.dentro_das_raizes(str(raiz / "atalho" / "chave.txt"), [str(raiz)])
    with pytest.raises(PermissionError):
        arq.para_lixeira(str(raiz / "atalho" / "chave.txt"), [str(raiz)])
    assert (fora / "chave.txt").exists()


def test_salvar_nunca_sobrescreve_e_marca_da_web(tmp_path: Path):
    destino = tmp_path / "Downloads" / "Órbita"
    a = arq.salvar(str(destino), "fatura.pdf", b"%PDF-1.4 a")
    b = arq.salvar(str(destino), "fatura.pdf", b"%PDF-1.4 b")
    assert Path(a["caminho"]).name == "fatura.pdf"
    assert Path(b["caminho"]).name == "fatura (2).pdf"
    assert Path(a["caminho"]).read_bytes() == b"%PDF-1.4 a"
    assert open(a["caminho"] + ":Zone.Identifier", encoding="ascii").read().strip().endswith("ZoneId=3")
    assert a["executavel"] is False


def test_salvar_nome_perigoso_vira_nome_seguro(tmp_path: Path):
    r = arq.salvar(str(tmp_path), "..\\..\\CON.txt", b"x")
    assert Path(r["caminho"]).parent == tmp_path
    assert Path(r["caminho"]).name.startswith("_") or "CON" not in Path(r["caminho"]).name.split(".")[0].upper()


def test_executavel_pelo_nome_e_pelos_bytes():
    assert arq.eh_executavel("setup.exe", b"")
    assert arq.eh_executavel("fatura.pdf", b"MZ\x90\x00")
    assert arq.eh_executavel("script.ps1", b"Write-Host")
    assert not arq.eh_executavel("fatura.pdf", b"%PDF-1.7")


def test_extensoes_que_faltavam_nunca_abrem():
    # M11 da auditoria: Office com macro, consulta web e SYLK do Excel, scriptlets, diagnóstico e instalador de app
    for nome in ("p.xlsb", "m.dotm", "m.xltm", "s.xlam", "s.ppam", "m.potm", "show.ppsm", "c.iqy", "d.slk", "x.sct", "x.wsc", "d.diagcab", "app.appinstaller", "MAIUSCULO.XLSB"):
        assert arq.eh_executavel(nome, b""), nome
    # controle: os sem macro continuam abrindo
    for nome in ("planilha.xlsx", "texto.docx", "slides.pptx", "nota.txt", "foto.jpg"):
        assert not arq.eh_executavel(nome, b"PK\x03\x04"), nome


def test_doc_e_xls_antigos_com_macro_pelos_bytes():
    ole = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 500
    com_macro_word = ole + "Macros".encode("utf-16-le") + b"\x00" * 100
    com_macro_excel = ole + "_VBA_PROJECT_CUR".encode("utf-16-le") + b"\x00" * 100
    assert arq.eh_executavel("contrato.doc", com_macro_word)
    assert arq.eh_executavel("planilha.xls", com_macro_excel)
    # controle: o DOC sem macro abre
    assert not arq.eh_executavel("contrato.doc", ole + "WordDocument".encode("utf-16-le"))


def test_abrir_doc_com_macro_e_recusado(raiz: Path, monkeypatch):
    abertos: list[str] = []
    monkeypatch.setattr(arq.os, "startfile", lambda c: abertos.append(c), raising=False)
    # o fluxo de macro mora LONGE do começo (no diretório do OLE): a leitura de 64 bytes não o via
    doc = raiz / "contrato.doc"
    doc.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 20000 + "Macros".encode("utf-16-le"))
    with pytest.raises(PermissionError):
        arq.abrir_arquivo(str(doc), [str(raiz)])
    assert abertos == []
    limpo = raiz / "limpo.doc"
    limpo.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 20000 + "WordDocument".encode("utf-16-le"))
    arq.abrir_arquivo(str(limpo), [str(raiz)])
    assert abertos == [str(limpo.resolve())]


def test_abrir_executavel_disfarcado_e_recusado(raiz: Path, monkeypatch):
    abertos = []
    monkeypatch.setattr(os, "startfile", lambda p: abertos.append(p), raising=False)
    (raiz / "fatura.pdf").write_bytes(b"MZ\x90\x00 isto e um exe")
    with pytest.raises(PermissionError):
        arq.abrir_arquivo(str(raiz / "fatura.pdf"), [str(raiz)])
    (raiz / "boa.pdf").write_bytes(b"%PDF-1.7")
    arq.abrir_arquivo(str(raiz / "boa.pdf"), [str(raiz)])
    assert abertos == [str((raiz / "boa.pdf").resolve())]


def test_abrir_url_so_http(monkeypatch):
    monkeypatch.setattr(os, "startfile", lambda p: None, raising=False)
    with pytest.raises(PermissionError):
        arq.abrir_url("file:///C:/Windows/System32/calc.exe")
    with pytest.raises(PermissionError):
        arq.abrir_url("javascript:alert(1)")
    assert arq.abrir_url("https://example.com/x")["ok"]


def test_rota_salvar_e_lixeira_fora_da_raiz(cliente, cab, tmp_path: Path, raiz: Path):
    import base64

    r = cliente.post("/arquivos/salvar", json={"pasta": str(tmp_path / "anexos"), "nome": "a.txt", "base64": base64.b64encode(b"oi").decode()}, headers=cab)
    assert r.status_code == 200 and Path(r.json()["caminho"]).read_bytes() == b"oi"
    r = cliente.post("/arquivos/lixeira", json={"caminho": str(tmp_path / "anexos" / "a.txt"), "raizes": [str(raiz)]}, headers=cab)
    assert r.status_code == 409


@pytest.mark.skipif(os.environ.get("MAOS_TESTE_LIXEIRA") != "1", reason="manda um arquivo de verdade para a Lixeira do dono; rode com MAOS_TESTE_LIXEIRA=1")
def test_lixeira_de_verdade(raiz: Path):
    alvo = raiz / "orbita-teste-lixeira.txt"
    alvo.write_text("arquivo de teste das maos da Orbita; pode apagar", encoding="utf-8")
    r = arq.para_lixeira(str(alvo), [str(raiz)])
    assert r["ok"] and not alvo.exists()
    # esta na Lixeira: a pasta virtual 10 (CSIDL_BITBUCKET) lista o nome
    from win32com.client import Dispatch

    lixeira = Dispatch("Shell.Application").NameSpace(10)
    nomes = [lixeira.GetDetailsOf(i, 0) for i in lixeira.Items()]
    assert any("orbita-teste-lixeira" in n for n in nomes)
