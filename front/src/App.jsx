import { useState } from 'react';
import { api } from './api.js';
import { usePolling, useAvisos } from './comum.jsx';
import Execucoes from './telas/Execucoes.jsx';
import Robos from './telas/Robos.jsx';
import Agendamentos from './telas/Agendamentos.jsx';
import Fila from './telas/Fila.jsx';

const ABAS = { execucoes: 'Execuções', fila: 'Fila de Processamento', robos: 'Robôs', agendamentos: 'Agendamentos' };

export default function App() {
  const [aba, setAba] = useState('execucoes');
  const [agendaRobo, setAgendaRobo] = useState(''); // filtro da aba Agendamentos
  const [resumo, setResumo] = useState(null);
  const [offline, setOffline] = useState(false);
  const { avisar, Avisos } = useAvisos();

  usePolling(async () => {
    try { setResumo(await api.resumo()); setOffline(false); }
    catch { setOffline(true); }
  }, 5000);

  return (
    <div className="app">
      <header>
        <h1>Orquestrador de Robôs</h1>
        {offline ? (
          <span className="badge st-erro">API/banco indisponível</span>
        ) : resumo && (
          <div className="resumo">
            <span><b>{resumo.executando ?? 0}</b> executando</span>
            <span><b>{resumo.pendentes ?? 0}</b> na fila</span>
            <span className="ok"><b>{resumo.sucesso_hoje ?? 0}</b> sucesso hoje</span>
            <span className="falha"><b>{resumo.erro_hoje ?? 0}</b> erro hoje</span>
          </div>
        )}
      </header>

      <nav>
        {Object.entries(ABAS).map(([k, nome]) => (
          <button key={k} className={aba === k ? 'ativa' : ''} onClick={() => setAba(k)}>{nome}</button>
        ))}
      </nav>

      <main>
        {aba === 'execucoes' && <Execucoes avisar={avisar} />}
        {aba === 'fila' && <Fila avisar={avisar} irParaAgendamentos={(id) => { setAgendaRobo(String(id)); setAba('agendamentos'); }} />}
        {aba === 'robos' && <Robos avisar={avisar} irParaExecucoes={() => setAba('execucoes')} />}
        {aba === 'agendamentos' && <Agendamentos avisar={avisar} filtroRobo={agendaRobo} setFiltroRobo={setAgendaRobo} />}
      </main>
      <Avisos />
    </div>
  );
}
