import { useState } from 'react';
import { api } from '../api.js';
import { Modal, Status, hora, usePolling } from '../comum.jsx';
import ParametrosForm from '../ParametrosForm.jsx';
import RoboModal from './RoboModal.jsx';

export default function Robos({ avisar, irParaExecucoes }) {
  const [robos, setRobos] = useState([]);
  const [executando, setExecutando] = useState(null);
  const [editando, setEditando] = useState(null); // null = fechado, 0 = novo, id = editar

  const carregar = () => api.robos().then(setRobos).catch(() => {});
  usePolling(carregar, 5000);

  async function alternar(r) {
    try { await api.ativarRobo(r.id, !r.ativo); carregar(); }
    catch (e) { avisar(e.message, 'erro'); }
  }

  return (
    <>
      <div className="barra">
        <span className="dica">{robos.length} robô(s)</span>
        <button className="btn" onClick={() => setEditando(0)}>+ Novo robô</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Robô</th><th>Ativo</th><th>Concorrência</th><th>Timeout</th>
            <th>Agora</th><th>Última execução</th><th></th>
          </tr>
        </thead>
        <tbody>
          {robos.map((r) => (
            <tr key={r.id} className={r.ativo ? '' : 'inativo'}>
              <td><b>{r.nome}</b></td>
              <td>
                <label className="switch">
                  <input type="checkbox" checked={!!r.ativo} onChange={() => alternar(r)} />
                  <span>{r.ativo ? 'sim' : 'não'}</span>
                </label>
              </td>
              <td>{r.max_concorrencia}</td>
              <td>{r.timeout_min} min</td>
              <td>{r.executando ? `${r.executando} executando` : ''}{r.pendentes ? ` · ${r.pendentes} na fila` : ''}</td>
              <td>{r.ultimo_status ? <><Status valor={r.ultimo_status} /> {hora(r.ultimo_fim)}</> : '—'}</td>
              <td className="acoes">
                <button className="btn-link" onClick={() => setEditando(r.id)}>editar</button>
                <button className="btn" disabled={!r.ativo} onClick={() => setExecutando(r)}>▶ Executar</button>
              </td>
            </tr>
          ))}
          {!robos.length && <tr><td colSpan="7" className="vazio">Nenhum robô cadastrado na tabela robo</td></tr>}
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
    </>
  );
}

function ExecutarModal({ robo, onFechar, onOk, avisar }) {
  const [params, setParams] = useState({ obj: {}, erro: null });
  const [usuario, setUsuario] = useState(localStorage.getItem('orq_usuario') || '');
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setEnviando(true);
    try {
      localStorage.setItem('orq_usuario', usuario);
      const r = await api.executar(robo.id, params.obj, usuario || 'front');
      onOk(r.id);
    } catch (e) { avisar(e.message, 'erro'); }
    finally { setEnviando(false); }
  }

  return (
    <Modal titulo={`Executar ${robo.nome}`} onFechar={onFechar}>
      <div className="form">
        <label>Solicitado por
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="seu nome" />
        </label>
        <ParametrosForm roboId={robo.id} onChange={setParams} />
        {params.erro && <div className="erro-campo">{params.erro}</div>}
        <div className="botoes">
          <button className="btn" disabled={!!params.erro || enviando} onClick={enviar}>
            {enviando ? 'Enviando…' : '▶ Colocar na fila'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
