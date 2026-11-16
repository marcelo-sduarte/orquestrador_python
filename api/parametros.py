"""Cadastro de parâmetros por robô (tabela PY_RoboParametro) e validação no servidor."""
from __future__ import annotations

import json
import re
from typing import Any

import db


class ErroValidacao(ValueError):
    """Mensagem amigável, devolvida ao front com HTTP 400."""


TIPOS = ("texto", "numero", "data", "booleano", "lista")
_NUMERICO = re.compile(r"^-?\d+(\.\d+)?$")
_CHAVE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,49}$")


def numerico(v: Any) -> bool:
    return bool(_NUMERICO.match(str(v).strip()))


def para_numero(v: Any) -> int | float:
    n = float(str(v).strip())
    return int(n) if n.is_integer() else n  # igual ao Number() do JS: "5.0" -> 5


def parse_opcoes(txt: str | None) -> list[dict[str, str]]:
    """'valor=Rótulo;valor2=Rótulo 2' -> [{valor, rotulo}]"""
    if not txt:
        return []
    saida = []
    for par in (s.strip() for s in txt.split(";")):
        if not par:
            continue
        valor, sep, rotulo = par.partition("=")
        saida.append({"valor": valor.strip(), "rotulo": (rotulo if sep else par).strip()})
    return saida


def opcoes_para_texto(ops: list[dict[str, str]]) -> str:
    return ";".join(f"{o['valor']}={o['rotulo']}" for o in ops or [])


def campos_do_robo(robo_id: int) -> list[dict[str, Any]]:
    rows = db.query(
        "SELECT chave, rotulo, tipo, obrigatorio, padrao, opcoes, ajuda "
        "FROM PY_RoboParametro WHERE robo_id = ? ORDER BY ordem, id", robo_id)
    return [{**r, "obrigatorio": bool(r["obrigatorio"]), "opcoes": parse_opcoes(r["opcoes"])} for r in rows]


def normalizar(campos: list[dict], entrada: dict, agenda: bool = False) -> dict:
    """Confere e converte os valores conforme o cadastro.
    - campos vazios e não obrigatórios são retirados (o robô usa o padrão dele)
    - chaves que não estão no cadastro são mantidas (uso avançado)
    """
    saida = dict(entrada)
    erros: list[str] = []
    for c in campos:
        v = saida.get(c["chave"])
        if v is None or str(v).strip() == "":
            saida.pop(c["chave"], None)
            # Em agendamento, data obrigatória pode ficar vazia: o robô usa a data do dia
            if c["obrigatorio"] and not (agenda and c["tipo"] == "data"):
                erros.append(f'"{c["rotulo"]}" é obrigatório')
            continue
        tipo = c["tipo"]
        if tipo == "numero":
            if not numerico(v):
                erros.append(f'"{c["rotulo"]}" deve ser um número')
            else:
                saida[c["chave"]] = para_numero(v)
        elif tipo == "booleano":
            saida[c["chave"]] = v is True or str(v).lower() == "true"
        elif tipo == "data":
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(v)):
                erros.append(f'"{c["rotulo"]}" deve ser uma data AAAA-MM-DD')
        elif tipo == "lista":
            op = next((o for o in c["opcoes"] if o["valor"] == str(v)), None)
            if not op:
                erros.append(f'"{c["rotulo"]}": opção inválida ({v})')
            else:
                saida[c["chave"]] = para_numero(op["valor"]) if numerico(op["valor"]) else op["valor"]
        else:
            saida[c["chave"]] = str(v).strip()
    if erros:
        raise ErroValidacao("; ".join(erros))
    return saida


def preparar_parametros(robo_id: int, bruto: Any, agenda: bool = False) -> str:
    """Recebe string JSON ou objeto, valida contra o cadastro do robô e devolve a string JSON final."""
    obj = bruto if bruto is not None else {}
    if isinstance(obj, str):
        try:
            obj = json.loads(obj) if obj.strip() else {}
        except json.JSONDecodeError as e:
            raise ErroValidacao(f"JSON inválido: {e}") from e
    if not isinstance(obj, dict):
        raise ErroValidacao("parametros deve ser um objeto JSON")
    return json.dumps(normalizar(campos_do_robo(robo_id), obj, agenda), ensure_ascii=False, separators=(",", ":"))


def validar_definicao(campos: Any) -> list[dict[str, Any]]:
    """Valida a definição dos campos vinda da tela de cadastro do robô. Devolve lista limpa."""
    if not isinstance(campos, list):
        return []
    vistos: set[str] = set()
    saida = []
    for n, c in enumerate(campos, start=1):
        c = c or {}
        rotulo = str(c.get("rotulo") or "").strip()
        chave = str(c.get("chave") or "").strip()
        tipo = str(c.get("tipo") or "texto")
        if not rotulo:
            raise ErroValidacao(f"Campo {n}: informe o nome exibido")
        if not _CHAVE.match(chave):
            raise ErroValidacao(f'Campo "{rotulo}": chave inválida (use letras, números e _ , sem espaço)')
        if chave in vistos:
            raise ErroValidacao(f"Chave repetida: {chave}")
        vistos.add(chave)
        if tipo not in TIPOS:
            raise ErroValidacao(f'Campo "{rotulo}": tipo inválido')
        opcoes = str(c.get("opcoes") or "").strip()
        if tipo == "lista" and not parse_opcoes(opcoes):
            raise ErroValidacao(f'Campo "{rotulo}": informe as opções da lista (ex.: A=Opção A;B=Opção B)')
        padrao = "" if c.get("padrao") is None else str(c.get("padrao")).strip()
        if padrao and tipo == "lista" and not any(o["valor"] == padrao for o in parse_opcoes(opcoes)):
            raise ErroValidacao(f'Campo "{rotulo}": o valor padrão "{padrao}" não está nas opções')
        saida.append({
            "chave": chave, "rotulo": rotulo[:100], "tipo": tipo,
            "obrigatorio": bool(c.get("obrigatorio")),
            "padrao": padrao[:200] if padrao else None,
            "opcoes": opcoes if tipo == "lista" else None,
            "ajuda": str(c.get("ajuda") or "").strip()[:300] or None,
            "ordem": n,
        })
    return saida
