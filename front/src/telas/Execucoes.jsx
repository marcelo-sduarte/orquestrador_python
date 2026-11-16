import { useEffect, useState } from 'react';
import { Ban, FileText, RotateCcw } from 'lucide-react';
import { api } from '../api.js';
import { Pagina, Status, duracao, hora, usePolling, resumoParametros } from '../comum.jsx';
import LogModal from './LogModal.jsx';

const STATUS = ['', 'PENDENTE', 'EXECUTANDO', 'SUCESSO', 'ERRO', 'CANCELADO', 'TIMEOUT'];

export default function Execucoes({ avisar, podeEditar }) {
  const [lista, setLista] = useState([]);
  const [robos, setRobos] = useState([]);
  const [filtro, setFiltro] = useState({ status: '', robo_id: '' });
  const [logDe, setLogDe] = useState(null);
  const [enviando, setEnviando] = useState(null); // id da execução sendo reenviada

  useEffect(() => { api.robos().then(setRobos).catch(() => {}); }, []);
  usePolling(() => api.execucoes(filtro).then(setLista).catch(() => {}), 3000, [filtro.status, filtro.robo_id]);

  async function cancelar(e) {
    if (!confirm(`Cancelar a execução #${e.id} (${e.robo})?`)) return;
    try {
      const r = await api.cancelar(e.id);
      avisar(r.status_anterior === 'PENDENTE' ? `#${e.id} cancelada` : `Cancelamento de #${e.id} solicitado ao worker`);
    } catch (err) { avisar(err.message, 'erro'); }
  }

  async function executarNovamente(e) {
    const params = resumoParametros(e.parametros);
    if (!confirm(`Executar ${e.robo} novamente com os mesmos parâmetros da #${e.id}?\n\nParâmetros: ${params}`)) return;
    setEnviando(e.id);
    try {
      const r = await api.reexecutar(e.id);
      avisar(`Execução #${r.id} enfileirada (mesmos parâmetros da #${e.id})`);
      api.execucoes(filtro).then(setLista).catch(() => {});
    } catch (err) { avisar(err.message, 'erro'); }
    finally { setEnviando(null); }
  }

  return (
    <Pagina trilha="Execuções" acoes={<>
      <span className="dica">atualiza a cada 3 s</span>
      <select value={filtro.status} onChange={(e) => setFiltro({ ...filtro, status: e.target.value })}>
        {STATUS.map((s) => <option key={s} value={s}>{s || 'Todos os status'}</option>)}
      </select>
      <select value={filtro.robo_id} onChange={(e) => setFiltro({ ...filtro, robo_id: e.target.value })}>
        <option value="">Todos os robôs</option>
        {robos.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
      </select>
    </>}>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Robô</th><th>Origem</th><th>Solicitado por</th><th>Status</th><th>Início</th>
            <th>Duração</th><th>Runner</th><th>Mensagem</th><th></th>
          </tr>
        </thead>
        <tbody>
          {lista.map((e) => (
            <tr key={e.id}>
              <td className="num">{e.id}</td>
              <td className="destaque">{e.robo}</td>
              <td>{e.origem}{e.agendamento_id ? ` #${e.agendamento_id}` : ''}</td>
              <td>{e.solicitado_por || '—'}</td>
              <td>
                <Status valor={e.status} />
                {e.cancelar_solicitado && e.status === 'EXECUTANDO' ? <small className="dica"> cancelando…</small> : null}
              </td>
              <td>{hora(e.inicio || e.criado_em)}</td>
              <td>{duracao(e.duracao_s)}</td>
              <td>{e.worker || '—'}</td>
              <td><span className="trunc" title={e.mensagem || ''}>{e.mensagem || ''}</span></td>
              <td className="acoes">
                <button className="icone-btn azul" title="Ver log" onClick={() => setLogDe(e)}><FileText size={17} /></button>
                {podeEditar && e.status !== 'PENDENTE' && (
                  <button className="icone-btn" disabled={enviando === e.id} onClick={() => executarNovamente(e)}
                          title={`Executar novamente com: ${resumoParametros(e.parametros)}`}>
                    <RotateCcw size={17} />
                  </button>
                )}
                {podeEditar && ['PENDENTE', 'EXECUTANDO'].includes(e.status) && !e.cancelar_solicitado && (
                  <button className="icone-btn vermelho" title="Cancelar" onClick={() => cancelar(e)}><Ban size={17} /></button>
                )}
              </td>
            </tr>
          ))}
          {!lista.length && <tr><td colSpan="10" className="vazio">Nenhuma execução</td></tr>}
        </tbody>
      </table>

      {logDe && <LogModal execId={logDe.id} onFechar={() => setLogDe(null)} />}
    </Pagina>
  );
}
