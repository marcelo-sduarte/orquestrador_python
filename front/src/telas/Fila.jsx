import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Status, duracao, hora, usePolling } from '../comum.jsx';

const PERIODOS = [['hoje', 'Hoje'], ['amanha', 'Hoje e amanhã'], ['7d', 'Próximos 7 dias']];
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

// Datas chegam como texto 'AAAA-MM-DD hh:mm:ss' no fuso do worker; as contas usam UTC só como "relógio".
const ms = (txt) => {
  const [d, h] = txt.split(' ');
  const [a, m, di] = d.split('-').map(Number);
  const [hh, mi, ss] = h.split(':').map(Number);
  return Date.UTC(a, m - 1, di, hh, mi, ss || 0);
};

/** '2026-11-11 09:00:00' -> 'hoje 09:00' | 'amanhã 09:00' | 'Qua 12/11 09:00' */
function quandoTexto(txt, agoraTxt) {
  const dif = Math.round((ms(`${txt.slice(0, 10)} 00:00:00`) - ms(`${agoraTxt.slice(0, 10)} 00:00:00`)) / 86400000);
  const hh = txt.slice(11, 16);
  if (dif === 0) return `hoje ${hh}`;
  if (dif === 1) return `amanhã ${hh}`;
  const [, m, d] = txt.slice(0, 10).split('-');
  return `${SEMANA[new Date(ms(txt)).getUTCDay()]} ${d}/${m} ${hh}`;
}

function faltam(quandoTxt, agoraTxt) {
  const min = Math.round((ms(quandoTxt) - ms(agoraTxt)) / 60000);
  if (min < 0) return `atrasada ${-min} min`;
  if (min < 1) return 'agora';
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60), r = min % 60;
  if (h < 24) return `em ${h}h${r ? String(r).padStart(2, '0') : ''}`;
  return `em ${Math.floor(h / 24)}d ${h % 24}h`;
}

export default function Fila({ avisar, irParaAgendamentos }) {
  const [dados, setDados] = useState(null);
  const [periodo, setPeriodo] = useState('hoje');
  const [roboId, setRoboId] = useState('');
  const [robos, setRobos] = useState([]);

  useEffect(() => { api.robos().then(setRobos).catch(() => {}); }, []);
  usePolling(() => api.fila(periodo, roboId).then(setDados).catch(() => {}), 5000, [periodo, roboId]);

  async function cancelar(e) {
    if (!confirm(`Cancelar a execução #${e.id} (${e.robo})?`)) return;
    try { await api.cancelar(e.id); avisar(`#${e.id} cancelada`); }
    catch (err) { avisar(err.message, 'erro'); }
  }

  if (!dados) return <div className="dica">carregando…</div>;

  return (
    <>
      <div className="filtros">
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
          {PERIODOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
        <select value={roboId} onChange={(e) => setRoboId(e.target.value)}>
          <option value="">Todos os robôs</option>
          {robos.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
        <span className="dica">horário de referência: {hora(dados.agora)} ({dados.fuso}) · atualiza a cada 5 s</span>
      </div>

      <section className="cartao">
        <h3>Agora</h3>
        {!dados.em_execucao.length && !dados.pendentes.length && <div className="dica">Nada em execução nem aguardando na fila.</div>}
        {(dados.em_execucao.length > 0 || dados.pendentes.length > 0) && (
          <table className="sem-borda">
            <thead>
              <tr><th>Posição</th><th>#</th><th>Robô</th><th>Status</th><th>Origem</th><th>Desde</th><th></th></tr>
            </thead>
            <tbody>
              {dados.em_execucao.map((e) => (
                <tr key={e.id}>
                  <td>▶</td><td>{e.id}</td><td>{e.robo}</td>
                  <td><Status valor={e.status} />{e.cancelar_solicitado ? <small> cancelando…</small> : null}</td>
                  <td title={e.solicitado_por}>{e.origem}</td>
                  <td>{hora(e.inicio)} · {duracao(e.duracao_s)}</td>
                  <td className="acoes">{!e.cancelar_solicitado && <button className="btn-link perigo" onClick={() => cancelar(e)}>cancelar</button>}</td>
                </tr>
              ))}
              {dados.pendentes.map((e, i) => (
                <tr key={e.id}>
                  <td>{i + 1}º</td><td>{e.id}</td><td>{e.robo}</td>
                  <td><Status valor={e.status} /></td>
                  <td title={e.solicitado_por}>{e.origem}</td>
                  <td>{hora(e.criado_em)}</td>
                  <td className="acoes"><button className="btn-link perigo" onClick={() => cancelar(e)}>cancelar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="cartao">
        <h3>Próximas execuções agendadas <span className="dica">· {PERIODOS.find(([v]) => v === periodo)[1].toLowerCase()} (até {hora(dados.ate)})</span></h3>

        {!dados.por_robo.length && <div className="dica">Nenhum agendamento ativo.</div>}

        {dados.por_robo.length > 0 && (
          <table className="sem-borda tabela-clicavel">
            <thead>
              <tr><th>Robô</th><th>Próxima execução</th><th>No período</th><th>Agendamentos</th><th></th></tr>
            </thead>
            <tbody>
              {dados.por_robo.map((g) => (
                <tr key={g.robo_id} className={g.robo_inativo || !g.total ? 'inativo' : ''}
                    onClick={() => irParaAgendamentos(g.robo_id)} title="Ver os agendamentos deste robô">
                  <td><b>{g.robo}</b>{g.robo_inativo && <div><small className="falha">robô inativo — não vai executar</small></div>}</td>
                  <td>
                    {g.proxima ? (
                      <>
                        {quandoTexto(g.proxima, dados.agora)}{' '}
                        <span className={g.atrasada ? 'falha' : 'dica'}>({faltam(g.proxima, dados.agora)})</span>
                      </>
                    ) : <span className="dica">nenhuma no período</span>}
                  </td>
                  <td>{g.total ? `${g.total} ${g.total === 1 ? 'execução' : 'execuções'}` : '—'}</td>
                  <td>
                    {g.agendamentos.map((a) => (
                      <div key={a.agendamento_id} className="dica">
                        {a.descricao || '—'}
                        {a.aviso && <span className="aviso-texto"> · ⚠ {a.aviso}</span>}
                        {!a.aviso && !a.total && a.proxima_fora && <> · próxima: {quandoTexto(a.proxima_fora, dados.agora)}</>}
                      </div>
                    ))}
                  </td>
                  <td className="acoes"><span className="btn-link">ver agendamentos →</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
