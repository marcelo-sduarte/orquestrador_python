"""Agendamento "amigável": dias + horário + intervalo, sem precisar saber cron.

    dias      'SEG-SEX' | 'SEG,QUA,SEX' | 'TODOS' | 'UTEIS' | 'FDS' | NULL (= todos)
    horario   '09:00' (uma vez) | '08:00-18:00' (janela) | '8-18' | '8h30-17h' | NULL (= dia todo)
    intervalo '15min' | '30min' | '1h' | '1h30' | '90' (minutos) | NULL (= uma vez no horário)

Combinações válidas:
    horario único  + intervalo NULL  -> roda uma vez por dia nesse horário
    horario janela + intervalo       -> roda de X em X minutos dentro da janela (início e fim inclusos)
    horario NULL   + intervalo       -> roda o dia todo, de X em X minutos a partir de 00:00
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

# 0 = segunda ... 6 = domingo (padrão do Python: date.weekday())
_DIAS = {"SEG": 0, "TER": 1, "QUA": 2, "QUI": 3, "SEX": 4, "SAB": 5, "DOM": 6}
_NOMES = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
_ATALHOS = {
    "TODOS": set(range(7)), "TODO": set(range(7)), "DIARIO": set(range(7)),
    "UTEIS": set(range(5)), "UTIL": set(range(5)),
    "FDS": {5, 6}, "FIMDESEMANA": {5, 6},
}


class RegraInvalida(ValueError):
    pass


def _normalizar(txt: str) -> str:
    txt = unicodedata.normalize("NFKD", txt).encode("ascii", "ignore").decode()
    return txt.upper().strip()


# ------------------------------------------------------------------ parsers

def parse_dias(txt: str | None) -> set[int]:
    if not txt or not txt.strip():
        return set(range(7))
    dias: set[int] = set()
    for parte in re.split(r"[,;/ ]+", _normalizar(txt)):
        if not parte:
            continue
        if parte.replace("-", "") in _ATALHOS:
            dias |= _ATALHOS[parte.replace("-", "")]
            continue
        if "-" in parte:  # intervalo SEG-SEX; aceita virar a semana: SEX-SEG
            ini, fim = (_dia(p) for p in parte.split("-", 1))
            i = ini
            while True:
                dias.add(i)
                if i == fim:
                    break
                i = (i + 1) % 7
        else:
            dias.add(_dia(parte))
    if not dias:
        raise RegraInvalida(f"dias vazio: {txt!r}")
    return dias


def _dia(token: str) -> int:
    chave = token.strip()[:3]  # 'SEGUNDA' -> 'SEG'
    if chave not in _DIAS:
        raise RegraInvalida(f"dia desconhecido: {token!r} (use DOM SEG TER QUA QUI SEX SAB)")
    return _DIAS[chave]


def _hora(txt: str) -> time:
    s = txt.strip().lower().replace(" ", "")
    m = re.fullmatch(r"(\d{1,2})(?:[:h](\d{2})?)?(?:min)?", s)
    if not m:
        raise RegraInvalida(f"horário inválido: {txt!r} (ex.: 08:00, 8h, 8h30)")
    h, mi = int(m.group(1)), int(m.group(2) or 0)
    if h == 24 and mi == 0:
        return time(23, 59)
    if not (0 <= h <= 23 and 0 <= mi <= 59):
        raise RegraInvalida(f"horário fora do intervalo: {txt!r}")
    return time(h, mi)


def parse_horario(txt: str | None) -> tuple[time, time] | None:
    """Devolve (inicio, fim). Horário único -> inicio == fim. NULL -> None (dia todo)."""
    if not txt or not txt.strip():
        return None
    s = re.sub(r"\s+(A|AS|ATE)\s+", "-", " " + _normalizar(txt) + " ").strip()
    partes = s.split("-")
    if len(partes) == 1:
        h = _hora(partes[0])
        return h, h
    if len(partes) == 2:
        ini, fim = _hora(partes[0]), _hora(partes[1])
        if fim < ini:
            raise RegraInvalida(f"horário final antes do inicial: {txt!r}")
        return ini, fim
    raise RegraInvalida(f"horário inválido: {txt!r} (ex.: 09:00 ou 08:00-18:00)")


def parse_intervalo(txt: str | None) -> int | None:
    """Minutos entre execuções, ou None (uma vez)."""
    if txt is None or not str(txt).strip():
        return None
    s = _normalizar(str(txt)).lower().replace(" ", "")
    if s.isdigit():
        minutos = int(s)
    else:
        m = re.fullmatch(r"(?:(\d+)h(?:oras?)?)?(?:(\d+)(?:m|min|minutos?)?)?", s)
        if not m or not (m.group(1) or m.group(2)):
            raise RegraInvalida(f"intervalo inválido: {txt!r} (ex.: 15min, 30min, 1h, 1h30)")
        minutos = int(m.group(1) or 0) * 60 + int(m.group(2) or 0)
    if not 1 <= minutos <= 1440:
        raise RegraInvalida(f"intervalo deve ficar entre 1 min e 24h: {txt!r}")
    return minutos


# ------------------------------------------------------------------ regra

@dataclass(frozen=True)
class Regra:
    dias: frozenset[int]
    inicio: time
    fim: time
    intervalo_min: int | None

    @classmethod
    def de_colunas(cls, dias: str | None, horario: str | None, intervalo: str | None) -> "Regra":
        d = frozenset(parse_dias(dias))
        h = parse_horario(horario)
        iv = parse_intervalo(intervalo)
        if h is None:
            if iv is None:
                raise RegraInvalida("informe o horário (ex.: 09:00) ou um intervalo (ex.: 1h)")
            return cls(d, time(0, 0), time(23, 59), iv)
        ini, fim = h
        if ini == fim and iv is not None:
            raise RegraInvalida("com intervalo, informe uma janela de horário (ex.: 08:00-18:00)")
        if ini != fim and iv is None:
            raise RegraInvalida("com janela de horário, informe o intervalo (ex.: 30min)")
        return cls(d, ini, fim, iv)

    def _horarios_do_dia(self, dia: date):
        atual = datetime.combine(dia, self.inicio)
        fim = datetime.combine(dia, self.fim)
        if self.intervalo_min is None:
            yield atual
            return
        passo = timedelta(minutes=self.intervalo_min)
        while atual <= fim:
            yield atual
            atual += passo

    def proxima(self, base: datetime) -> datetime:
        """Primeiro horário estritamente depois de `base`."""
        for d in range(8):
            dia = base.date() + timedelta(days=d)
            if dia.weekday() not in self.dias:
                continue
            for h in self._horarios_do_dia(dia):
                if h > base:
                    return h
        raise RegraInvalida("nenhuma execução encontrada nos próximos 7 dias")

    def descrever(self) -> str:
        partes = [descrever_dias(self.dias)]
        if self.intervalo_min is None:
            partes.append(f"às {self.inicio:%H:%M}")
        else:
            if (self.inicio, self.fim) == (time(0, 0), time(23, 59)):
                partes.append("o dia todo")
            else:
                partes.append(f"das {self.inicio:%H:%M} às {self.fim:%H:%M}")
            partes.append(f"a cada {descrever_intervalo(self.intervalo_min)}")
        return " · ".join(partes)


def descrever_intervalo(minutos: int) -> str:
    h, m = divmod(minutos, 60)
    if h and m:
        return f"{h}h{m:02d}"
    return f"{h}h" if h else f"{m} min"


def descrever_dias(dias) -> str:
    dias = set(dias)
    if len(dias) == 7:
        return "Todos os dias"
    if dias == {0, 1, 2, 3, 4}:
        return "Seg a Sex"
    if dias == {5, 6}:
        return "Fim de semana"
    # começa num dia cujo anterior não está no conjunto, para "Sex a Seg" sair inteiro
    inicio = min(d for d in dias if (d - 1) % 7 not in dias)
    ordem = [(inicio + i) % 7 for i in range(7) if (inicio + i) % 7 in dias]
    grupos, seq = [], [ordem[0]]
    for d in ordem[1:]:
        if d == (seq[-1] + 1) % 7:
            seq.append(d)
        else:
            grupos.append(seq); seq = [d]
    grupos.append(seq)
    textos = []
    for g in grupos:
        if len(g) >= 3:
            textos.append(f"{_NOMES[g[0]]} a {_NOMES[g[-1]]}")
        else:
            textos.extend(_NOMES[d] for d in g)
    return ", ".join(textos)
