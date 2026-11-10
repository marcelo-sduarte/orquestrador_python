"""Configuração do orquestrador via variáveis de ambiente (ou arquivo .env)."""
from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).with_name(".env"))
except ImportError:  # python-dotenv é opcional
    pass


def _int(nome: str, padrao: int) -> int:
    return int(os.getenv(nome, padrao))


@dataclass(frozen=True)
class Config:
    conn_str: str = os.getenv(
        "ORQ_CONN_STR",
        "DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost;DATABASE=Orquestrador;"
        "Trusted_Connection=yes;TrustServerCertificate=yes;",
    )
    worker_nome: str = os.getenv("ORQ_WORKER_NOME", socket.gethostname())

    # Como o robô é executado: python + bootstrap + nome do robô
    python_exe: str = os.getenv("ORQ_PYTHON", r"C:\Python315\python.exe")
    bootstrap: str = os.getenv("ORQ_BOOTSTRAP", r"C:\Users\marce\Documents\Python\Automation\bootstrap_template\bootstrap.py")
    pasta_logs: Path = Path(os.getenv("ORQ_PASTA_LOGS", r"C:\robos\logs"))

    max_jobs_simultaneos: int = _int("ORQ_MAX_JOBS", 2)    # limite total deste worker
    intervalo_poll_s: int = _int("ORQ_POLL_S", 5)          # busca de novos jobs
    intervalo_agenda_s: int = _int("ORQ_AGENDA_S", 30)     # verificação dos agendamentos
    intervalo_heartbeat_s: int = _int("ORQ_HEARTBEAT_S", 10)
    orfao_apos_s: int = _int("ORQ_ORFAO_S", 120)           # heartbeat parado -> job órfão

    fuso: str = os.getenv("ORQ_FUSO", "America/Sao_Paulo")  # cron interpretado neste fuso

    # Ambiente enviado ao bootstrap ("ambiente" no JSON): DEV, HML ou PROD — o da máquina onde o worker roda
    ambiente: str = os.getenv("ORQ_AMBIENTE", "DEV").strip().upper()


CFG = Config()
