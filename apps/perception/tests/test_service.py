"""Contrato HTTP do serviço, com encoders falsos (sem modelo baixado)."""

import io
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

import main
from perception.face import Face
from perception.voice import VoiceEmbedding


def wav(segundos: float = 3.0) -> bytes:
    t = np.arange(int(16000 * segundos)) / 16000
    pcm = (0.4 * np.sin(2 * np.pi * 220 * t) * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


class VozFalsa:
    name = "falso"
    dim = 4

    def embed(self, samples):
        if len(samples) < 1600:
            raise ValueError("trecho curto demais para extrair assinatura")
        return VoiceEmbedding("falso", np.array([1.0, 0, 0, 0], dtype=np.float32), len(samples) / 16000, 1.0)


class RostoFalso:
    name = "falso"

    def detect_and_embed(self, img):
        return [Face((1.0, 2.0, 50.0, 60.0), 0.99, np.zeros((5, 2), dtype=np.float32), np.array([0, 1.0], dtype=np.float32))]


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(main, "_voice", lambda _n: VozFalsa())
    monkeypatch.setattr(main, "_face", lambda _n: RostoFalso())
    return TestClient(main.app)


def test_health_nao_depende_de_modelo(client):
    r = client.get("/health")
    assert r.status_code == 200 and "disponiveis" in r.json()


def test_embed_de_voz(client):
    r = client.post("/voice/embed", files={"file": ("a.wav", wav(), "audio/wav")})
    assert r.status_code == 200
    j = r.json()
    assert j["dim"] == 4 and j["embedding"] == [1.0, 0, 0, 0] and j["durationS"] == pytest.approx(3.0, abs=0.05)


def test_audio_ilegivel_422(client):
    r = client.post("/voice/embed", files={"file": ("a.wav", b"lixo" * 100, "audio/wav")})
    assert r.status_code == 422


def test_segmentos_de_reuniao(client):
    segs = '[{"start":0,"end":2},{"start":2.95,"end":3.0},{"x":1}]'
    r = client.post("/voice/embed-segments", files={"file": ("r.wav", wav(3), "audio/wav")}, data={"segments": segs})
    assert r.status_code == 200
    out = r.json()["segments"]
    assert "embedding" in out[0]
    assert "curto" in out[1]["erro"]
    assert out[2]["erro"] == "trecho sem start/end válidos"


def test_segmento_com_nan_nao_quebra(client):
    segs = '[{"start": "NaN", "end": 2}, {"start": 1, "end": 0.5}]'
    r = client.post("/voice/embed-segments", files={"file": ("r.wav", wav(3), "audio/wav")}, data={"segments": segs})
    assert r.status_code == 200
    assert all("erro" in s for s in r.json()["segments"])


def test_pagina_de_outra_origem_e_recusada(client):
    r = client.post("/voice/embed", files={"file": ("a.wav", wav(), "audio/wav")}, headers={"Origin": "https://site-qualquer.com"})
    assert r.status_code == 403


def test_token_exigido_quando_configurado(client, monkeypatch):
    monkeypatch.setattr(main, "TOKEN", "segredo")
    assert client.post("/voice/embed", files={"file": ("a.wav", wav(), "audio/wav")}).status_code == 401
    ok = client.post("/voice/embed", files={"file": ("a.wav", wav(), "audio/wav")}, headers={"x-orbita-percepcao": "segredo"})
    assert ok.status_code == 200
    assert client.get("/health").status_code == 200


def test_bench_tambem_exige_o_segredo(client, monkeypatch):
    """`/bench/sample` grava amostra biométrica em disco: era a única rota que
    escapava do segredo, o que é justamente o contrário do que ele serve."""
    monkeypatch.setattr(main, "TOKEN", "segredo")
    monkeypatch.setattr(main, "BENCH", True)
    dados = {"kind": "voz", "person": "w", "label": "l"}
    assert client.post("/bench/sample", files={"file": ("a", b"x")}, data=dados).status_code == 401
    assert client.get("/bench", headers={"x-orbita-percepcao": "errado"}).status_code == 401


def test_segmentos_json_invalido(client):
    r = client.post("/voice/embed-segments", files={"file": ("r.wav", wav(1), "audio/wav")}, data={"segments": "{nao"})
    assert r.status_code == 422


def test_rosto(client):
    import cv2

    ok, jpg = cv2.imencode(".jpg", np.zeros((80, 80, 3), dtype=np.uint8))
    r = client.post("/face/embed", files={"file": ("f.jpg", jpg.tobytes(), "image/jpeg")})
    assert r.status_code == 200
    f = r.json()["faces"][0]
    assert f["bbox"] == [1.0, 2.0, 50.0, 60.0] and f["size"] == 49.0


def test_imagem_ilegivel_422(client):
    r = client.post("/face/embed", files={"file": ("f.jpg", b"nada", "image/jpeg")})
    assert r.status_code == 422


def test_arquivo_grande_demais_413(client, monkeypatch):
    monkeypatch.setattr(main, "MAX_IMAGE_MB", 0.00001)
    r = client.post("/face/embed", files={"file": ("f.jpg", b"x" * 1000, "image/jpeg")})
    assert r.status_code == 413


def test_medicao_desligada_por_padrao(client):
    assert client.get("/bench").status_code == 404
    r = client.post("/bench/sample", files={"file": ("a", b"x")}, data={"kind": "voz", "person": "w", "label": "l"})
    assert r.status_code == 404


def test_modelo_desconhecido_400():
    c = TestClient(main.app)
    r = c.post("/voice/embed", files={"file": ("a.wav", wav(), "audio/wav")}, data={"model": "inexistente"})
    assert r.status_code == 400
