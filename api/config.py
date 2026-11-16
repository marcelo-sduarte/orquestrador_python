"""Configuração da API via variáveis de ambiente (ou api/.env)."""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).with_name(".env"))
except ImportError:  # python-dotenv é opcional
    pass

# Código compartilhado com o worker (regra_agenda.py) fica em ../comum
PASTA_COMUM = Path(__file__).resolve().parent.parent / "comum"
if str(PASTA_COMUM) not in sys.path:
    sys.path.insert(0, str(PASTA_COMUM))


@dataclass(frozen=True)
class Config:
    # Mesma string de conexão do worker
    conn_str: str = os.getenv(
        "ORQ_CONN_STR",
        "DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost;DATABASE=RPA;"
        "Trusted_Connection=yes;TrustServerCertificate=yes;",
    )
    # Mesmo fuso do worker: usado para calcular as próximas execuções na Fila de Processamento
    fuso: str = os.getenv("ORQ_FUSO", "America/Sao_Paulo")

    host: str = os.getenv("API_HOST", "0.0.0.0")
    porta: int = int(os.getenv("API_PORTA", "3001"))

    # Tela Sobre (opcionais): link do README completo e pasta/URL do repositório pip interno.
    # Ficam no .env para não haver endereço interno no código.
    readme_url: str = os.getenv("ORQ_README_URL", "").strip()
    pip_repo: str = os.getenv("ORQ_PIP_REPO", "").strip()

    # Front compilado (npm run build). Se existir, a API serve o front na mesma porta.
    pasta_front: Path = Path(os.getenv("API_PASTA_FRONT", str(Path(__file__).resolve().parent.parent / "front" / "dist")))


CFG = Config()
