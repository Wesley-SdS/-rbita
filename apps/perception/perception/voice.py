"""Assinatura de voz (embedding de locutor) via sherpa-onnx.

Vários modelos ONNX servem ao mesmo extrator (WeSpeaker, CAM++, TitaNet). Qual
usar é decisão tomada pela MEDIÇÃO nesta máquina (PRD §7), então o modelo é
escolhido por nome em tempo de execução, nunca fixo no código.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .audio import SAMPLE_RATE, speech_seconds
from .mathutil import l2_normalize

# Catálogo de CANDIDATOS da medição: nome → arquivo. É o que o script de
# download baixa; o que roda de fato vem de PERCEPTION_VOICE_MODEL.
VOICE_MODELS: dict[str, str] = {
    "wespeaker_resnet34": "wespeaker_en_voxceleb_resnet34.onnx",
    "campplus_voxceleb": "3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx",
    "titanet_small": "nemo_en_titanet_small.onnx",
}


@dataclass
class VoiceEmbedding:
    model: str
    embedding: np.ndarray
    duration_s: float
    speech_s: float


class VoiceEncoder:
    def __init__(self, models_dir: Path, name: str, threads: int | None = None):
        import sherpa_onnx

        if name not in VOICE_MODELS:
            raise ValueError(f"modelo de voz desconhecido: {name}")
        path = models_dir / "voice" / VOICE_MODELS[name]
        if not path.exists():
            raise FileNotFoundError(f"modelo não baixado: {path} (rode scripts/download_models.py)")
        cfg = sherpa_onnx.SpeakerEmbeddingExtractorConfig(
            model=str(path),
            num_threads=threads or int(os.environ.get("PERCEPTION_THREADS", "2")),
            provider="cpu",
        )
        if not cfg.validate():
            raise ValueError(f"config inválida para {name}")
        self.name = name
        self._extractor = sherpa_onnx.SpeakerEmbeddingExtractor(cfg)
        # o extrator nativo não é garantidamente reentrante
        self._lock = threading.Lock()

    @property
    def dim(self) -> int:
        return int(self._extractor.dim)

    def embed(self, samples: np.ndarray) -> VoiceEmbedding:
        if samples.size == 0:
            raise ValueError("trecho sem áudio")
        with self._lock:
            stream = self._extractor.create_stream()
            stream.accept_waveform(sample_rate=SAMPLE_RATE, waveform=samples.astype(np.float32))
            stream.input_finished()
            if not self._extractor.is_ready(stream):
                raise ValueError("trecho curto demais para extrair assinatura")
            vec = np.asarray(self._extractor.compute(stream), dtype=np.float32)
        return VoiceEmbedding(self.name, l2_normalize(vec), len(samples) / SAMPLE_RATE, speech_seconds(samples))
