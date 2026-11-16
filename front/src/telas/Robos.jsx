import { useState } from 'react';
import { Pencil, Play, Plus } from 'lucide-react';
import { api } from '../api.js';
import { Busca, Interruptor, Modal, Pagina, Status, hora, usePolling } from '../comum.jsx';
import ParametrosForm from '../ParametrosForm.jsx';
import RoboModal from './RoboModal.jsx';

export default function Robos({ avisar, irParaExecucoes, podeEditar }) {
  const [robos, setRobos] = useState([]);
  const [busca, setBusca] = useState('');
  const [executando, setExecutando] = useState(null);
  const [editando, setEditando] = useState(null); // null = fechado, 0 = novo, id = editar

  const carregar = () => api.robos().then(setRobos).catch(() => {});
  usePolling(carregar, 5000);

  const termo = busca.toLowerCase();
  const visiveis = robos.filter((r) => !termo || `${r.nome} ${r.tag || ''}`.toLowerCase().includes(termo));

  async function alternar(r) {
    try { await api.ativarRobo(r.id, !r.ativo); carregar(); }
    catch (e) { avisar(e.message, 'erro'); }
  }

  return (
    <Pagina trilha="Robôs" acoes={<>
      <Busca valor={busca} onChange={setBusca} />
      {podeEditar && <button className="btn btn-verde" onClick={() => setEditando(0)}><Plus size={16} /> Adicionar</button>}
    </>}>
      <table>
        <thead>
          <tr>
            <th>Ativo</th><th>Robô</th><th>Runner</th><th>Concorrência</th><th>Timeout</th>
            <th>Agora</th><th>Última execução</th><th></th>
          </tr>
        </thead>
        <tbody>
          {visiveis.map((r) => (
            <tr key={r.id} className={r.ativo ? '' : 'inativo'}>
              <td><Interruptor ligado={r.ativo} onChange={() => alternar(r)} desabilitado={!podeEditar} /></td>
              <td className="destaque">{r.nome}</td>
              <td>{r.tag ? <span className="tag">{r.tag}</span> : <span className="dica">qualquer</span>}</td>
              <td>{r.max_concorrencia}</td>
              <td>{r.timeout_min} min</td>
              <td>
                {r.executando ? <span className="badge st-executando">{r.executando} executando</span> : null}
                {r.pendentes ? <span className="badge st-pendente">{r.pendentes} na fila</span> : null}
                {!r.executando && !r.pendentes && <span className="dica">—</span>}
              </td>
              <td>{r.ultimo_status ? <><Status valor={r.ultimo_status} /> <span className="dica">{hora(r.ultimo_fim)}</span></> : '—'}</td>
              <td className="acoes">
                {podeEditar && <>
                  <button className="icone-btn laranja" title="Executar agora" disabled={!r.ativo} onClick={() => setExecutando(r)}><Play size={17} /></button>
                  <button className="icone-btn azul" title="Editar" onClick={() => setEditando(r.id)}><Pencil size={17} /></button>
                </>}
              </td>
            </tr>
          ))}
          {!visiveis.length && <tr><td colSpan="8" className="vazio">{robos.length ? 'Nenhum robô encontrado' : 'Nenhum robô cadastrado'}</td></tr>}
        </tbody>
      </table>

      {editando !== null && (
        <RoboModal
          roboId={editando || null}
          avisar={avisar}
          onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); carregar(); }}
        />
      )}

      {executando && (
        <ExecutarModal
          robo={executando}
          onFechar={() => setExecutando(null)}
          onOk={(id) => {
            avisar(`Execução #${id} enfileirada para ${executando.nome}`);
            setExecutando(null);
            irParaExecucoes();
          }}
          avisar={avisar}
        />
      )}
    </Pagina>
  );
}

function ExecutarModal({ robo, onFechar, onOk, avisar }) {
  const [params, setParams] = useState({ obj: {}, erro: null });
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setEnviando(true);
    try {
      const r = await api.executar(robo.id, params.obj);
      onOk(r.id);
    } catch (e) { avisar(e.message, 'erro'); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo={`Executar ${robo.nome}`} onFechar={onFechar} pequeno>
      <div className="form">
        <ParametrosForm roboId={robo.id} onChange={setParams} />
        <span className="dica">A execução fica registrada no seu nome.</span>
        {params.erro && <div className="erro-campo">{params.erro}</div>}
        <div className="botoes">
          <button type="button" className="btn btn-perigo" onClick={onFechar}>Cancelar</button>
          <button className="btn" disabled={!!params.erro || enviando} onClick={enviar}>
            <Play size={15} /> {enviando ? 'Enviando…' : 'Colocar na fila'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
