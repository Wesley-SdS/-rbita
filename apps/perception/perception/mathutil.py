"""Álgebra pequena e pura, testável sem modelo nenhum."""

from __future__ import annotations

import numpy as np


def l2_normalize(v: np.ndarray) -> np.ndarray:
    """Vetor unitário. Vetor nulo fica nulo (não vira NaN)."""
    v = np.asarray(v, dtype=np.float32).reshape(-1)
    n = float(np.linalg.norm(v))
    return v if n == 0.0 else v / n


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(l2_normalize(a), l2_normalize(b)))


def mean_embedding(vs: list[np.ndarray]) -> np.ndarray:
    """Centroide normalizado de várias amostras da mesma pessoa."""
    if not vs:
        raise ValueError("sem vetores")
    return l2_normalize(np.mean([l2_normalize(v) for v in vs], axis=0))


def equal_error_rate(genuine: list[float], impostor: list[float]) -> tuple[float, float]:
    """(EER, limiar) varrendo os escores observados. Para a medição, não para produção."""
    if not genuine or not impostor:
        raise ValueError("precisa de escores genuínos e impostores")
    g = np.asarray(genuine)
    i = np.asarray(impostor)
    melhor_gap, melhor_t = float("inf"), 0.0
    for t in np.unique(np.concatenate([g, i])):
        gap = abs(float(np.mean(i >= t)) - float(np.mean(g < t)))
        if gap < melhor_gap:
            melhor_gap, melhor_t = gap, float(t)
    eer = (float(np.mean(i >= melhor_t)) + float(np.mean(g < melhor_t))) / 2
    return (eer, melhor_t)
