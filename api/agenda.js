// Cálculo das próximas ocorrências de um agendamento.
// Porte fiel de worker/regra_agenda.py — se mudar a regra lá, mude aqui também.
//
// As datas são "ingênuas" (sem fuso), igual ao banco: guardamos como Date em UTC só para fazer contas.

const DIAS = { SEG: 0, TER: 1, QUA: 2, QUI: 3, SEX: 4, SAB: 5, DOM: 6 };
const TODOS = [0, 1, 2, 3, 4, 5, 6];
const ATALHOS = {
  TODOS, TODO: TODOS, DIARIO: TODOS,
  UTEIS: [0, 1, 2, 3, 4], UTIL: [0, 1, 2, 3, 4],
  FDS: [5, 6], FIMDESEMANA: [5, 6],
};

const normalizar = (t) => t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

function dia(token) {
  const k = token.trim().slice(0, 3);
  if (!(k in DIAS)) throw new Error(`dia desconhecido: ${token}`);
  return DIAS[k];
}

function parseDias(txt) {
  if (!txt || !txt.trim()) return new Set(TODOS);
  const dias = new Set();
  for (const parte of normalizar(txt).split(/[,;/ ]+/)) {
    if (!parte) continue;
    const semHifen = parte.replace(/-/g, '');
    if (ATALHOS[semHifen]) { ATALHOS[semHifen].forEach((d) => dias.add(d)); continue; }
    if (parte.includes('-')) {
      const [a, b] = parte.split('-', 2).map(dia);
      for (let i = a; ; i = (i + 1) % 7) { dias.add(i); if (i === b) break; }
    } else dias.add(dia(parte));
  }
  if (!dias.size) throw new Error('dias vazio');
  return dias;
}

function hora(txt) {
  const m = txt.trim().toLowerCase().replace(/\s/g, '').match(/^(\d{1,2})(?:[:h](\d{2})?)?(?:min)?$/);
  if (!m) throw new Error(`horário inválido: ${txt}`);
  const h = +m[1], mi = +(m[2] || 0);
  if (h === 24 && mi === 0) return 23 * 60 + 59;
  if (h > 23 || mi > 59) throw new Error(`horário fora do intervalo: ${txt}`);
  return h * 60 + mi; // minutos desde 00:00
}

function parseHorario(txt) {
  if (!txt || !txt.trim()) return null;
  const s = (' ' + normalizar(txt) + ' ').replace(/\s+(A|AS|ATE)\s+/g, '-').trim();
  const partes = s.split('-');
  if (partes.length === 1) { const h = hora(partes[0]); return [h, h]; }
  if (partes.length === 2) {
    const [ini, fim] = partes.map(hora);
    if (fim < ini) throw new Error('horário final antes do inicial');
    return [ini, fim];
  }
  throw new Error(`horário inválido: ${txt}`);
}

function parseIntervalo(txt) {
  if (txt === null || txt === undefined || !String(txt).trim()) return null;
  const s = normalizar(String(txt)).toLowerCase().replace(/\s/g, '');
  let minutos;
  if (/^\d+$/.test(s)) minutos = +s;
  else {
    const m = s.match(/^(?:(\d+)h(?:oras?)?)?(?:(\d+)(?:m|min|minutos?)?)?$/);
    if (!m || !(m[1] || m[2])) throw new Error(`intervalo inválido: ${txt}`);
    minutos = (+(m[1] || 0)) * 60 + (+(m[2] || 0));
  }
  if (minutos < 1 || minutos > 1440) throw new Error('intervalo deve ficar entre 1 min e 24h');
  return minutos;
}

/** Monta a regra a partir das colunas dias / horario / intervalo. */
function criarRegra(diasTxt, horarioTxt, intervaloTxt) {
  const dias = parseDias(diasTxt);
  const h = parseHorario(horarioTxt);
  const iv = parseIntervalo(intervaloTxt);
  let ini, fim;
  if (h === null) {
    if (iv === null) throw new Error('informe o horário ou um intervalo');
    [ini, fim] = [0, 23 * 60 + 59];
  } else {
    [ini, fim] = h;
    if (ini === fim && iv !== null) throw new Error('com intervalo, informe uma janela de horário');
    if (ini !== fim && iv === null) throw new Error('com janela de horário, informe o intervalo');
  }
  return { dias, ini, fim, iv };
}

const MIN = 60 * 1000;
const DIA = 24 * 60 * MIN;
// Date.getUTCDay(): 0 = domingo. Converte para 0 = segunda (padrão do Python).
const diaSemana = (d) => (d.getUTCDay() + 6) % 7;
const inicioDoDia = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Primeira ocorrência estritamente depois de `base` (Date "ingênua"). */
function proxima(regra, base) {
  for (let d = 0; d < 8; d++) {
    const diaMs = inicioDoDia(base) + d * DIA;
    if (!regra.dias.has(diaSemana(new Date(diaMs)))) continue;
    if (regra.iv === null) {
      const t = diaMs + regra.ini * MIN;
      if (t > base.getTime()) return new Date(t);
      continue;
    }
    for (let m = regra.ini; m <= regra.fim; m += regra.iv) {
      const t = diaMs + m * MIN;
      if (t > base.getTime()) return new Date(t);
    }
  }
  return null;
}

/** Ocorrências a partir de `primeira` (inclusive) até `ate`, no máximo `limite`. */
function ocorrencias(regra, primeira, ate, limite = 500) {
  const lista = [];
  let t = primeira;
  while (t && t <= ate && lista.length < limite) {
    lista.push(t);
    t = proxima(regra, t);
  }
  return lista;
}

// ---- conversão entre texto do banco e Date "ingênua"
const deTexto = (s) => {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0))) : null;
};
const paraTexto = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

/** "Agora" no fuso do worker (ORQ_FUSO), como Date ingênua. */
function agoraNoFuso(fuso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second));
}

module.exports = { criarRegra, proxima, ocorrencias, deTexto, paraTexto, agoraNoFuso };
