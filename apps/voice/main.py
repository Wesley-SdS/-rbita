"""ÓRBITA — serviço de voz. STT via faster-whisper (local, pt-BR)."""
import os
import tempfile

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

app = FastAPI(title="ÓRBITA Voice")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_model: WhisperModel | None = None


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        size = os.environ.get("WHISPER_MODEL", "base")
        _model = WhisperModel(size, device="cpu", compute_type="int8")
    return _model


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "loaded": _model is not None}


@app.post("/stt")
async def stt(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    suffix = os.path.splitext(file.filename or "")[1] or ".wav"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(data)
        tmp.close()
        segments, info = get_model().transcribe(tmp.name, language="pt", vad_filter=True)
        text = " ".join(s.text for s in segments).strip()
        return {"text": text, "language": info.language, "duration": info.duration}
    finally:
        os.unlink(tmp.name)
