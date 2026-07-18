"""ÓRBITA — serviço de voz local.

- STT: faster-whisper (pt-BR).
- TTS: Piper (local, pt-BR, licença MIT — humanizado e leve, roda em CPU).
- Wake word "Ei Órbita" / "Órbita": Vosk (STT offline pt-BR leve) com gramática
  restrita à frase-gatilho — detecta a expressão exata sem treinar modelo.
"""
import io
import json
import os
import tempfile
import urllib.request
import wave
import zipfile

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
# "Ei Órbita" / "Órbita" via Vosk: gramática restrita à frase, sem treinar modelo.
_vosk_model = None
WAKE_TRIGGER = os.environ.get("WAKE_TRIGGER", "orbita")  # termo que dispara (sem acento)
WAKE_GRAMMAR = os.environ.get("WAKE_GRAMMAR", '["ei orbita", "orbita", "[unk]"]')
# confiança mínima da palavra-gatilho (evita falso positivo — verificado: fala real
# de "órbita" fica ~0.97-0.99; outras frases caem em "[unk]" com órbita=0).
WAKE_MIN_CONF = float(os.environ.get("WAKE_MIN_CONF", "0.7"))
VOSK_MODEL_NAME = os.environ.get("VOSK_MODEL", "vosk-model-small-pt-0.3")
VOSK_MODEL_URL = os.environ.get(
    "VOSK_MODEL_URL", "https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip"
)


def _ensure_vosk_model() -> str:
    path = os.path.join(MODELS_DIR, VOSK_MODEL_NAME)
    if not os.path.isdir(path):
        zp = os.path.join(MODELS_DIR, "vosk-model.zip")
        urllib.request.urlretrieve(VOSK_MODEL_URL, zp)
        with zipfile.ZipFile(zp) as z:
            z.extractall(MODELS_DIR)
        os.remove(zp)
    return path


def get_vosk():
    global _vosk_model
    if _vosk_model is None:
        from vosk import Model, SetLogLevel

        SetLogLevel(-1)
        _vosk_model = Model(_ensure_vosk_model())
    return _vosk_model


# ══════════════════════════ Endpoints ══════════════════════════
@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "stt": _whisper is not None,
        "tts": _piper is not None,
        "wake": _vosk_model is not None,
        "wake_trigger": WAKE_TRIGGER,
        "wake_phrase": "Ei Órbita / Órbita",
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
    """Detecção de "Ei Órbita" / "Órbita" em streaming.

    O cliente envia frames PCM int16 mono 16 kHz. O Vosk reconhece com gramática
    restrita à frase; quando o resultado (parcial ou final) contém o gatilho,
    responde {detected: true, text} e reinicia o reconhecedor.
    """
    await ws.accept()
    try:
        from vosk import KaldiRecognizer

        model = get_vosk()

        def new_rec():
            r = KaldiRecognizer(model, 16000, WAKE_GRAMMAR)
            r.SetWords(True)  # confiança por palavra
            return r

        rec = new_rec()
    except Exception as e:  # dependência/modelo indisponível
        await ws.send_json({"error": f"wake word indisponível: {e}"})
        await ws.close()
        return

    try:
        while True:
            chunk = await ws.receive_bytes()
            if not chunk:
                continue
            rec.AcceptWaveform(chunk)
            # o parcial dá detecção rápida (baixa latência); o FinalResult confirma
            # pela confiança da palavra (elimina falso positivo da gramática restrita).
            partial = json.loads(rec.PartialResult()).get("partial", "")
            if WAKE_TRIGGER in partial.lower():
                res = json.loads(rec.FinalResult())
                words = res.get("result", [])
                conf = max((w["conf"] for w in words if w.get("word") == WAKE_TRIGGER), default=0.0)
                detected = conf >= WAKE_MIN_CONF
                await ws.send_json({"detected": detected, "text": res.get("text", ""), "conf": round(conf, 3)})
                rec = new_rec()  # reinicia após avaliar o candidato
    except WebSocketDisconnect:
        return
    except Exception:
        await ws.close()
