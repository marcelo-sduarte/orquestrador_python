import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Modal } from '../comum.jsx';

const TIPOS = [
  ['texto', 'Texto'],
  ['numero', 'Número'],
  ['data', 'Data'],
  ['booleano', 'Sim / Não'],
  ['lista', 'Lista de opções'],
];

const NOVO_CAMPO = { rotulo: '', chave: '', tipo: 'texto', obrigatorio: false, padrao: '', opcoes: '', ajuda: '', _chaveManual: false };

/** 'Data de referência' -> 'data_de_referencia' */
function gerarChave(rotulo) {
  return rotulo.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, '_$1').slice(0, 50);
}

/** Cadastro e edição de robô, incluindo os campos que o formulário de execução vai pedir. */
export default function RoboModal({ roboId, onFechar, onSalvo, avisar }) {
  const [robo, setRobo] = useState(roboId ? null : { nome: '', ativo: true, max_concorrencia: 1, timeout_min: 60, caminho_repositorio: '', campos: [] });
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (roboId) api.obterRobo(roboId)
      .then((r) => setRobo({ ...r, campos: r.campos.map((c) => ({ ...c, _chaveManual: true })) }))
      .catch((e) => { avisar(e.message, 'erro'); onFechar(); });
  }, [roboId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!robo) return <Modal titulo="Carregando…" onFechar={onFechar}><div className="dica">carregando…</div></Modal>;

  const set = (campo, valor) => setRobo({ ...robo, [campo]: valor });
  const setCampo = (i, mudancas) => {
    const campos = robo.campos.map((c, j) => {
      if (j !== i) return c;
      const novo = { ...c, ...mudancas };
      // a chave acompanha o nome exibido até o usuário editá-la manualmente
      if ('rotulo' in mudancas && !c._chaveManual) novo.chave = gerarChave(mudancas.rotulo);
      if ('chave' in mudancas) novo._chaveManual = true;
      if ('tipo' in mudancas) novo.padrao = '';
      return novo;
    });
    set('campos', campos);
  };
  const mover = (i, d) => {
    const campos = [...robo.campos];
    [campos[i], campos[i + d]] = [campos[i + d], campos[i]];
    set('campos', campos);
  };

  const erro = validar(robo);

  async function salvar() {
    setSalvando(true);
    try {
      const dados = { ...robo, campos: robo.campos.map(({ _chaveManual, ...c }) => c) };
      if (roboId) await api.salvarRobo(roboId, dados);
      else await api.criarRobo(dados);
      avisar(roboId ? `Robô ${robo.nome} atualizado` : `Robô ${robo.nome} cadastrado`);
      onSalvo();
    } catch (e) { avisar(e.message, 'erro'); }
    finally { setSalvando(false); }
  }

  return (
    <Modal titulo={roboId ? `Editar robô ${robo.nome}` : 'Novo robô'} onFechar={onFechar}>
      <div className="form robo-form">
        <div className="linha">
          <label className="cresce">Nome do robô
            <input value={robo.nome} onChange={(e) => set('nome', e.target.value.trim())} placeholder="ex.: eco_bot" autoFocus={!roboId} />
            <span className="dica">Vai como "nomebot" para o bootstrap: pasta bots\&lt;nome&gt; (sem espaços)</span>
          </label>
          <label>Execuções simultâneas
            <input type="number" min="1" max="20" value={robo.max_concorrencia} onChange={(e) => set('max_concorrencia', e.target.value)} />
          </label>
          <label>Tempo máximo (min)
            <input type="number" min="1" max="1440" value={robo.timeout_min} onChange={(e) => set('timeout_min', e.target.value)} />
          </label>
          <label>Ativo
            <span className="switch">
              <input type="checkbox" checked={robo.ativo} onChange={(e) => set('ativo', e.target.checked)} />
              <span>{robo.ativo ? 'Sim' : 'Não'}</span>
            </span>
          </label>
        </div>

        <label>Caminho do repositório (Azure DevOps)
          <input value={robo.caminho_repositorio || ''} onChange={(e) => set('caminho_repositorio', e.target.value.trim())}
                 placeholder="https://dev.azure.com/hypera/Repositorio_Automacoes_Python/_git/Repositorio_Automacoes_Python/automacoes/eco_bot" />
          <span className="dica">Vai como "caminho_repositorio": o bootstrap clona/atualiza antes de executar. Vazio = usa o que já está na máquina.</span>
        </label>

        <fieldset className="grupo">
          <legend>Informações pedidas ao executar</legend>
          {!robo.campos.length && (
            <div className="dica">Nenhuma. O robô vai executar sem perguntar nada (usa os padrões dele).</div>
          )}

          {robo.campos.map((c, i) => (
            <div key={i} className="campo-def">
              <div className="campo-def-topo">
                <b>{i + 1}.</b>
                <span className="cresce" />
                <button type="button" className="btn-link" disabled={i === 0} onClick={() => mover(i, -1)} title="subir">↑</button>
                <button type="button" className="btn-link" disabled={i === robo.campos.length - 1} onClick={() => mover(i, 1)} title="descer">↓</button>
                <button type="button" className="btn-link perigo" onClick={() => set('campos', robo.campos.filter((_, j) => j !== i))}>remover</button>
              </div>
              <div className="linha">
                <label className="cresce">Nome exibido
                  <input value={c.rotulo} onChange={(e) => setCampo(i, { rotulo: e.target.value })} placeholder="ex.: Data de referência" />
                </label>
                <label>Chave (o que o robô lê)
                  <input value={c.chave} onChange={(e) => setCampo(i, { chave: e.target.value })} placeholder="data_referencia" />
                </label>
                <label>Tipo
                  <select value={c.tipo} onChange={(e) => setCampo(i, { tipo: e.target.value })}>
                    {TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </label>
                <label>Obrigatório
                  <span className="switch">
                    <input type="checkbox" checked={c.obrigatorio} onChange={(e) => setCampo(i, { obrigatorio: e.target.checked })} />
                    <span>{c.obrigatorio ? 'Sim' : 'Não'}</span>
                  </span>
                </label>
              </div>

              {c.tipo === 'lista' && (
                <label>Opções
                  <input value={c.opcoes} onChange={(e) => setCampo(i, { opcoes: e.target.value })}
                         placeholder="TODOS=Todos;TAESA=Taesa;BRASILIENSE=Brasiliense" />
                  <span className="dica">Formato <code>valor=Texto exibido</code>, separados por <code>;</code></span>
                </label>
              )}

              <div className="linha">
                <label>Valor padrão
                  <ValorPadrao c={c} onChange={(v) => setCampo(i, { padrao: v })} />
                </label>
                <label className="cresce">Dica para o usuário
                  <input value={c.ajuda || ''} onChange={(e) => setCampo(i, { ajuda: e.target.value })} placeholder="opcional" />
                </label>
              </div>
            </div>
          ))}

          <button type="button" className="btn-sec" onClick={() => set('campos', [...robo.campos, { ...NOVO_CAMPO }])}>
            + Adicionar informação
          </button>
        </fieldset>

        {erro && <div className="erro-campo">{erro}</div>}
        <div className="botoes">
          <button className="btn" disabled={!!erro || salvando} onClick={salvar}>
            {salvando ? 'Salvando…' : roboId ? 'Salvar alterações' : 'Cadastrar robô'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ValorPadrao({ c, onChange }) {
  const v = c.padrao ?? '';
  switch (c.tipo) {
    case 'numero':
      return <input type="number" value={v} onChange={(e) => onChange(e.target.value)} />;
    case 'booleano':
      return (
        <select value={v} onChange={(e) => onChange(e.target.value)}>
          <option value="">— nenhum —</option>
          <option value="true">Sim</option>
          <option value="false">Não</option>
        </select>
      );
    case 'data':
      return (
        <select value={v.toUpperCase() === 'HOJE' ? 'HOJE' : ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">— vazio —</option>
          <option value="HOJE">Data do dia</option>
        </select>
      );
    case 'lista': {
      const ops = (c.opcoes || '').split(';').map((s) => s.trim()).filter(Boolean)
        .map((p) => { const k = p.indexOf('='); return k < 0 ? [p, p] : [p.slice(0, k).trim(), p.slice(k + 1).trim()]; });
      return (
        <select value={v} onChange={(e) => onChange(e.target.value)}>
          <option value="">— nenhum —</option>
          {ops.map(([val, rot]) => <option key={val} value={val}>{rot}</option>)}
        </select>
      );
    }
    default:
      return <input value={v} onChange={(e) => onChange(e.target.value)} placeholder="opcional" />;
  }
}

function validar(r) {
  if (!r.nome) return 'Informe o nome do robô';
  if (!/^[A-Za-z0-9_.-]+$/.test(r.nome)) return 'Nome do robô: use letras, números, _ - . (sem espaço)';
  if (r.caminho_repositorio && !/^https?:\/\//i.test(r.caminho_repositorio)) return 'Caminho do repositório deve começar com https://';
  const chaves = new Set();
  for (const [i, c] of r.campos.entries()) {
    const ref = c.rotulo || `Informação ${i + 1}`;
    if (!c.rotulo.trim()) return `Informação ${i + 1}: preencha o nome exibido`;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c.chave)) return `"${ref}": chave inválida (letras, números e _)`;
    if (chaves.has(c.chave)) return `Chave repetida: ${c.chave}`;
    chaves.add(c.chave);
    if (c.tipo === 'lista' && !(c.opcoes || '').trim()) return `"${ref}": informe as opções da lista`;
  }
  return null;
}
