import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { api } from '../api.js';
import { Busca, Interruptor, Modal, Pagina, hora, usePolling } from '../comum.jsx';

const PERFIS = [['admin', 'Administrador'], ['visualizador', 'Somente visualização']];

export default function Usuarios({ avisar, eu }) {
  const [lista, setLista] = useState([]);
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState(null); // null = fechado, {} = novo, usuário = editar

  const carregar = () => api.usuarios().then(setLista).catch((e) => avisar(e.message, 'erro'));
  usePolling(carregar, 15000);

  const termo = busca.toLowerCase();
  const visiveis = lista.filter((u) => !termo || `${u.login} ${u.nome}`.toLowerCase().includes(termo));

  async function alternar(u) {
    try { await api.salvarUsuario(u.id, { nome: u.nome, perfil: u.perfil, ativo: !u.ativo }); carregar(); }
    catch (e) { avisar(e.message, 'erro'); }
  }

  return (
    <Pagina trilha="Usuários" acoes={<>
      <Busca valor={busca} onChange={setBusca} />
      <button className="btn btn-verde" onClick={() => setEditando({})}><Plus size={16} /> Adicionar</button>
    </>}>
      <table>
        <thead>
          <tr><th>Ativo</th><th>Login</th><th>Nome</th><th>Perfil</th><th>Último acesso</th><th>Criado em</th><th></th></tr>
        </thead>
        <tbody>
          {visiveis.map((u) => (
            <tr key={u.id} className={u.ativo ? '' : 'inativo'}>
              <td><Interruptor ligado={u.ativo} onChange={() => alternar(u)} desabilitado={u.id === eu.id} /></td>
              <td className="destaque">{u.login}</td>
              <td>{u.nome}{u.id === eu.id && <span className="dica"> (você)</span>}</td>
              <td><span className={`perfil-chip ${u.perfil === 'admin' ? 'admin' : ''}`}>{PERFIS.find(([v]) => v === u.perfil)?.[1]}</span></td>
              <td>{u.ultimo_acesso ? hora(u.ultimo_acesso) : <span className="dica">nunca</span>}</td>
              <td>{hora(u.criado_em)}</td>
              <td className="acoes"><button className="icone-btn azul" title="Editar" onClick={() => setEditando(u)}><Pencil size={17} /></button></td>
            </tr>
          ))}
          {!visiveis.length && <tr><td colSpan="7" className="vazio">Nenhum usuário</td></tr>}
        </tbody>
      </table>

      {editando && (
        <UsuarioModal usuario={editando} eu={eu} avisar={avisar}
                      onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar(); }} />
      )}
    </Pagina>
  );
}

function UsuarioModal({ usuario, eu, avisar, onFechar, onSalvo }) {
  const novo = !usuario.id;
  const [f, setF] = useState({ login: usuario.login || '', nome: usuario.nome || '', perfil: usuario.perfil || 'visualizador',
                               ativo: usuario.ativo ?? true, senha: '' });
  const [salvando, setSalvando] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const souEu = usuario.id === eu.id;

  const erro = novo && !/^[a-z0-9_.@-]{3,100}$/.test(f.login) ? 'Login: 3 a 100 caracteres, minúsculas, números, . _ - @'
    : !f.nome.trim() ? 'Informe o nome'
    : (novo || f.senha) && f.senha.length < 8 ? 'A senha deve ter pelo menos 8 caracteres' : null;

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true);
    try {
      if (novo) await api.criarUsuario(f);
      else await api.salvarUsuario(usuario.id, { nome: f.nome, perfil: f.perfil, ativo: f.ativo, senha: f.senha || undefined });
      avisar(novo ? `Usuário ${f.login} criado` : `Usuário ${usuario.login} atualizado`);
      onSalvo();
    } catch (err) { avisar(err.message, 'erro'); }
    finally { setSalvando(false); }
  }

  return (
    <Modal titulo={novo ? 'Novo usuário' : `Editar ${usuario.login}`} onFechar={onFechar} pequeno>
      <form className="form" onSubmit={salvar}>
        <label>Login
          <input value={f.login} disabled={!novo} autoFocus={novo}
                 onChange={(e) => setF({ ...f, login: e.target.value.trim().toLowerCase() })} placeholder="ex.: maria.souza" />
        </label>
        <label>Nome<input value={f.nome} onChange={set('nome')} autoFocus={!novo} placeholder="Nome exibido no sistema" /></label>
        <label>Perfil
          <select value={f.perfil} onChange={set('perfil')} disabled={souEu}>
            {PERFIS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
          <span className="dica">Administrador altera tudo. Somente visualização consulta execuções, fila, robôs e agendamentos.</span>
        </label>
        <label>{novo ? 'Senha' : 'Nova senha'}
          <input type="password" value={f.senha} onChange={set('senha')} autoComplete="new-password"
                 placeholder={novo ? 'mínimo 8 caracteres' : 'deixe vazio para manter a atual'} />
        </label>
        {!novo && !souEu && <Interruptor ligado={f.ativo} onChange={(v) => setF({ ...f, ativo: v })} rotulo={f.ativo ? 'Ativo' : 'Inativo'} />}
        {erro && (f.login || f.nome || f.senha) && <div className="erro-campo">{erro}</div>}
        <div className="botoes">
          <button type="button" className="btn btn-perigo" onClick={onFechar}>Cancelar</button>
          <button className="btn" disabled={!!erro || salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}
