"""Partes puras da percepção: rodam sem modelo baixado e sem rede."""

import io
import wave

import numpy as np
import pytest

from perception.audio import SAMPLE_RATE, decode_to_mono16k, slice_seconds, speech_seconds
from perception.face import anchor_centers, distance2bbox, distance2kps, nms
from perception.mathutil import cosine, equal_error_rate, l2_normalize, mean_embedding


def wav_bytes(samples: np.ndarray, sr: int = 44100, channels: int = 2) -> bytes:
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    if channels == 2:
        pcm = np.repeat(pcm[:, None], 2, axis=1).reshape(-1)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


class TestMath:
    def test_normaliza_e_cosseno(self):
        assert np.isclose(np.linalg.norm(l2_normalize(np.array([3.0, 4.0]))), 1.0)
        assert cosine(np.array([1, 0]), np.array([2, 0])) == pytest.approx(1.0)
        assert cosine(np.array([1, 0]), np.array([0, 5])) == pytest.approx(0.0)

    def test_vetor_nulo_nao_vira_nan(self):
        assert not np.isnan(l2_normalize(np.zeros(4))).any()

    def test_centroide(self):
        c = mean_embedding([np.array([1.0, 0.0]), np.array([0.0, 1.0])])
        assert c == pytest.approx(np.array([np.sqrt(0.5), np.sqrt(0.5)]), abs=1e-6)
        with pytest.raises(ValueError):
            mean_embedding([])

    def test_eer_separacao_perfeita_e_confusa(self):
        eer, t = equal_error_rate([0.8, 0.9, 0.85], [0.1, 0.2, 0.3])
        assert eer == 0.0 and 0.3 < t <= 0.8
        eer2, _ = equal_error_rate([0.5, 0.6], [0.55, 0.65])
        assert eer2 > 0.0
        with pytest.raises(ValueError):
            equal_error_rate([], [0.1])


class TestAudio:
    def test_decodifica_wav_estereo_44k_para_mono_16k(self):
        t = np.arange(44100 * 2) / 44100
        amostras = decode_to_mono16k(wav_bytes(0.5 * np.sin(2 * np.pi * 440 * t)))
        assert abs(len(amostras) - SAMPLE_RATE * 2) < SAMPLE_RATE * 0.05
        assert amostras.dtype == np.float32

    def test_decodificacao_para_no_limite_de_duracao(self):
        t = np.arange(44100 * 5) / 44100
        amostras = decode_to_mono16k(wav_bytes(0.5 * np.sin(2 * np.pi * 440 * t)), max_seconds=2)
        assert len(amostras) == SAMPLE_RATE * 2

    def test_audio_invalido(self):
        with pytest.raises(ValueError):
            decode_to_mono16k(b"")
        with pytest.raises(ValueError):
            decode_to_mono16k(b"isto nao e audio" * 10)

    def test_recorte_em_segundos(self):
        s = np.arange(SAMPLE_RATE * 5, dtype=np.float32)
        assert len(slice_seconds(s, 1, 2)) == SAMPLE_RATE
        assert len(slice_seconds(s, 4.5, 9)) == SAMPLE_RATE // 2
        assert len(slice_seconds(s, 3, 2)) == 0

    def test_fala_estimada(self):
        silencio = np.zeros(SAMPLE_RATE, dtype=np.float32)
        tom = (0.3 * np.sin(np.arange(SAMPLE_RATE * 2) / 5)).astype(np.float32)
        assert speech_seconds(silencio) == 0.0
        assert speech_seconds(np.concatenate([silencio, tom, silencio])) == pytest.approx(2.0, abs=0.1)


class TestScrfd:
    def test_centros_das_ancoras(self):
        c = anchor_centers(2, 3, 8, 2)
        assert c.shape == (12, 2)
        assert c[0].tolist() == [0, 0] and c[1].tolist() == [0, 0]
        assert c[2].tolist() == [8, 0]

    def test_distancias_para_caixa_e_pontos(self):
        pts = np.array([[10.0, 20.0]])
        assert distance2bbox(pts, np.array([[1.0, 2.0, 3.0, 4.0]])).tolist() == [[9.0, 18.0, 13.0, 24.0]]
        kps = distance2kps(pts, np.array([[1.0, 1.0] * 5]))
        assert kps.shape == (1, 10) and kps[0, :2].tolist() == [11.0, 21.0]

    def test_nms_remove_sobreposta(self):
        dets = np.array([[0, 0, 10, 10, 0.9], [1, 1, 10, 10, 0.8], [50, 50, 60, 60, 0.7]], dtype=np.float32)
        assert nms(dets, 0.4) == [0, 2]
