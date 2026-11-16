"""Conexão com o SQL Server (pyodbc): a mesma string de conexão do worker (ORQ_CONN_STR)."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Iterator

import pyodbc

from config import CFG


@contextmanager
def conexao() -> Iterator[pyodbc.Connection]:
    """Uma conexão por requisição. Commit no fim; rollback se der erro."""
    con = pyodbc.connect(CFG.conn_str, autocommit=False, timeout=15)
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def _linhas(cur: pyodbc.Cursor) -> list[dict[str, Any]]:
    if cur.description is None:  # comando sem resultado (UPDATE/DELETE sem OUTPUT)
        return []
    nomes = [c[0] for c in cur.description]
    return [dict(zip(nomes, linha)) for linha in cur.fetchall()]


def query(sql: str, *params: Any) -> list[dict[str, Any]]:
    """Executa uma query parametrizada (placeholders ?) e devolve as linhas como dicts."""
    with conexao() as con:
        return _linhas(con.cursor().execute(sql, *params))


def um(sql: str, *params: Any) -> dict[str, Any] | None:
    """Primeira linha da query, ou None."""
    linhas = query(sql, *params)
    return linhas[0] if linhas else None


class Transacao:
    """Várias queries na mesma transação: with transacao() as tx: tx.exec(...)."""

    def __init__(self, con: pyodbc.Connection):
        self._cur = con.cursor()

    def exec(self, sql: str, *params: Any) -> list[dict[str, Any]]:
        return _linhas(self._cur.execute(sql, *params))


@contextmanager
def transacao() -> Iterator[Transacao]:
    with conexao() as con:
        yield Transacao(con)
