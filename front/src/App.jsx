import { useEffect, useRef, useState } from 'react';
import {
  Bot, CalendarClock, ChevronDown, Hourglass, Info, KeyRound, ListChecks, LogOut, Menu, Users,
  Activity, CircleCheck, CircleX, LoaderCircle,
} from 'lucide-react';
import { api, encerrarSessao, obterSessao } from './api.js';
import { Logo, usePolling, useAvisos } from './comum.jsx';
import Login from './telas/Login.jsx';
import TrocarSenha from './telas/TrocarSenha.jsx';
import Execucoes from './telas/Execucoes.jsx';
import Robos from './telas/Robos.jsx';
import Agendamentos from './telas/Agendamentos.jsx';
import Fila from './telas/Fila.jsx';
import Usuarios from './telas/Usuarios.jsx';
import Sobre from './telas/Sobre.jsx';

const MENU = [
  { id: 'execucoes', nome: 'Execuções', icone: ListChecks },
  { id: 'fila', nome: 'Fila de Processamento', icone: Hourglass },
  { id: 'robos', nome: 'Robôs', icone: Bot },
  { id: 'agendamentos', nome: 'Agendamentos', icone: CalendarClock },
  { id: 'usuarios', nome: 'Usuários', icone: Users, soAdmin: true },
  { id: 'sobre', nome: 'Sobre', icone: Info },
];

export default function App() {
  const [sessao, setSessao] = useState(obterSessao);

  useEffect(() => {
    const expirou = () => setSessao(null);
    window.addEventListener('orq-sessao-expirada', expirou);
    return () => window.removeEventListener('orq-sessao-expirada', expirou);
  }, []);

  if (!sessao) return <Login onEntrar={setSessao} />;
  return <Painel sessao={sessao} onSair={() => { encerrarSessao(); setSessao(null); }} />;
}

function Painel({ sessao, onSair }) {
  const admin = sessao.usuario.perfil === 'admin';
  const [aba, setAba] = useState(() => localStorage.getItem('orq_aba') || 'execucoes');
  const [menuAberto, setMenuAberto] = useState(() => localStorage.getItem('orq_menu') !== 'fechado');
  const [agendaRobo, setAgendaRobo] = useState('');
  const [trocandoSenha, setTrocandoSenha] = useState(false);
  const { avisar, Avisos } = useAvisos();

  const itens = MENU.filter((m) => admin || !m.soAdmin);
  const atual = itens.find((m) => m.id === aba) || itens[0];

  function ir(id) { setAba(id); localStorage.setItem('orq_aba', id); }
  function alternarMenu() {
    setMenuAberto((v) => { localStorage.setItem('orq_menu', v ? 'fechado' : 'aberto'); return !v; });
  }

  return (
    <div className={`casca ${menuAberto ? '' : 'menu-recolhido'}`}>
      <header className="topo">
        <button className="topo-icone" onClick={alternarMenu} aria-label="Abrir ou fechar o menu"><Menu size={22} /></button>
        <Logo claro />
        <span className="cresce" />
        <MenuUsuario usuario={sessao.usuario} onTrocarSenha={() => setTrocandoSenha(true)} onSair={onSair} />
      </header>

      <aside className="lateral">
        <nav>
          {itens.map(({ id, nome, icone: Icone }) => (
            <button key={id} className={`lateral-item ${atual.id === id ? 'ativo' : ''}`} onClick={() => ir(id)} title={nome}>
              <Icone size={19} strokeWidth={1.8} />
              <span>{nome}</span>
            </button>
          ))}
        </nav>
        <div className="lateral-rodape">
          <span className={`perfil-chip ${admin ? 'admin' : ''}`}>{admin ? 'Administrador' : 'Somente visualização'}</span>
        </div>
      </aside>

      <main className="conteudo">
        {atual.id !== 'sobre' && <Resumo />}
        {atual.id === 'execucoes' && <Execucoes avisar={avisar} podeEditar={admin} />}
        {atual.id === 'fila' && (
          <Fila avisar={avisar} podeEditar={admin}
                irParaAgendamentos={(id) => { setAgendaRobo(String(id)); ir('agendamentos'); }} />
        )}
        {atual.id === 'robos' && <Robos avisar={avisar} podeEditar={admin} irParaExecucoes={() => ir('execucoes')} />}
        {atual.id === 'agendamentos' && (
          <Agendamentos avisar={avisar} podeEditar={admin} filtroRobo={agendaRobo} setFiltroRobo={setAgendaRobo} />
        )}
        {atual.id === 'usuarios' && admin && <Usuarios avisar={avisar} eu={sessao.usuario} />}
        {atual.id === 'sobre' && <Sobre />}
      </main>

      {trocandoSenha && <TrocarSenha avisar={avisar} onFechar={() => setTrocandoSenha(false)} />}
      <Avisos />
    </div>
  );
}

/** Cartões do topo: executando, na fila, sucesso e erro do dia. */
function Resumo() {
  const [r, setR] = useState(null);
  const [offline, setOffline] = useState(false);
  usePolling(async () => {
    try { setR(await api.resumo()); setOffline(false); } catch { setOffline(true); }
  }, 5000);

  if (offline) return <div className="faixa-erro">API ou banco indisponível — tentando de novo…</div>;
  const cartoes = [
    { rotulo: 'Executando', valor: r?.executando, icone: LoaderCircle, cls: 'info' },
    { rotulo: 'Na fila', valor: r?.pendentes, icone: Activity, cls: 'aviso' },
    { rotulo: 'Sucesso hoje', valor: r?.sucesso_hoje, icone: CircleCheck, cls: 'ok' },
    { rotulo: 'Erro hoje', valor: r?.erro_hoje, icone: CircleX, cls: 'erro' },
  ];
  return (
    <div className="kpis">
      {cartoes.map(({ rotulo, valor, icone: Icone, cls }) => (
        <div key={rotulo} className={`kpi kpi-${cls}`}>
          <span className="kpi-icone"><Icone size={20} /></span>
          <div>
            <div className="kpi-valor">{r ? valor ?? 0 : '–'}</div>
            <div className="kpi-rotulo">{rotulo}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MenuUsuario({ usuario, onTrocarSenha, onSair }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const fora = (e) => ref.current && !ref.current.contains(e.target) && setAberto(false);
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);
  return (
    <div className="usuario" ref={ref}>
      <button className="usuario-botao" onClick={() => setAberto(!aberto)}>
        <span>Bem-vindo! <b>{usuario.nome}</b></span>
        <ChevronDown size={18} />
      </button>
      {aberto && (
        <div className="usuario-menu">
          <div className="usuario-menu-topo">
            <b>{usuario.nome}</b>
            <span className="dica">{usuario.login} · {usuario.perfil === 'admin' ? 'Administrador' : 'Somente visualização'}</span>
          </div>
          <button onClick={() => { setAberto(false); onTrocarSenha(); }}><KeyRound size={16} /> Alterar senha</button>
          <button onClick={onSair}><LogOut size={16} /> Sair</button>
        </div>
      )}
    </div>
  );
}
