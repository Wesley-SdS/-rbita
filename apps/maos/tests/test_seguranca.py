"""A porta das mãos (PRD A1, §2.5, §5.2): token, Origin, Host e nunca elevado."""

from __future__ import annotations

from pathlib import Path

from maos.config import carregar, ler_env
from maos.seguranca import integridade_do_processo, processo_elevado, token_confere


def test_sem_token_401(cliente):
    r = cliente.get("/health")
    assert r.status_code == 401


def test_token_errado_401(cliente):
    assert cliente.get("/health", headers={"x-orbita-maos": "outro"}).status_code == 401


def test_com_origin_403_mesmo_com_token(cliente, cab):
    # pagina web manda Origin; nenhuma origem vale, nem a da propria Orbita
    for origem in ("http://localhost:3000", "https://evil.example", "null", "chrome-extension://abc"):
        r = cliente.get("/health", headers={**cab, "origin": origem})
        assert r.status_code == 403, origem


def test_host_de_fora_403(cliente, cab):
    # DNS rebinding: um dominio que resolve para 127.0.0.1 chega com outro Host
    r = cliente.get("/health", headers={**cab, "host": "orbita.evil.example"})
    assert r.status_code == 403


def test_sem_cors(cliente, cab):
    r = cliente.options("/health", headers={**cab, "access-control-request-method": "GET"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


def test_health_com_token(cliente, cab):
    r = cliente.get("/health", headers=cab)
    assert r.status_code == 200
    j = r.json()
    assert j["status"] == "ok"
    assert j["elevado"] is False
    assert j["integridade"] in ("media", "media_mais")
    assert isinstance(j["monitores"], list) and j["monitores"]
    assert j["espelho"]["status"] == "livre"


def test_token_confere_em_tempo_constante():
    assert token_confere("abc", "abc")
    assert not token_confere("abd", "abc")
    assert not token_confere(None, "abc")
    assert not token_confere("abc", "")


def test_este_processo_nao_esta_elevado():
    # a trava do PRD 2.7: os testes (e as maos) rodam sem administrador
    assert processo_elevado() is False
    assert integridade_do_processo() == "media"


def test_config_sem_token_fica_vazio(tmp_path: Path):
    cfg = carregar(env={}, arquivo={})
    assert cfg.token == ""
    assert cfg.porta == 8003


def test_env_da_raiz_so_le_as_chaves_das_maos(tmp_path: Path):
    env = tmp_path / ".env"
    env.write_text('MAOS_TOKEN="abc123"\nBETTER_AUTH_SECRET=segredo\nexport MAOS_PORTA=8100\nCONNECTORS_ENC_KEY=outro\n', encoding="utf-8")
    lido = ler_env(env)
    assert lido == {"MAOS_TOKEN": "abc123", "MAOS_PORTA": "8100"}
    cfg = carregar(env={}, arquivo=lido)
    assert cfg.token == "abc123" and cfg.porta == 8100
