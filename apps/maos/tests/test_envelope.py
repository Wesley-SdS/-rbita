"""O espelho do envelope (PRD 5.4, F2): as maos recusam sozinhas o que esta fora."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from maos.apps import app_no_envelope, app_oculto, normalizar_app
from maos.envelope import Envelope, Espelho


def env(sid="s1", apps=("VS Code",), minutos=10, maquina="pc"):
    return Envelope(sid, "computador", "objetivo", list(apps), [], 30, 0, datetime.now(timezone.utc) + timedelta(minutes=minutos), maquina)


def test_sem_envelope_recusa():
    e = Espelho()
    assert "Não há sessão" in e.conferir("s1", ["code"])


def test_envelope_ativo_aceita_app_do_envelope():
    e = Espelho()
    e.receber(env())
    assert e.conferir("s1", ["code", "visual studio code"]) is None
    assert e.ativo()


def test_outra_sessao_recusa():
    e = Espelho()
    e.receber(env())
    assert "não é a ativa" in e.conferir("s2", ["code"])
    assert "não é a ativa" in e.conferir(None, ["code"])


def test_app_fora_do_envelope_recusa():
    e = Espelho()
    e.receber(env())
    assert "não está no envelope" in e.conferir("s1", ["excel", "microsoft excel"])


def test_tempo_vencido_recusa():
    e = Espelho()
    e.receber(env(minutos=-1))
    assert "tempo" in e.conferir("s1", ["code"])
    assert not e.ativo()


def test_fim_so_da_sessao_espelhada():
    e = Espelho()
    e.receber(env())
    assert e.fim("outra", "encerrada", "x") is False
    assert e.conferir("s1", ["code"]) is None
    assert e.fim("s1", "encerrada", "acabou") is True
    assert e.conferir("s1", ["code"]) is not None


def test_parar_recusa_ate_envelope_novo():
    e = Espelho()
    e.receber(env())
    e.parar("atalho")
    assert "parada" in e.conferir("s1", ["code"])
    e.receber(env(sid="s2"))
    assert e.conferir("s2", ["code"]) is None
    assert e.conferir("s1", ["code"]) is not None


def test_pausar_local_tira_de_ativa_e_devolve_a_sessao():
    e = Espelho()
    assert e.pausar_local("mouse") is None
    e.receber(env())
    assert e.pausar_local("o dono mexeu") == "s1"
    assert e.conferir("s1", ["code"]) is not None


def test_ouvinte_com_defeito_nao_derruba():
    e = Espelho()
    vistos = []
    e.ouvir(lambda _s: (_ for _ in ()).throw(RuntimeError("defeito")))
    e.ouvir(lambda s: vistos.append(s.status))
    e.receber(env())
    assert vistos == ["ativa"]


def test_normalizar_e_apelidos():
    assert normalizar_app("Code.exe") == "code"
    assert normalizar_app("  Configurações ") == "configuracoes"
    assert app_no_envelope(["winword", "microsoft word", "word"], ["Word"])
    assert not app_no_envelope(["winword"], [])


def test_app_oculto_por_nome_e_por_titulo():
    assert app_oculto(["keepass"], "", ["KeePass"])
    assert app_oculto([], "Banco.kdbx - KeePass", ["keepass"])
    # palavra inteira: "Code" nao esconde o "Encode"
    assert not app_oculto([], "Encode video", ["code"])
    assert not app_oculto(["code"], "x", [])


def test_put_envelope_de_outra_maquina_409(cliente, cab):
    corpo = {"sessaoId": "s1", "alvo": "computador", "objetivo": "o", "apps": ["notepad"], "sites": [], "tetoPassos": 5, "passosUsados": 0, "expiraEm": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(), "maquina": "outra-maquina"}
    r = cliente.put("/envelope", json=corpo, headers=cab)
    assert r.status_code == 409 and r.json()["recusada"] is True


def test_put_envelope_fim_e_parar_pela_rota(cliente, cab, maos):
    corpo = {"sessaoId": "s1", "alvo": "computador", "objetivo": "o", "apps": ["notepad"], "sites": [], "tetoPassos": 5, "passosUsados": 0, "expiraEm": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(), "maquina": maos.maquina}
    assert cliente.put("/envelope", json=corpo, headers=cab).status_code == 200
    assert maos.espelho.ativo()
    assert cliente.post("/envelope/fim", json={"sessaoId": "s1", "status": "encerrada", "motivo": "fim"}, headers=cab).json()["mudou"] is True
    assert not maos.espelho.ativo()
    cliente.put("/envelope", json=corpo, headers=cab)
    r = cliente.post("/parar", json={"origem": "teste"}, headers=cab).json()
    assert r["ok"] and r["ms"] < 300
    assert maos.espelho.estado().status == "parado"


def test_agir_sem_sessao_e_recusado_antes_de_qualquer_entrada(cliente, cab):
    # ponto fisico qualquer: a recusa vem do espelho, antes de qualquer SendInput
    r = cliente.post("/computador/agir", json={"acao": "clicar", "alvo": {"x": 5, "y": 5}, "sessaoId": "nenhuma"}, headers=cab)
    assert r.status_code == 409
    assert r.json()["recusada"] is True


def test_abrir_app_sem_sessao_e_recusado(cliente, cab):
    r = cliente.post("/computador/abrir", json={"tipo": "app", "alvo": "notepad", "sessaoId": None}, headers=cab)
    assert r.status_code == 409
    assert "sessão" in r.json()["detail"]
