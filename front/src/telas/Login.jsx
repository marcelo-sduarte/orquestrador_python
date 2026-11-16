import { useState } from 'react';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { api, salvarSessao } from '../api.js';
import { Logo } from '../comum.jsx';

export default function Login({ onEntrar }) {
  const [login, setLogin] = useState(localStorage.getItem('orq_ultimo_login') || '');
  const [senha, setSenha] = useState('');
  const [ver, setVer] = useState(false);
  const [erro, setErro] = useState('');
  const [entrando, setEntrando] = useState(false);

  async function entrar(e) {
    e.preventDefault();
    setErro('');
    setEntrando(true);
    try {
      const r = await api.login(login.trim(), senha);
      localStorage.setItem('orq_ultimo_login', login.trim());
      const sessao = { token: r.token, usuario: r.usuario };
      salvarSessao(sessao);
      onEntrar(sessao);
    } catch (err) {
      setErro(err.message);
      setSenha('');
    } finally { setEntrando(false); }
  }

  return (
    <div className="login">
      <section className="login-marca">
        <Logo claro grande />
        <h1>Orquestrador de <span>Robôs</span></h1>
        <p>Agende, execute e acompanhe as automações Python em todos os runners, num só lugar.</p>
        <ul>
          <li>Fila com prioridade por robô e por runner</li>
          <li>Logs de cada execução, de qualquer máquina</li>
          <li>Agendamentos por dia, horário e intervalo</li>
        </ul>
        <svg className="login-desenho" viewBox="0 0 420 220" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="20" y="70" width="110" height="80" rx="12" opacity=".9" />
            <rect x="290" y="20" width="110" height="60" rx="10" opacity=".7" />
            <rect x="290" y="95" width="110" height="60" rx="10" opacity=".7" />
            <rect x="290" y="170" width="110" height="40" rx="10" opacity=".5" />
            <path d="M130 110h70m0 0v-60h90m-90 60h90m-90 0v80h90" opacity=".8" />
            <circle cx="200" cy="110" r="6" fill="currentColor" />
            <path d="M48 98h54M48 112h40M48 126h48" opacity=".7" />
            <path d="M305 40h40M305 55h70M305 115h55M305 130h70M305 190h45" opacity=".55" />
          </g>
        </svg>
      </section>

      <section className="login-lado">
        <form className="login-cartao" onSubmit={entrar}>
          <h2>Entrar</h2>
          <p className="dica">Use o usuário e a senha cadastrados pelo administrador.</p>

          <label className="login-campo">
            <span>Usuário</span>
            <span className="login-entrada">
              <User size={17} />
              <input value={login} onChange={(e) => setLogin(e.target.value)} autoFocus={!login}
                     autoComplete="username" placeholder="seu.login" />
            </span>
          </label>

          <label className="login-campo">
            <span>Senha</span>
            <span className="login-entrada">
              <Lock size={17} />
              <input type={ver ? 'text' : 'password'} value={senha} onChange={(e) => setSenha(e.target.value)}
                     autoFocus={!!login} autoComplete="current-password" placeholder="••••••••" />
              <button type="button" className="icone-btn" onClick={() => setVer(!ver)} aria-label={ver ? 'Ocultar senha' : 'Mostrar senha'}>
                {ver ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>

          {erro && <div className="login-erro">{erro}</div>}

          <button className="btn btn-bloco" disabled={entrando || !login.trim() || !senha}>
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
          <p className="dica login-rodape">Esqueceu a senha? Peça a um administrador para redefini-la.</p>
        </form>
      </section>
    </div>
  );
}
