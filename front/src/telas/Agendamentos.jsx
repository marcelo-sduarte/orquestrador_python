import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { hora, usePolling } from '../comum.jsx';
import ParametrosForm from '../ParametrosForm.jsx';

// Ordem de exibição: Seg ... Dom (mesmos códigos que o worker entende)
const DIAS = [['SEG', 'Seg'], ['TER', 'Ter'], ['QUA', 'Qua'], ['QUI', 'Qui'], ['SEX', 'Sex'], ['SAB', 'Sáb'], ['DOM', 'Dom']];
const UTEIS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX'];
const ATALHOS = [['Seg a Sex', UTEIS], ['Todos', DIAS.map(([c]) => c)], ['Fim de semana', ['SAB', 'DOM']]];

/** Lista de dias marcados -> valor da coluna dias (forma mais curta que o worker entende). */
function diasParaColuna(sel) {
  const ordenados = DIAS.map(([c]) => c).filter((c) => sel.includes(c));
  if (ordenados.length === 7) return 'TODOS';
  if (ordenados.join() === UTEIS.join()) return 'SEG-SEX';
  if (ordenados.join() === 'SAB,DOM') return 'FDS';
  return ordenados.join(',');
}

function diasParaTexto(sel) {
  const col = diasParaColuna(sel);
  if (col === 'TODOS') return 'Todos os dias';
  if (col === 'SEG-SEX') return 'Seg a Sex';
  if (col === 'FDS') return 'Fim de semana';
  return DIAS.filter(([c]) => sel.includes(c)).map(([, t]) => t).join(', ');
}
const INTERVALOS = ['', '2min', '5min', '15min', '30min', '1h', '2h', '4h'];
const VAZIO = { robo_id: '', dias: UTEIS, modo: 'janela', inicio: '08:00', fim: '18:00', unico: '09:00', intervalo: '15min' };

export default function Agendamentos({ avisar, filtroRobo = '', setFiltroRobo = () => {} }) {
  const [lista, setLista] = useState([]);
  const [robos, setRobos] = useState([]);
  const [f, setF] = useState(VAZIO);
  const [params, setParams] = useState({ obj: {}, erro: null });
  const [versaoForm, setVersaoForm] = useState(0); // força recriar o formulário após salvar

  const carregar = () => api.agendamentos().then(setLista).catch(() => {});
  usePolling(carregar, 5000);
  useEffect(() => {
    api.robos().then((r) => {
      setRobos(r);
      // vindo da Fila com um robô escolhido: o formulário já começa nele
      if (r[0]) setF((x) => ({ ...x, robo_id: x.robo_id || (filtroRobo ? +filtroRobo : r[0].id) }));
    });
  }, []);

  const set = (campo) => (e) => setF({ ...f, [campo]: e.target.value });
  const listaRef = useRef(null);
  const rolou = useRef(false);
  // Vindo da Fila com um robô escolhido: rola até a lista filtrada assim que ela carregar
  useEffect(() => {
    if (filtroRobo && lista.length && !rolou.current && listaRef.current) {
      rolou.current = true;
      listaRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [lista, filtroRobo]);
  const visiveis = filtroRobo ? lista.filter((a) => String(a.robo_id) === String(filtroRobo)) : lista;

  // Monta as colunas dias / horario / intervalo a partir do formulário
  const horario = f.modo === 'janela' ? `${f.inicio}-${f.fim}` : f.modo === 'unico' ? f.unico : '';
  const intervalo = f.modo === 'unico' ? '' : f.intervalo;
  const previa = previaTexto(f);

  async function salvar(e) {
    e.preventDefault();
    try {
      await api.criarAgendamento({ robo_id: f.robo_id, dias: diasParaColuna(f.dias), horario, intervalo, parametros: params.obj });
      avisar('Agendamento criado — o worker valida em até 30 s');
      setF({ ...VAZIO, robo_id: f.robo_id });
      setVersaoForm((v) => v + 1);
      carregar();
    } catch (err) { avisar(err.message, 'erro'); }
  }

  async function alternar(a) {
    try { await api.ativarAgendamento(a.id, !a.ativo); carregar(); }
    catch (e) { avisar(e.message, 'erro'); }
  }

  async function excluir(a) {
    if (!confirm(`Excluir o agendamento #${a.id} (${a.robo})?`)) return;
    try { await api.excluirAgendamento(a.id); carregar(); }
    catch (e) { avisar(e.message, 'erro'); }
  }

  return (
    <>
      <form className="cartao form-agenda" onSubmit={salvar}>
        <h3>Novo agendamento</h3>
        <div className="linha">
          <label>Robô
            <select value={f.robo_id} onChange={set('robo_id')}>
              {robos.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
            </select>
          </label>
          <div className="campo">
            <span className="campo-rotulo">Dias da semana</span>
            <span className="dias">
              {DIAS.map(([c, t]) => (
                <button type="button" key={c} className={`dia ${f.dias.includes(c) ? 'on' : ''}`}
                        onClick={() => setF({ ...f, dias: f.dias.includes(c) ? f.dias.filter((d) => d !== c) : [...f.dias, c] })}>
                  {t}
                </button>
              ))}
            </span>
            <span className="atalhos">
              {ATALHOS.map(([t, lista]) => (
                <button type="button" key={t} className="btn-link" onClick={() => setF({ ...f, dias: lista })}>{t}</button>
              ))}
              <button type="button" className="btn-link" onClick={() => setF({ ...f, dias: [] })}>limpar</button>
            </span>
          </div>
        </div>

        <div className="linha">
          <label>Quando
            <select value={f.modo} onChange={set('modo')}>
              <option value="janela">Repetir dentro de um horário</option>
              <option value="unico">Uma vez por dia</option>
              <option value="diatodo">Repetir o dia todo</option>
            </select>
          </label>
          {f.modo === 'janela' && <>
            <label>Das<input type="time" value={f.inicio} onChange={set('inicio')} /></label>
            <label>Até<input type="time" value={f.fim} onChange={set('fim')} /></label>
          </>}
          {f.modo === 'unico' && <label>Às<input type="time" value={f.unico} onChange={set('unico')} /></label>}
          {f.modo !== 'unico' && (
            <label>A cada
              <select value={f.intervalo} onChange={set('intervalo')}>
                {INTERVALOS.filter(Boolean).map((i) => <option key={i}>{i}</option>)}
              </select>
            </label>
          )}
        </div>

        {f.robo_id && <ParametrosForm key={`${f.robo_id}-${versaoForm}`} roboId={f.robo_id} onChange={setParams} agenda />}
        {params.erro && <div className="erro-campo">{params.erro}</div>}

        <div className="previa">
          <span>Vai gravar: <code>dias='{diasParaColuna(f.dias)}'</code> <code>horario='{horario}'</code> <code>intervalo='{intervalo}'</code></span>
          <span>Prévia: <b>{previa}</b></span>
        </div>
        <div className="botoes"><button className="btn" disabled={!!params.erro || !f.robo_id || !f.dias.length}>Salvar agendamento</button></div>
      </form>

      <div className="filtros" ref={listaRef}>
        <select value={filtroRobo} onChange={(e) => setFiltroRobo(e.target.value)}>
          <option value="">Todos os robôs</option>
          {robos.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
        </select>
        {filtroRobo && <button className="btn-link" onClick={() => setFiltroRobo('')}>limpar filtro</button>}
        <span className="dica">{visiveis.length} agendamento(s)</span>
      </div>

      <table>
        <thead>
          <tr><th>#</th><th>Robô</th><th>Agendamento</th><th>Próxima execução</th><th>Ativo</th><th></th></tr>
        </thead>
        <tbody>
          {visiveis.map((a) => (
            <tr key={a.id} className={a.ativo ? '' : 'inativo'}>
              <td>{a.id}</td>
              <td>{a.robo}</td>
              <td className={a.descricao?.startsWith('ERRO') ? 'falha' : ''}>
                {a.descricao || '—'}
                <div className="dica">{a.cron ? `cron: ${a.cron}` : `${a.dias || '(todos)'} | ${a.horario || '(dia todo)'} | ${a.intervalo || '(uma vez)'}`}</div>
              </td>
              <td>{a.ativo ? hora(a.proxima_execucao) : '—'}</td>
              <td>
                <label className="switch">
                  <input type="checkbox" checked={!!a.ativo} onChange={() => alternar(a)} />
                  <span>{a.ativo ? 'sim' : 'não'}</span>
                </label>
              </td>
              <td><button className="btn-link perigo" onClick={() => excluir(a)}>excluir</button></td>
            </tr>
          ))}
          {!visiveis.length && <tr><td colSpan="6" className="vazio">Nenhum agendamento</td></tr>}
        </tbody>
      </table>
    </>
  );
}

// Prévia aproximada só para o usuário; a regra oficial é a do worker (coluna descricao)
function previaTexto(f) {
  if (!f.dias.length) return 'selecione ao menos um dia';
  const dias = diasParaTexto(f.dias);
  if (f.modo === 'unico') return `${dias} · às ${f.unico}`;
  if (f.modo === 'diatodo') return `${dias} · o dia todo · a cada ${f.intervalo}`;
  return `${dias} · das ${f.inicio} às ${f.fim} · a cada ${f.intervalo}`;
}
