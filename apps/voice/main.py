"""ÓRBITA — serviço de voz local.

- STT: faster-whisper (pt-BR).
- TTS: Piper (local, pt-BR, licença MIT — humanizado e leve, roda em CPU).
- Wake word "Ei Órbita" / "Órbita": Vosk (STT offline pt-BR leve) com gramática
  restrita à frase-gatilho — detecta a expressão exata sem treinar modelo.
"""
import asyncio
import io
import json
import os
import tempfile
import threading
import urllib.request
import wave
import zipfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel


# O whisper local (faster-whisper 'small') sozinho consome perto de 1 GB ao
# carregar, o que estoura instâncias pequenas de nuvem (ex.: 512 MB). Onde a
# transcrição vai para a nuvem (ASSEMBLYAI_API_KEY no app web), ele é
# dispensável: basta VOICE_WHISPER=0 e sobram só wake word (vosk) e TTS (piper),
# que cabem folgado. No self-host local, mantenha ligado (padrão).
WHISPER_ENABLED = os.environ.get("VOICE_WHISPER", "1").lower() not in ("0", "false", "no")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Pré-carrega os modelos no startup (fora do caminho de request), em paralelo.
    Assim o 1º /stt|/tts|/ws/wake não congela por dezenas de segundos carregando/
    baixando modelo. Best-effort: se algum falhar (offline), o lazy-load cobre.
    """
    async def _safe(fn):
        try:
            await asyncio.to_thread(fn)
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"level": "warn", "msg": f"preload falhou: {fn.__name__}: {e}"}))

    jobs = [_safe(get_piper), _safe(get_vosk)]
    if WHISPER_ENABLED:
        jobs.insert(0, _safe(get_whisper))
    else:
        print(json.dumps({"level": "info", "msg": "whisper local desabilitado (VOICE_WHISPER=0); use STT de nuvem"}))
    await asyncio.gather(*jobs)
    yield


app = FastAPI(title="ÓRBITA Voice", lifespan=lifespan)
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
_whisper_lock = threading.Lock()


def get_whisper():
    global _whisper
    if _whisper is None:
        with _whisper_lock:
            if _whisper is None:  # dupla checagem: evita carregar 2x sob concorrência
                from faster_whisper import WhisperModel

                # 'base' transcreve mal em pt-BR. 'small' é o melhor custo/qualidade em
                # CPU sem GPU; p/ qualidade máxima use WHISPER_MODEL=large-v3-turbo (mais
                # lento em CPU) ou medium. Configurável por env sem tocar no código.
                size = os.environ.get("WHISPER_MODEL", "small")
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


_piper_lock = threading.Lock()


def get_piper():
    global _piper
    if _piper is None:
        with _piper_lock:
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


_vosk_lock = threading.Lock()


def get_vosk():
    global _vosk_model
    if _vosk_model is None:
        with _vosk_lock:
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


def _transcribe(path: str) -> dict:
    """Trabalho CPU-bound do Whisper — roda numa thread (não no event loop).

    Parâmetros afinados p/ pt-BR e comandos curtos:
    - beam_size=5: busca melhor que o greedy padrão.
    - initial_prompt: enviesa idioma/grafia p/ português do Brasil (menos erro).
    - condition_on_previous_text=False: comandos são curtos e independentes; evita o
      modelo "inventar" continuação a partir de contexto anterior.
    - vad com min_silence 500ms: não corta o fim das palavras (causa comum de erro).
    """
    segments, info = get_whisper().transcribe(
        path,
        language="pt",
        beam_size=5,
        temperature=0,
        condition_on_previous_text=False,
        initial_prompt="Conversa em português do Brasil com a assistente Órbita.",
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )
    text = " ".join(s.text for s in segments).strip()
    return {"text": text, "language": info.language, "duration": info.duration}


@app.post("/stt")
async def stt(file: UploadFile = File(...)) -> dict:
    # Sem whisper local (instância pequena), a transcrição é responsabilidade da
    # nuvem: respondemos explícito em vez de tentar carregar 1 GB e derrubar o processo.
    if not WHISPER_ENABLED:
        raise HTTPException(
            status_code=503,
            detail="STT local desabilitado (VOICE_WHISPER=0). Configure ASSEMBLYAI_API_KEY no app web.",
        )
    data = await file.read()
    suffix = os.path.splitext(file.filename or "")[1] or ".wav"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(data)
        tmp.close()
        # offload p/ threadpool: senão o transcribe serializa TODAS as requisições
        # (inclusive o WebSocket de wake word) no event loop do FastAPI.
        return await asyncio.to_thread(_transcribe, tmp.name)
    finally:
        os.unlink(tmp.name)


@app.post("/tts")
async def tts(req: TTSRequest) -> Response:
    text = (req.text or "").strip()
    if not text:
        return Response(content=b"", status_code=400)
    audio = await asyncio.to_thread(_synthesize_wav, text[:2000], req.length_scale)
    return Response(content=audio, media_type="audio/wav")


# Nota de voz tem minutos, não horas: acima disto a conversão para (e o que
# passou é cortado). É o que limita o trabalho de uma requisição, já que a
# thread do to_thread não pode ser cancelada quando o cliente desiste.
OGG_MAX_SEGUNDOS = int(os.environ.get("VOICE_OGG_MAX_SEGUNDOS", "600"))
OGG_MAX_BYTES = 25 * 1024 * 1024
# CPU desta máquina é compartilhada com o modelo local (CLAUDE.md §9): no
# máximo duas conversões ao mesmo tempo, o resto espera a vez
_ogg_vagas = asyncio.Semaphore(2)


def _to_ogg_opus(data: bytes) -> bytes:
    """Qualquer áudio (MP3 do Edge, WAV do Piper) -> OGG/Opus mono 48 kHz.

    É o formato da NOTA DE VOZ do WhatsApp: mandado em MP3, o áudio chega como
    arquivo anexo, sem a forma de onda. O PyAV já vem com o faster-whisper e
    traz o libopus embutido, então não há ffmpeg para instalar na máquina.
    """
    import av

    out = io.BytesIO()
    with av.open(io.BytesIO(data)) as src, av.open(out, mode="w", format="ogg") as dst:
        stream = dst.add_stream("libopus", rate=48000, layout="mono")
        stream.bit_rate = 32000
        resampler = av.AudioResampler(format="s16", layout="mono", rate=48000)
        for frame in src.decode(audio=0):
            if frame.time is not None and frame.time > OGG_MAX_SEGUNDOS:
                break
            for f in resampler.resample(frame):
                for pkt in stream.encode(f):
                    dst.mux(pkt)
        for f in resampler.resample(None):
            for pkt in stream.encode(f):
                dst.mux(pkt)
        for pkt in stream.encode(None):
            dst.mux(pkt)
    return out.getvalue()


@app.post("/converter/ogg")
async def converter_ogg(file: UploadFile = File(...)) -> Response:
    # o tamanho declarado é conferido ANTES de ler o corpo para a memória
    if file.size is not None and file.size > OGG_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Áudio grande demais para virar nota de voz.")
    data = await file.read(OGG_MAX_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="Áudio vazio.")
    if len(data) > OGG_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Áudio grande demais para virar nota de voz.")
    async with _ogg_vagas:
        try:
            ogg = await asyncio.to_thread(_to_ogg_opus, data)
        except Exception as e:  # formato que o PyAV não abre
            # o detalhe fica no log do serviço, não na resposta
            print(json.dumps({"level": "warn", "msg": f"converter/ogg falhou: {e!r}"}))
            raise HTTPException(status_code=422, detail="Não consegui converter o áudio.") from e
    return Response(content=ogg, media_type="audio/ogg; codecs=opus")


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
