"""Transforma agendamentos vencidos em linhas na PY_FilaExecucao.

A regra de cada agendamento vem das colunas dias / horario / intervalo (ver regra_agenda.py).
"""
from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

import db
from config import CFG
from regra_agenda import Regra, RegraInvalida

log = logging.getLogger("agendador")
TZ = ZoneInfo(CFG.fuso)


def agora_local() -> datetime:
    # Datas "naive" no fuso configurado (Brasília por padrão)
    return datetime.now(TZ).replace(tzinfo=None, microsecond=0)


def calcular(a, base: datetime) -> tuple[datetime, str]:
    """Devolve (próxima execução, descrição legível). Lança RegraInvalida."""
    regra = Regra.de_colunas(a.dias, a.horario, a.intervalo)
    return regra.proxima(base), regra.descrever()


def processar_agenda() -> int:
    agora = agora_local()
    con, cur, rows = db.agendamentos_vencidos(agora)
    criados = 0
    try:
        for a in rows:
            try:
                prox, descricao = calcular(a, agora)
            except RegraInvalida as e:
                log.error("Agendamento %s inválido — desativando: %s", a.id, e)
                cur.execute("UPDATE PY_Agendamento SET ativo = 0, descricao = ? WHERE id = ?",
                            f"ERRO: {e}"[:200], a.id)
                continue

            if a.proxima_execucao is not None:
                # Venceu: enfileira UMA execução, mesmo que várias tenham sido perdidas
                cur.execute(
                    "INSERT INTO PY_FilaExecucao (robo_id, origem, solicitado_por, parametros, agendamento_id) "
                    "VALUES (?, 'AGENDA', 'agendador', ?, ?)", a.robo_id, a.parametros, a.id)
                criados += 1
                log.info("Agendamento %s (%s) -> robo %s enfileirado", a.id, descricao, a.robo_id)

            cur.execute("UPDATE PY_Agendamento SET proxima_execucao = ?, descricao = ? WHERE id = ?",
                        prox, descricao[:200], a.id)
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()
    return criados
