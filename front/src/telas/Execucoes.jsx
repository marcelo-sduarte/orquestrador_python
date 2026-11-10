import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Status, duracao, hora, usePolling } from '../comum.jsx';
import LogModal from './LogModal.jsx';

const STATUS = ['', 'PENDENTE', 'EXECUTANDO', 'SUCESSO', 'ERRO', 'CANCELADO', 'TIMEOUT'];

export default function Execucoes({ avisar }) {
  const [lista, setLista] = useState([]);
  const [robos, setRobos] = useState([]);
  const [filtro, setFiltro] = useState({ status: '', robo_id: '' });
  const [logDe, setLogDe] = useState(null);

  useEffect(() => { api.robos().then(setRobos).catch(() => {}); }, []);
  usePolling(() => api.execucoes(filtro).then(setLista).catch(() => {}), 3000, [filtro.status, filtro.robo_id]);

  async function cancelar(e) {
    if (!confirm(`Cancelar a execução #${e.id} (${e.robo})?`)) return;
    try {
      const r = await api.cancelar(e.id);
      avisar(r.status_anterior === 'PENDENTE' ? `#${e.id} cancelada` : `Cancelamento de #${e.id} solicitado ao worker`);
    } catch (err) { avisar(err.message, 'erro'); }
  }

  return (
    <>
      <div className="filtros">
        <select value={filtro.status} onChange={(e) => setFiltro({ ...filtro, status: e.target.value })}>
          {STATUS.map((s) => <option key={s} value={s}>{s || 'Todos os status'}</option>)}
        </select>
        <select value={filtro.robo_id} onChange={(e) => setFiltro({ ...filtro, robo_id: e.target.value })}>
          <option value="">Todos os robôs</option>
          {robos.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
        <span className="dica">atualiza a cada 3 s</span>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th><th>Robô</th><th>Origem</th><th>Status</th><th>Início</th>
            <th>Duração</th><th>Mensagem</th><th></th>
          </tr>
        </thead>
        <tbody>
          {lista.map((e) => (
            <tr key={e.id}>
              <td>{e.id}</td>
              <td>{e.robo}</td>
              <td title={e.solicitado_por}>{e.origem}{e.agendamento_id ? ` #${e.agendamento_id}` : ''}</td>
              <td>
                <Status valor={e.status} />
                {e.cancelar_solicitado && e.status === 'EXECUTANDO' ? <small> cancelando…</small> : null}
              </td>
              <td>{hora(e.inicio || e.criado_em)}</td>
              <td>{duracao(e.duracao_s)}</td>
              <td><span className="trunc" title={e.mensagem || ''}>{e.mensagem || ''}</span></td>
              <td className="acoes">
                <button className="btn-link" onClick={() => setLogDe(e)}>log</button>
                {['PENDENTE', 'EXECUTANDO'].includes(e.status) && !e.cancelar_solicitado && (
                  <button className="btn-link perigo" onClick={() => cancelar(e)}>cancelar</button>
                )}
              </td>
            </tr>
          ))}
          {!lista.length && <tr><td colSpan="8" className="vazio">Nenhuma execução</td></tr>}
        </tbody>
      </table>

      {logDe && <LogModal execId={logDe.id} onFechar={() => setLogDe(null)} />}
    </>
  );
}
