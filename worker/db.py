"""Acesso ao SQL Server. Cada thread abre a própria conexão (pyodbc não é thread-safe por conexão)."""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Iterator

import pyodbc

from config import CFG


@contextmanager
def conexao() -> Iterator[pyodbc.Connection]:
    con = pyodbc.connect(CFG.conn_str, autocommit=False, timeout=15)
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


@dataclass
class Job:
    id: int
    robo_id: int
    robo_nome: str
    parametros: str | None
    timeout_min: int
    caminho_repositorio: str | None = None


# ---------------------------------------------------------------- fila

SQL_CLAIM = """
;WITH candidato AS (
    SELECT TOP (1) f.*
    FROM fila_execucao f WITH (UPDLOCK, READPAST, ROWLOCK)
    JOIN robo r ON r.id = f.robo_id
    WHERE f.status = 'PENDENTE'
      AND r.ativo = 1
      AND (SELECT COUNT(*) FROM fila_execucao e WITH (NOLOCK)
           WHERE e.robo_id = f.robo_id AND e.status = 'EXECUTANDO') < r.max_concorrencia
    ORDER BY f.criado_em
)
UPDATE candidato
SET status = 'EXECUTANDO', worker = ?, inicio = SYSDATETIME(), heartbeat = SYSDATETIME()
OUTPUT inserted.id, inserted.robo_id, inserted.parametros;
"""


def pegar_proximo_job() -> Job | None:
    with conexao() as con:
        cur = con.cursor()
        # Serializa o claim entre workers: garante max_concorrencia mesmo com várias VMs.
        # O lock dura só a transação (milissegundos).
        cur.execute("EXEC sp_getapplock @Resource='orq_claim', @LockMode='Exclusive', "
                    "@LockOwner='Transaction', @LockTimeout=10000")
        row = cur.execute(SQL_CLAIM, CFG.worker_nome).fetchone()
        if not row:
            return None
        r = cur.execute("SELECT nome, timeout_min, caminho_repositorio FROM robo WHERE id = ?",
                        row.robo_id).fetchone()
        return Job(row.id, row.robo_id, r.nome, row.parametros, r.timeout_min or 60, r.caminho_repositorio)


def registrar_inicio(job_id: int, pid: int, log_arquivo: str) -> None:
    with conexao() as con:
        con.execute("UPDATE fila_execucao SET pid = ?, log_arquivo = ? WHERE id = ?",
                    pid, log_arquivo, job_id)


def heartbeat_e_cancelamento(job_id: int) -> bool:
    """Atualiza o heartbeat e devolve True se alguém pediu para cancelar."""
    with conexao() as con:
        row = con.execute(
            "UPDATE fila_execucao SET heartbeat = SYSDATETIME() "
            "OUTPUT inserted.cancelar_solicitado WHERE id = ?", job_id).fetchone()
        return bool(row and row[0])


def finalizar(job_id: int, status: str, exit_code: int | None, mensagem: str | None = None,
              resultado: str | None = None) -> None:
    """resultado: JSON de retorno do bootstrap (status/mensagem/resposta), quando houver."""
    with conexao() as con:
        con.execute(
            "UPDATE fila_execucao SET status = ?, exit_code = ?, mensagem = ?, resultado = ?, fim = SYSDATETIME() "
            "WHERE id = ?", status, exit_code, (mensagem or "")[:2000] or None, resultado, job_id)


def recuperar_orfaos() -> int:
    """Jobs EXECUTANDO cujo worker parou de mandar heartbeat (VM caiu, serviço morto)."""
    with conexao() as con:
        cur = con.execute(
            "UPDATE fila_execucao SET status = 'ERRO', fim = SYSDATETIME(), "
            "mensagem = 'Órfão: worker parou de responder' "
            "WHERE status = 'EXECUTANDO' AND DATEDIFF(SECOND, heartbeat, SYSDATETIME()) > ?",
            CFG.orfao_apos_s)
        return cur.rowcount


def marcar_jobs_do_worker_como_interrompidos() -> int:
    """Na inicialização: o que estava EXECUTANDO neste worker morreu junto com ele."""
    with conexao() as con:
        cur = con.execute(
            "UPDATE fila_execucao SET status = 'ERRO', fim = SYSDATETIME(), "
            "mensagem = 'Interrompido: worker reiniciado' "
            "WHERE status = 'EXECUTANDO' AND worker = ?", CFG.worker_nome)
        return cur.rowcount


# ---------------------------------------------------------------- agenda

def agendamentos_vencidos(agora: datetime):
    """Trava (UPDLOCK/READPAST) os agendamentos vencidos para que dois workers não dupliquem."""
    con = pyodbc.connect(CFG.conn_str, autocommit=False, timeout=15)
    cur = con.cursor()
    rows = cur.execute(
        "SELECT a.id, a.robo_id, a.cron, a.dias, a.horario, a.intervalo, "
        "       a.parametros, a.proxima_execucao "
        "FROM agendamento a WITH (UPDLOCK, READPAST, ROWLOCK) "
        "JOIN robo r ON r.id = a.robo_id "
        "WHERE a.ativo = 1 AND r.ativo = 1 "
        "  AND (a.proxima_execucao IS NULL OR a.proxima_execucao <= ?)", agora).fetchall()
    return con, cur, rows
