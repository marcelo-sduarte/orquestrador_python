// Cadastro de parâmetros por robô (tabela robo_parametro) e validação no servidor.
const { sql, query } = require('./db');

/** 'valor=Rótulo;valor2=Rótulo 2' -> [{ valor, rotulo }] */
function parseOpcoes(txt) {
  if (!txt) return [];
  return txt.split(';').map((s) => s.trim()).filter(Boolean).map((par) => {
    const i = par.indexOf('=');
    const valor = (i < 0 ? par : par.slice(0, i)).trim();
    return { valor, rotulo: (i < 0 ? par : par.slice(i + 1)).trim() };
  });
}

const numerico = (v) => /^-?\d+(\.\d+)?$/.test(String(v).trim());

async function camposDoRobo(roboId) {
  const rows = await query(`
    SELECT chave, rotulo, tipo, obrigatorio, padrao, opcoes, ajuda
    FROM robo_parametro WHERE robo_id = @robo ORDER BY ordem, id`, { robo: [sql.Int, roboId] });
  return rows.map((r) => ({ ...r, obrigatorio: !!r.obrigatorio, opcoes: parseOpcoes(r.opcoes) }));
}

/**
 * Confere e converte os valores conforme o cadastro.
 * - campos vazios e não obrigatórios são retirados (o robô usa o padrão dele)
 * - chaves que não estão no cadastro são mantidas (uso avançado)
 * Lança Error com mensagem amigável.
 */
function normalizar(campos, entrada, { agenda = false } = {}) {
  const saida = { ...entrada };
  const erros = [];
  for (const c of campos) {
    const v = saida[c.chave];
    const vazio = v === undefined || v === null || String(v).trim() === '';
    if (vazio) {
      delete saida[c.chave];
      // Em agendamento, data obrigatória pode ficar vazia: o robô usa a data do dia
      if (c.obrigatorio && !(agenda && c.tipo === 'data')) erros.push(`"${c.rotulo}" é obrigatório`);
      continue;
    }
    switch (c.tipo) {
      case 'numero':
        if (!numerico(v)) erros.push(`"${c.rotulo}" deve ser um número`);
        else saida[c.chave] = Number(v);
        break;
      case 'booleano':
        saida[c.chave] = v === true || String(v).toLowerCase() === 'true';
        break;
      case 'data':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) erros.push(`"${c.rotulo}" deve ser uma data AAAA-MM-DD`);
        break;
      case 'lista': {
        const op = c.opcoes.find((o) => o.valor === String(v));
        if (!op) erros.push(`"${c.rotulo}": opção inválida (${v})`);
        else saida[c.chave] = numerico(op.valor) ? Number(op.valor) : op.valor;
        break;
      }
      default:
        saida[c.chave] = String(v).trim();
    }
  }
  if (erros.length) throw new Error(erros.join('; '));
  return saida;
}

/** Recebe string JSON ou objeto, valida contra o cadastro do robô e devolve a string JSON final. */
async function prepararParametros(roboId, bruto, opcoes) {
  let obj = bruto ?? {};
  if (typeof obj === 'string') obj = obj.trim() ? JSON.parse(obj) : {};
  if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error('parametros deve ser um objeto JSON');
  const campos = await camposDoRobo(roboId);
  return JSON.stringify(normalizar(campos, obj, opcoes));
}

const TIPOS = ['texto', 'numero', 'data', 'booleano', 'lista'];

/** Valida a definição dos campos vinda da tela de cadastro do robô. Devolve lista limpa ou lança Error. */
function validarDefinicao(campos) {
  if (!Array.isArray(campos)) return [];
  const vistos = new Set();
  return campos.map((c, i) => {
    const n = i + 1;
    const rotulo = String(c.rotulo || '').trim();
    const chave = String(c.chave || '').trim();
    const tipo = String(c.tipo || 'texto');
    if (!rotulo) throw new Error(`Campo ${n}: informe o nome exibido`);
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,49}$/.test(chave))
      throw new Error(`Campo "${rotulo}": chave inválida (use letras, números e _ , sem espaço)`);
    if (vistos.has(chave)) throw new Error(`Chave repetida: ${chave}`);
    vistos.add(chave);
    if (!TIPOS.includes(tipo)) throw new Error(`Campo "${rotulo}": tipo inválido`);
    const opcoes = String(c.opcoes || '').trim();
    if (tipo === 'lista' && !parseOpcoes(opcoes).length)
      throw new Error(`Campo "${rotulo}": informe as opções da lista (ex.: A=Opção A;B=Opção B)`);
    const padrao = c.padrao === undefined || c.padrao === null ? '' : String(c.padrao).trim();
    if (padrao && tipo === 'lista' && !parseOpcoes(opcoes).some((o) => o.valor === padrao))
      throw new Error(`Campo "${rotulo}": o valor padrão "${padrao}" não está nas opções`);
    return {
      chave, rotulo: rotulo.slice(0, 100), tipo,
      obrigatorio: !!c.obrigatorio,
      padrao: padrao ? padrao.slice(0, 200) : null,
      opcoes: tipo === 'lista' ? opcoes : null,
      ajuda: String(c.ajuda || '').trim().slice(0, 300) || null,
      ordem: n,
    };
  });
}

/** [{valor, rotulo}] -> 'valor=Rótulo;...' (para a tela de edição) */
const opcoesParaTexto = (ops) => (ops || []).map((o) => `${o.valor}=${o.rotulo}`).join(';');

module.exports = { camposDoRobo, prepararParametros, normalizar, parseOpcoes, validarDefinicao, opcoesParaTexto };
