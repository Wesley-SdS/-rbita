"""Gestos (CAM.4): pose e mão viram um NOME de gesto.

O PRD é claro que gesto não é trabalho de VLM: aqui é MediaPipe (landmarks) mais
uma classificação geométrica pura, que roda em milissegundos na CPU e pode ser
testada sem modelo nenhum.

Quem decide o que cada gesto FAZ é a regra que o dono cadastra (event bus), e
ela pode ser diferente por pessoa. Este módulo só diz "mão levantada".
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Sequence

import numpy as np

# Índices do MediaPipe Hands (21 pontos).
PULSO, POLEGAR_BASE, POLEGAR_PONTA = 0, 2, 4
INDICADOR_BASE, INDICADOR_PONTA = 5, 8
MEDIO_BASE, MEDIO_PONTA = 9, 12
ANELAR_BASE, ANELAR_PONTA = 13, 16
MINIMO_BASE, MINIMO_PONTA = 17, 20

# Gestos que o classificador sabe nomear. O dono liga/desliga cada um na config
# da Órbita; aqui é só o vocabulário possível.
GESTOS = ("mao_aberta", "punho", "joinha", "positivo_para_baixo", "paz", "apontando", "mao_levantada")


@dataclass
class GestureResult:
    gesture: str
    confidence: float
    hand: str
    landmarks: list[list[float]]


def _dedos_estendidos(p: np.ndarray) -> list[bool]:
    """Dedo estendido = ponta mais longe do pulso que a base. Independe de escala e de rotação."""
    pulso = p[PULSO]
    pares = [(INDICADOR_BASE, INDICADOR_PONTA), (MEDIO_BASE, MEDIO_PONTA), (ANELAR_BASE, ANELAR_PONTA), (MINIMO_BASE, MINIMO_PONTA)]
    return [float(np.linalg.norm(p[ponta] - pulso)) > float(np.linalg.norm(p[base] - pulso)) * 1.15 for base, ponta in pares]


def _polegar_estendido(p: np.ndarray) -> bool:
    """Polegar estendido = ponta LONGE da base do mínimo (o polegar abre para o
    lado oposto da mão). Medir a partir do pulso falharia com a mão girada, que
    é justamente o caso do "positivo para baixo"."""
    return float(np.linalg.norm(p[POLEGAR_PONTA] - p[MINIMO_BASE])) > float(np.linalg.norm(p[POLEGAR_BASE] - p[MINIMO_BASE])) * 1.1


def classify_hand(landmarks: Sequence[Sequence[float]], wrist_above_shoulder: bool = False) -> tuple[str, float] | None:
    """Landmarks normalizados (x, y[, z]) do MediaPipe Hands → (gesto, confiança). Puro.

    `wrist_above_shoulder` vem da pose, quando disponível: braço erguido muda
    "mão aberta" para "mão levantada", que é o gesto de chamar a Órbita.
    """
    p = np.asarray(landmarks, dtype=np.float32)
    if p.ndim != 2 or p.shape[0] < 21 or p.shape[1] < 2:
        return None
    p = p[:, :2]
    # mão degenerada (todos os pontos no mesmo lugar, detecção ruim) não vira gesto
    extensao = float(np.max(p, axis=0).max() - np.min(p, axis=0).min())
    if not np.isfinite(extensao) or extensao < 0.02:
        return None
    dedos = _dedos_estendidos(p)
    polegar = _polegar_estendido(p)
    n = sum(dedos)

    # y cresce para BAIXO na imagem
    polegar_acima = p[POLEGAR_PONTA][1] < p[INDICADOR_BASE][1] - 0.05
    polegar_abaixo = p[POLEGAR_PONTA][1] > p[INDICADOR_BASE][1] + 0.05

    if n == 0 and polegar and polegar_acima:
        return ("joinha", 0.9)
    if n == 0 and polegar and polegar_abaixo:
        return ("positivo_para_baixo", 0.9)
    if n == 0 and not polegar:
        return ("punho", 0.85)
    if n == 4:
        return ("mao_levantada" if wrist_above_shoulder else "mao_aberta", 0.9 if wrist_above_shoulder else 0.8)
    if n == 2 and dedos[0] and dedos[1]:
        return ("paz", 0.85)
    if n == 1 and dedos[0]:
        return ("apontando", 0.8)
    return None


# Índices do MediaPipe Pose usados aqui.
OMBRO_ESQ, OMBRO_DIR = 11, 12


def wrist_above_shoulder(pose_landmarks: Sequence[Sequence[float]], wrist_y: float) -> bool:
    """O pulso está acima da linha dos ombros? Puro (y cresce para baixo)."""
    p = np.asarray(pose_landmarks, dtype=np.float32)
    if p.ndim != 2 or p.shape[0] <= OMBRO_DIR:
        return False
    ombros = float(min(p[OMBRO_ESQ][1], p[OMBRO_DIR][1]))
    return wrist_y < ombros


class GestureDetector:
    """MediaPipe Hands + Pose sobre UMA imagem (keyframe), nunca vídeo contínuo."""

    def __init__(self, max_hands: int = 2, min_confidence: float = 0.5):
        import mediapipe as mp

        self._hands = mp.solutions.hands.Hands(static_image_mode=True, max_num_hands=max_hands, min_detection_confidence=min_confidence)
        self._pose = mp.solutions.pose.Pose(static_image_mode=True, min_detection_confidence=min_confidence)
        self._lock = threading.Lock()

    def detect(self, img: np.ndarray) -> list[GestureResult]:
        import cv2

        rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        with self._lock:
            maos = self._hands.process(rgb)
            corpo = self._pose.process(rgb)
        if not maos.multi_hand_landmarks:
            return []
        pose_pts = [[l.x, l.y] for l in corpo.pose_landmarks.landmark] if corpo and corpo.pose_landmarks else []

        out: list[GestureResult] = []
        for i, mao in enumerate(maos.multi_hand_landmarks):
            pts = [[l.x, l.y, l.z] for l in mao.landmark]
            acima = wrist_above_shoulder(pose_pts, pts[PULSO][1]) if pose_pts else False
            r = classify_hand(pts, acima)
            if not r:
                continue
            lado = "desconhecida"
            if maos.multi_handedness and i < len(maos.multi_handedness):
                lado = maos.multi_handedness[i].classification[0].label.lower()
            out.append(GestureResult(gesture=r[0], confidence=r[1], hand=lado, landmarks=[[round(v, 4) for v in pt] for pt in pts]))
        return out
