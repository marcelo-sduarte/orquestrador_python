import { useEffect, useState } from 'react';
import { api } from './api.js';

const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const numerico = (v) => /^-?\d+(\.\d+)?$/.test(String(v).trim());

/** Converte o valor do campo para o tipo que vai no JSON. Vazio -> undefined (chave sai do JSON). */
function converter(c, v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (c.tipo === 'numero') return numerico(v) ? Number(v) : v;
  if (c.tipo === 'booleano') return v === true || v === 'true';
  if (c.tipo === 'lista') return numerico(v) ? Number(v) : v;
  return v;
}

function valorInicial(c, agenda) {
  if (c.padrao == null || c.padrao === '') return undefined;
  if (c.tipo === 'data' && c.padrao.toUpperCase() === 'HOJE') return agenda ? undefined : hoje();
  return converter(c, c.padrao);
}

function validar(campos, obj, agenda) {
  for (const c of campos) {
    const v = obj[c.chave];
    const vazio = v === undefined || v === '';
    if (vazio && c.obrigatorio && !(agenda && c.tipo === 'data')) return `Preencha "${c.rotulo}"`;
    if (!vazio && c.tipo === 'numero' && !numerico(v)) return `"${c.rotulo}" deve ser um número`;
  }
  return null;
}

/**
 * Formulário de parâmetros montado a partir do cadastro do robô (tabela robo_parametro).
 * onChange({ obj, erro }) é chamado sempre que algo muda.
 * agenda=true: datas com padrão HOJE ficam vazias (o robô calcula a data em cada execução).
 */
export default function ParametrosForm({ roboId, onChange, agenda = false, titulo = 'Parâmetros' }) {
  const [campos, setCampos] = useState(null);
  const [obj, setObj] = useState({});

  useEffect(() => {
    if (!roboId) return;
    setCampos(null);
    api.camposRobo(roboId).then((cs) => {
      const inicial = {};
      cs.forEach((c) => {
        const v = valorInicial(c, agenda);
        if (v !== undefined) inicial[c.chave] = v;
      });
      setCampos(cs);
      atualizar(inicial, cs);
    }).catch(() => { setCampos([]); atualizar({}, []); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roboId]);

  function atualizar(novo, cs = campos || []) {
    setObj(novo);
    onChange({ obj: novo, erro: validar(cs, novo, agenda) });
  }

  function mudarCampo(c, valor) {
    const novo = { ...obj };
    const v = converter(c, valor);
    if (v === undefined) delete novo[c.chave];
    else novo[c.chave] = v;
    atualizar(novo);
  }

  // Robô sem informações cadastradas: não mostra nada (executa com os padrões dele)
  if (!campos || campos.length === 0) return null;

  return (
    <fieldset className="grupo">
      <legend>{titulo}</legend>
      <div className="parametros">
        {campos.map((c) => (
          <Campo key={c.chave} c={c} valor={obj[c.chave]} agenda={agenda} onChange={(v) => mudarCampo(c, v)} />
        ))}
      </div>
    </fieldset>
  );
}

function Campo({ c, valor, agenda, onChange }) {
  const rotulo = <>{c.rotulo}{c.obrigatorio && !(agenda && c.tipo === 'data') && <span className="obrig"> *</span>}</>;
  const ajuda = c.tipo === 'data' && agenda
    ? 'Deixe vazio para o robô usar a data do dia em cada execução'
    : c.ajuda;
  const v = valor ?? '';

  let entrada;
  switch (c.tipo) {
    case 'numero':
      entrada = <input type="number" value={v} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'data':
      entrada = (
        <span className="linha-data">
          <input type="date" value={v} onChange={(e) => onChange(e.target.value)} />
          {v && <button type="button" className="btn-link" onClick={() => onChange('')}>limpar</button>}
          {!agenda && <button type="button" className="btn-link" onClick={() => onChange(hoje())}>hoje</button>}
        </span>
      );
      break;
    case 'booleano':
      entrada = (
        <label className="switch">
          <input type="checkbox" checked={valor === true} onChange={(e) => onChange(e.target.checked)} />
          <span>{valor === true ? 'Sim' : 'Não'}</span>
        </label>
      );
      break;
    case 'lista':
      entrada = (
        <select value={String(v)} onChange={(e) => onChange(e.target.value)}>
          {!c.obrigatorio && <option value="">— padrão do robô —</option>}
          {c.obrigatorio && v === '' && <option value="">selecione…</option>}
          {c.opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
        </select>
      );
      break;
    default:
      entrada = <input value={v} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <div className="campo">
      <span className="campo-rotulo">{rotulo}</span>
      {entrada}
      {ajuda && <span className="dica">{ajuda}</span>}
    </div>
  );
}
