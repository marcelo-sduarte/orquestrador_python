import { useState } from 'react';
import { api } from '../api.js';
import { Modal } from '../comum.jsx';

export default function TrocarSenha({ onFechar, avisar }) {
  const [f, setF] = useState({ atual: '', nova: '', repetir: '' });
  const [salvando, setSalvando] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const erro = !f.atual ? 'Informe a senha atual'
    : f.nova.length < 8 ? 'A nova senha deve ter pelo menos 8 caracteres'
    : f.nova !== f.repetir ? 'As senhas novas não conferem' : null;

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true);
    try {
      await api.trocarSenha(f.atual, f.nova);
      avisar('Senha alterada');
      onFechar();
    } catch (err) { avisar(err.message, 'erro'); }
    finally { setSalvando(false); }
  }

  return (
    <Modal titulo="Alterar minha senha" onFechar={onFechar} pequeno>
      <form className="form" onSubmit={salvar}>
        <label>Senha atual<input type="password" value={f.atual} onChange={set('atual')} autoFocus autoComplete="current-password" /></label>
        <label>Nova senha<input type="password" value={f.nova} onChange={set('nova')} autoComplete="new-password" /></label>
        <label>Repita a nova senha<input type="password" value={f.repetir} onChange={set('repetir')} autoComplete="new-password" /></label>
        {f.atual && erro && <div className="erro-campo">{erro}</div>}
        <div className="botoes">
          <button type="button" className="btn btn-perigo" onClick={onFechar}>Cancelar</button>
          <button className="btn" disabled={!!erro || salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  );
}
