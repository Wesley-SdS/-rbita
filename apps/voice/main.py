"""ÓRBITA — serviço de voz local.

- STT: faster-whisper (pt-BR).
- TTS: Piper (local, pt-BR, licença MIT — humanizado e leve, roda em CPU).
- Wake word: openWakeWord via WebSocket (modelo pré-treinado "hey jarvis";
  treinar "Ei Órbita" é opcional — ver README).
"""
import io
import os
import tempfile
import urllib.request
import wave

from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="ÓRBITA Voice")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODELS_DIR = os.environ.get("VOICE_MODELS_DIR", "/models")
os.makedirs(MODELS_DIR, exist_ok=True)


# ══════════════════════════════ STT ══════════════════════════════
_whisper = None


def get_whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel

        size = os.environ.get("WHISPER_MODEL", "base")
        _whisper = WhisperModel(size, device="cpu", compute_type="int8")
    return _whisper


# ══════════════════════════════ TTS ══════════════════════════════
# Piper: modelo pt-BR baixado sob demanda (~60 MB) do repositório oficial.
_piper = None
PIPER_VOICE = os.environ.get("PIPER_VOICE", "pt_BR-faber-medium")
_PIPER_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium"
_PIPER_FILES = {
    f"{PIPER_VOICE}.onnx": f"{_PIPER_BASE}/pt_BR-faber-medium.onnx",
    f"{PIPER_VOICE}.onnx.json": f"{_PIPER_BASE}/pt_BR-faber-medium.onnx.json",
}


def _ensure_piper_model() -> str:
    onnx_path = os.path.join(MODELS_DIR, f"{PIPER_VOICE}.onnx")
    for fname, url in _PIPER_FILES.items():
        dest = os.path.join(MODELS_DIR, fname)
        if not os.path.exists(dest) or os.path.getsize(dest) == 0:
            urllib.request.urlretrieve(url, dest)
    return onnx_path


def get_piper():
    global _piper
    if _piper is None:
        from piper import PiperVoice

        model_path = _ensure_piper_model()
        _piper = PiperVoice.load(model_path)
    return _piper


class TTSRequest(BaseModel):
    text: str
    # velocidade: 1.0 normal; >1 mais lento (length_scale do Piper)
    length_scale: float | None = None


def _synthesize_wav(text: str, length_scale: float | None) -> bytes:
    voice = get_piper()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        try:
            from piper import SynthesisConfig

            cfg = SynthesisConfig(length_scale=length_scale) if length_scale else None
            voice.synthesize_wav(text, wav, syn_config=cfg)
        except (ImportError, TypeError, AttributeError):
            # compat com a API antiga do Piper
            voice.synthesize(text, wav)
    return buf.getvalue()


# ══════════════════════════ Wake word ══════════════════════════
_oww = None
WAKE_MODEL = os.environ.get("WAKE_MODEL", "hey_jarvis")
WAKE_THRESHOLD = float(os.environ.get("WAKE_THRESHOLD", "0.5"))


def get_oww():
    global _oww
    if _oww is None:
        from openwakeword.model import Model
        import openwakeword.utils

        # baixa os modelos base (melspectrogram + embedding) e os pré-treinados
        openwakeword.utils.download_models()
        _oww = Model(wakeword_models=[WAKE_MODEL], inference_framework="onnx")
    return _oww


# ══════════════════════════ Endpoints ══════════════════════════
@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "stt": _whisper is not None,
        "tts": _piper is not None,
        "wake": _oww is not None,
        "wake_model": WAKE_MODEL,
        "tts_voice": PIPER_VOICE,
    }


@app.post("/stt")
async def stt(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    suffix = os.path.splitext(file.filename or "")[1] or ".wav"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(data)
        tmp.close()
        segments, info = get_whisper().transcribe(tmp.name, language="pt", vad_filter=True)
        text = " ".join(s.text for s in segments).strip()
        return {"text": text, "language": info.language, "duration": info.duration}
    finally:
        os.unlink(tmp.name)


@app.post("/tts")
async def tts(req: TTSRequest) -> Response:
    text = (req.text or "").strip()
    if not text:
        return Response(content=b"", status_code=400)
    audio = _synthesize_wav(text[:2000], req.length_scale)
    return Response(content=audio, media_type="audio/wav")


@app.websocket("/ws/wake")
async def ws_wake(ws: WebSocket):
    """Detecção de wake word em streaming.

    O cliente envia frames PCM int16 mono 16 kHz (idealmente 1280 amostras/80 ms).
    O servidor responde JSON {score, detected} por frame; após uma detecção,
    zera o estado interno para evitar disparos repetidos.
    """
    await ws.accept()
    import numpy as np

    try:
        model = get_oww()
    except Exception as e:  # dependência/modelo indisponível
        await ws.send_json({"error": f"wake word indisponível: {e}"})
        await ws.close()
        return

    try:
        while True:
            chunk = await ws.receive_bytes()
            audio = np.frombuffer(chunk, dtype=np.int16)
            if audio.size == 0:
                continue
            scores = model.predict(audio)
            score = float(scores.get(WAKE_MODEL, 0.0))
            detected = score >= WAKE_THRESHOLD
            await ws.send_json({"score": score, "detected": detected})
            if detected:
                model.reset()
    except WebSocketDisconnect:
        return
    except Exception:
        await ws.close()
