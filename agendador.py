"""Transforma agendamentos (cron) vencidos em linhas na fila_execucao."""
from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from croniter import croniter

import db
from config import CFG

log = logging.getLogger("agendador")
TZ = ZoneInfo(CFG.fuso)


def agora_local() -> datetime:
    # Gravamos datas "naive" no horário do fuso configurado (Brasília por padrão)
    return datetime.now(TZ).replace(tzinfo=None, microsecond=0)


def proxima(cron: str, base: datetime) -> datetime:
    return croniter(cron, base).get_next(datetime)


def processar_agenda() -> int:
    agora = agora_local()
    con, cur, rows = db.agendamentos_vencidos(agora)
    criados = 0
    try:
        for a in rows:
            if not croniter.is_valid(a.cron):
                log.error("Agendamento %s com cron inválido: %r — desativando", a.id, a.cron)
                cur.execute("UPDATE agendamento SET ativo = 0 WHERE id = ?", a.id)
                continue

            if a.proxima_execucao is not None:
                # Venceu: enfileira UMA execução, mesmo que várias tenham sido perdidas
                # (ex.: worker parado no fim de semana). Evita avalanche ao voltar.
                cur.execute(
                    "INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros, agendamento_id) "
                    "VALUES (?, 'AGENDA', 'agendador', ?, ?)", a.robo_id, a.parametros, a.id)
                criados += 1
                log.info("Agendamento %s -> robo %s enfileirado", a.id, a.robo_id)

            # proxima_execucao NULL = agendamento novo: só calcula, não executa agora
            cur.execute("UPDATE agendamento SET proxima_execucao = ? WHERE id = ?",
                        proxima(a.cron, agora), a.id)
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()
    return criados
