"""ÓRBITA — serviço de percepção local (Fase 2, Ondas 9 a 11).

STATELESS (PRD §6): recebe áudio ou imagem, devolve vetores e confiança. Não
guarda identidade, amostra nem vetor. Quem é quem mora no apps/api.

Só escuta em 127.0.0.1 e não chama a internet em runtime (modelos são baixados
à parte por scripts/download_models.py). O apps/api marca as chamadas com o
cabeçalho `x-orbita-biometria`, e o guard dele recusa mandar isso para fora.

    set PERCEPTION_VOICE_MODEL=wespeaker_resnet34
    set PERCEPTION_FACE_BACKEND=opencv
    .venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8002
"""

from __future__ import annotations

import json
import math
import os
import threading
import time
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from perception.audio import decode_to_mono16k, slice_seconds, speech_seconds
from perception.face import FACE_MODELS, FaceEncoder, decode_image
from perception.gesture import GESTOS, GestureDetector
from perception.voice import VOICE_MODELS, VoiceEncoder

BASE = Path(__file__).resolve().parent
MODELS_DIR = Path(os.environ.get("PERCEPTION_MODELS_DIR", BASE / "models"))
# alinhado ao teto do STT no apps/api (limits.sttMaxMb vai até 1024)
MAX_AUDIO_MB = float(os.environ.get("PERCEPTION_MAX_AUDIO_MB", "1024"))
# duração máxima DECODIFICADA (4 h): o limite em MB não segura áudio muito comprimido
MAX_AUDIO_SECONDS = float(os.environ.get("PERCEPTION_MAX_AUDIO_SECONDS", "14400"))
TOKEN = os.environ.get("PERCEPTION_TOKEN")
MAX_IMAGE_MB = float(os.environ.get("PERCEPTION_MAX_IMAGE_MB", "8"))

app = FastAPI(title="ÓRBITA Percepção")


@app.middleware("http")
async def so_de_casa(request: Request, call_next):
    """Qualquer página aberta no navegador da casa consegue fazer POST para
    127.0.0.1:8002. Navegador sempre manda `Origin` em POST de outra origem:
    recusa. O apps/api (Node) não manda Origin; com PERCEPTION_TOKEN definido,
    exige também o segredo compartilhado."""
    origem = request.headers.get("origin")
    propria = {f"http://{request.url.netloc}", "http://127.0.0.1:8002", "http://localhost:8002"}
    if origem and origem not in propria:
        return JSONResponse({"detail": "origem não permitida"}, status_code=403)
    if TOKEN and request.url.path not in ("/health", "/bench") and not request.url.path.startswith("/bench"):
        if request.headers.get("x-orbita-percepcao") != TOKEN:
            return JSONResponse({"detail": "não autorizado"}, status_code=401)
    return await call_next(request)

_encoders: dict[str, object] = {}
_lock = threading.Lock()


def _voice(name: str | None) -> VoiceEncoder:
    # default = o escolhido na medição de 17/09 (a chave identity.voiceModel manda o nome em cada chamada)
    nome = name or os.environ.get("PERCEPTION_VOICE_MODEL", "wespeaker_resnet34")
    if nome not in VOICE_MODELS:
        raise HTTPException(400, f"modelo de voz desconhecido: {nome}")
    chave = f"voz:{nome}"
    with _lock:
        if chave not in _encoders:
            try:
                _encoders[chave] = VoiceEncoder(MODELS_DIR, nome)
            except FileNotFoundError as e:
                raise HTTPException(503, str(e)) from e
        return _encoders[chave]  # type: ignore[return-value]


_gesto_lock = threading.Lock()


def _gestos() -> GestureDetector:
    # lock PRÓPRIO: carregar o MediaPipe leva segundos e não pode segurar
    # /voice/embed nem /face/embed, que usam o lock geral
    with _gesto_lock:
        if "gesto" not in _encoders:
            try:
                _encoders["gesto"] = GestureDetector()
            except Exception as e:  # noqa: BLE001 - mediapipe ausente ou quebrado
                raise HTTPException(503, f"reconhecimento de gestos indisponível: {e}") from e
        return _encoders["gesto"]  # type: ignore[return-value]


def _face(name: str | None) -> FaceEncoder:
    nome = name or os.environ.get("PERCEPTION_FACE_BACKEND", "insightface_s")
    if nome not in FACE_MODELS:
        raise HTTPException(400, f"backend de rosto desconhecido: {nome}")
    chave = f"rosto:{nome}"
    with _lock:
        if chave not in _encoders:
            try:
                _encoders[chave] = FaceEncoder(MODELS_DIR, nome)
            except FileNotFoundError as e:
                raise HTTPException(503, str(e)) from e
        return _encoders[chave]  # type: ignore[return-value]


def _ler(file: UploadFile, max_mb: float) -> bytes:
    """Lê no máximo o teto + 1 byte: arquivo grande é recusado sem ir inteiro para a memória."""
    teto = int(max_mb * 1024 * 1024)
    data = file.file.read(teto + 1)
    if len(data) > teto:
        raise HTTPException(413, f"arquivo maior que {max_mb:g} MB")
    return data


@app.get("/health")
def health() -> dict:
    disponiveis = {
        "voz": [n for n, f in VOICE_MODELS.items() if (MODELS_DIR / "voice" / f).exists()],
        "rosto": [n for n, fs in FACE_MODELS.items() if all((MODELS_DIR / "face" / f).exists() for f in fs.values())],
        "gestos": list(GESTOS),
    }
    return {"status": "ok", "disponiveis": disponiveis, "carregados": sorted(_encoders)}


@app.post("/voice/embed")
def voice_embed(file: UploadFile = File(...), model: str | None = Form(None)) -> dict:
    data = _ler(file, MAX_AUDIO_MB)
    try:
        samples = decode_to_mono16k(data, MAX_AUDIO_SECONDS)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    enc = _voice(model)
    t = time.perf_counter()
    try:
        r = enc.embed(samples)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return {
        "model": r.model,
        "dim": len(r.embedding),
        "embedding": r.embedding.tolist(),
        "durationS": round(r.duration_s, 3),
        "speechS": round(r.speech_s, 3),
        "ms": round((time.perf_counter() - t) * 1000, 1),
    }


@app.post("/voice/embed-segments")
def voice_embed_segments(file: UploadFile = File(...), segments: str = Form(...), model: str | None = Form(None)) -> dict:
    """Uma assinatura por fala diarizada de uma reunião: o áudio vem INTEIRO (a
    diarização foi feita sobre ele) e os trechos dizem onde cada fala está."""
    data = _ler(file, MAX_AUDIO_MB)
    try:
        trechos = json.loads(segments)
    except ValueError as e:
        raise HTTPException(422, f"segments não é JSON: {e}") from e
    if not isinstance(trechos, list) or len(trechos) > 5000:
        raise HTTPException(422, "segments deve ser uma lista de até 5000 trechos")
    validos: list[tuple[float, float] | None] = []
    for t in trechos:
        try:
            ini, fim = float(t["start"]), float(t["end"])
            validos.append((ini, fim) if math.isfinite(ini) and math.isfinite(fim) and 0 <= ini < fim else None)
        except (KeyError, TypeError, ValueError):
            validos.append(None)
    # só decodifica até o fim do último trecho pedido
    fim_max = max((v[1] for v in validos if v), default=0.0)
    try:
        samples = decode_to_mono16k(data, min(MAX_AUDIO_SECONDS, fim_max + 1))
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    enc = _voice(model)
    out = []
    for v in validos:
        if v is None:
            out.append({"erro": "trecho sem start/end válidos"})
            continue
        ini, fim = v
        pedaco = slice_seconds(samples, ini, fim)
        item: dict = {"start": ini, "end": fim, "speechS": round(speech_seconds(pedaco), 3)}
        try:
            item["embedding"] = enc.embed(pedaco).embedding.tolist()
        except ValueError as e:
            item["erro"] = str(e)
        out.append(item)
    return {"model": enc.name, "dim": enc.dim, "segments": out}


@app.post("/face/embed")
def face_embed(file: UploadFile = File(...), backend: str | None = Form(None)) -> dict:
    data = _ler(file, MAX_IMAGE_MB)
    try:
        img = decode_image(data)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    enc = _face(backend)
    t = time.perf_counter()
    faces = enc.detect_and_embed(img)
    return {
        "backend": enc.name,
        "width": int(img.shape[1]),
        "height": int(img.shape[0]),
        "ms": round((time.perf_counter() - t) * 1000, 1),
        "faces": [
            {"bbox": [round(v, 1) for v in f.bbox], "score": round(f.score, 4), "size": round(f.size, 1), "landmarks": f.landmarks.round(1).tolist(), "embedding": f.embedding.tolist()}
            for f in faces
        ],
    }


@app.post("/pose/gesture")
def pose_gesture(file: UploadFile = File(...)) -> dict:
    """Gestos num keyframe (CAM.4). Devolve o NOME do gesto; o que ele faz é
    decisão da regra que o dono cadastrou, e pode ser diferente por pessoa."""
    data = _ler(file, MAX_IMAGE_MB)
    try:
        img = decode_image(data)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    t = time.perf_counter()
    gestos = _gestos().detect(img)
    return {
        "ms": round((time.perf_counter() - t) * 1000, 1),
        "vocabulario": list(GESTOS),
        "gestos": [{"gesto": g.gesture, "confianca": g.confidence, "mao": g.hand} for g in gestos],
    }


# ── medição (só com PERCEPTION_BENCH=1) ─────────────────────────────────────
# Grava amostras LOCAIS em bench_data/ (gitignored) para escolher modelo e
# limiar com a voz e o rosto reais do dono. Desligado por padrão: fora da
# medição, este processo não escreve nada em disco.

BENCH = os.environ.get("PERCEPTION_BENCH") == "1"
BENCH_DIR = BASE / "bench_data"


@app.get("/bench")
def bench_page():
    if not BENCH:
        raise HTTPException(404, "medição desligada (PERCEPTION_BENCH=1)")
    return FileResponse(BASE / "bench" / "bench.html")


@app.post("/bench/sample")
def bench_sample(file: UploadFile = File(...), kind: str = Form(...), person: str = Form(...), label: str = Form(...)) -> dict:
    if not BENCH:
        raise HTTPException(404, "medição desligada (PERCEPTION_BENCH=1)")
    if kind not in ("voz", "rosto"):
        raise HTTPException(400, "kind inválido")
    seguro = lambda s: "".join(c for c in s.lower() if c.isalnum() or c in "-_")[:40]  # noqa: E731
    p, l = seguro(person), seguro(label)
    if not p or not l:
        raise HTTPException(400, "pessoa e rótulo obrigatórios")
    data = _ler(file, MAX_AUDIO_MB if kind == "voz" else MAX_IMAGE_MB)
    ext = ".webm" if kind == "voz" else ".jpg"
    destino = BENCH_DIR / kind / p / f"{l}{ext}"
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(data)
    return {"ok": True, "bytes": len(data)}
