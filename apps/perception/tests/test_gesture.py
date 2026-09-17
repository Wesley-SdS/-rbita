"""Classificador de gestos: puro, sem MediaPipe carregado."""

import numpy as np
import pytest

from perception.gesture import GESTOS, classify_hand, wrist_above_shoulder


def mao(dedos_estendidos: list[bool], polegar: bool, polegar_y: float = 0.5) -> list[list[float]]:
    """Monta 21 landmarks coerentes: pulso na base, bases perto, pontas longe quando estendido."""
    p = [[0.5, 0.9] for _ in range(21)]  # pulso e default
    p[0] = [0.5, 0.9]
    # polegar: base e ponta
    p[2] = [0.42, 0.8]
    p[4] = [0.36, polegar_y] if polegar else [0.44, 0.78]
    bases = {5: 0.6, 9: 0.58, 13: 0.6, 17: 0.62}
    pontas = {8: 5, 12: 9, 16: 13, 20: 17}
    for i, (base_i, y) in enumerate(bases.items()):
        p[base_i] = [0.45 + i * 0.03, y]
    for ponta_i, base_i in pontas.items():
        i = list(bases).index(base_i)
        estendido = dedos_estendidos[i]
        p[ponta_i] = [p[base_i][0], 0.35 if estendido else p[base_i][1] + 0.02]
    return p


class TestClassificacao:
    def test_mao_aberta_e_mao_levantada(self):
        m = mao([True, True, True, True], polegar=True)
        assert classify_hand(m) == ("mao_aberta", pytest.approx(0.8))
        # com o braço erguido (pulso acima dos ombros) vira o gesto de chamar
        assert classify_hand(m, wrist_above_shoulder=True)[0] == "mao_levantada"

    def test_punho_e_joinha(self):
        assert classify_hand(mao([False] * 4, polegar=False))[0] == "punho"
        assert classify_hand(mao([False] * 4, polegar=True, polegar_y=0.35))[0] == "joinha"
        assert classify_hand(mao([False] * 4, polegar=True, polegar_y=0.95))[0] == "positivo_para_baixo"

    def test_paz_e_apontando(self):
        assert classify_hand(mao([True, True, False, False], polegar=False))[0] == "paz"
        assert classify_hand(mao([True, False, False, False], polegar=False))[0] == "apontando"

    def test_combinacao_sem_nome_nao_inventa_gesto(self):
        assert classify_hand(mao([False, True, False, True], polegar=False)) is None

    def test_entrada_invalida(self):
        assert classify_hand([]) is None
        assert classify_hand([[0.1, 0.2]] * 5) is None
        assert classify_hand(np.zeros((21, 2))) is None

    def test_vocabulario_declarado_cobre_o_classificador(self):
        for gesto in ["mao_aberta", "punho", "joinha", "positivo_para_baixo", "paz", "apontando", "mao_levantada"]:
            assert gesto in GESTOS


class TestPose:
    def test_pulso_acima_dos_ombros(self):
        pose = [[0.0, 0.0] for _ in range(33)]
        pose[11] = [0.4, 0.5]
        pose[12] = [0.6, 0.52]
        assert wrist_above_shoulder(pose, wrist_y=0.3) is True
        assert wrist_above_shoulder(pose, wrist_y=0.8) is False

    def test_sem_pose_nao_afirma(self):
        assert wrist_above_shoulder([], 0.1) is False
        assert wrist_above_shoulder([[0.1, 0.2]] * 5, 0.1) is False
