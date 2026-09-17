"""Decodificação de áudio para PCM mono 16 kHz float32.

Aceita o que chega de verdade: WAV do navegador, webm/opus do MediaRecorder,
mp3/m4a de reunião gravada. PyAV traz o ffmpeg embutido (sem instalar nada no
sistema, que no Windows é um passo a mais que quebra fácil).
"""

from __future__ import annotations

import io

import numpy as np

SAMPLE_RATE = 16000


def decode_to_mono16k(data: bytes, max_seconds: float | None = None) -> np.ndarray:
    """`max_seconds` para a decodificação no meio: um arquivo pequeno e muito
    comprimido (horas de silêncio em opus) não pode virar gigabytes de float32."""
    import av  # import tardio: os testes puros não precisam do ffmpeg

    if not data:
        raise ValueError("áudio vazio")
    try:
        container = av.open(io.BytesIO(data))
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"áudio ilegível: {e}") from e
    resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
    partes: list[np.ndarray] = []
    limite = int(max_seconds * SAMPLE_RATE) if max_seconds else None
    total = 0
    with container:
        stream = next((s for s in container.streams if s.type == "audio"), None)
        if stream is None:
            raise ValueError("arquivo sem trilha de áudio")
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                parte = out.to_ndarray().reshape(-1)
                partes.append(parte)
                total += len(parte)
            if limite is not None and total >= limite:
                break
        else:
            for out in resampler.resample(None):
                partes.append(out.to_ndarray().reshape(-1))
    if not partes:
        raise ValueError("áudio sem amostras")
    amostras = np.concatenate(partes)
    if limite is not None:
        amostras = amostras[:limite]
    return amostras.astype(np.float32, copy=False)


def slice_seconds(samples: np.ndarray, start_s: float, end_s: float, sr: int = SAMPLE_RATE) -> np.ndarray:
    """Trecho [start, end) em segundos, cortado aos limites do áudio."""
    a = max(0, int(round(start_s * sr)))
    b = min(len(samples), int(round(end_s * sr)))
    return samples[a:b] if b > a else samples[:0]


def speech_seconds(samples: np.ndarray, sr: int = SAMPLE_RATE, frame_ms: int = 30, rel_threshold: float = 0.1) -> float:
    """Estimativa barata de quanto do trecho tem voz (energia relativa ao pico).

    Serve para avisar "fala curta demais" (PRD §7: menos de 2 a 3 s identifica
    mal), não para recortar. O limiar vem de quem chama, com default sensato.
    """
    n = max(1, int(sr * frame_ms / 1000))
    if len(samples) < n:
        return 0.0
    frames = samples[: len(samples) // n * n].reshape(-1, n)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    pico = float(rms.max())
    if pico <= 1e-6:
        return 0.0
    return float(np.sum(rms >= pico * rel_threshold) * frame_ms / 1000)
