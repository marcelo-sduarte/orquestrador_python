import { useEffect, useRef, useState } from 'react';
import { House, X } from 'lucide-react';

/** Executa `fn` agora e a cada `ms` milissegundos (pausa quando a aba do navegador está oculta). */
export function usePolling(fn, ms, deps = []) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let vivo = true;
    const tick = () => { if (vivo && !document.hidden) ref.current(); };
    tick();
    const t = setInterval(tick, ms);
    return () => { vivo = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function Status({ valor }) {
  return <span className={`badge st-${(valor || '').toLowerCase()}`}>{valor || '—'}</span>;
}

export function duracao(s) {
  if (s == null) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), seg = s % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}m` : m ? `${m}m${String(seg).padStart(2, '0')}s` : `${seg}s`;
}

export function hora(txt) {
  return txt ? txt.replace(/^(\d{4})-(\d{2})-(\d{2}) /, '$3/$2 ') : '—';
}

export function Modal({ titulo, onFechar, children, pequeno = false }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);
  return (
    // Clicar fora NÃO fecha (evita perder o que foi digitado): fecha só pelo X, Cancelar ou Esc
    <div className="modal-fundo">
      <div className={`modal ${pequeno ? 'modal-pequeno' : ''}`}>
        <div className="modal-topo">
          <strong>{titulo}</strong>
          <button className="icone-btn" onClick={onFechar} aria-label="Fechar"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Pequeno sistema de avisos (toast). */
export function useAvisos() {
  const [avisos, setAvisos] = useState([]);
  const avisar = (texto, tipo = 'ok') => {
    const id = Math.random();
    setAvisos((a) => [...a, { id, texto, tipo }]);
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 4000);
  };
  const Avisos = () => (
    <div className="avisos">
      {avisos.map((a) => <div key={a.id} className={`aviso aviso-${a.tipo}`}>{a.texto}</div>)}
    </div>
  );
  return { avisar, Avisos };
}

/** '{"cliente":"ACME","reprocessar":true}' -> 'cliente: ACME · reprocessar: sim' */
export function resumoParametros(json) {
  try {
    const o = JSON.parse(json || '{}');
    const partes = Object.entries(o).map(([k, v]) => `${k}: ${v === true ? 'sim' : v === false ? 'não' : v}`);
    return partes.length ? partes.join(' · ') : '(padrão)';
  } catch {
    return json;
  }
}

/** Marca do orquestrador: engrenagem com fluxo + nome. claro = sobre a barra roxa. */
export function Logo({ claro = false, grande = false }) {
  const t = grande ? 44 : 30;
  return (
    <span className={`logo ${claro ? 'logo-claro' : ''} ${grande ? 'logo-grande' : ''}`}>
      <svg width={t} height={t} viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="2.2" opacity=".55" />
        <path d="M11 20h6l3-6 4 12 3-6h2" fill="none" stroke="currentColor" strokeWidth="2.6"
              strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="31" cy="20" r="2.4" fill="currentColor" />
      </svg>
      <span className="logo-texto">orquestrador</span>
    </span>
  );
}

/** Página com trilha (casa » NOME) à esquerda e ações (busca, + Adicionar) à direita. */
export function Pagina({ trilha, acoes, children }) {
  return (
    <section className="pagina">
      <div className="pagina-topo">
        <div className="trilha">
          <House size={17} className="trilha-casa" />
          <span className="trilha-sep">»</span>
          <span className="trilha-chip">{trilha}</span>
        </div>
        <div className="pagina-acoes">{acoes}</div>
      </div>
      {children}
    </section>
  );
}

/** Campo de busca com lupa (filtra a lista na própria tela). */
export function Busca({ valor, onChange, placeholder = 'Pesquisar' }) {
  return (
    <label className="busca">
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="m20 20-4-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      <input value={valor} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

/** Interruptor liga/desliga (mesmo visual do sistema digital). */
export function Interruptor({ ligado, onChange, desabilitado = false, rotulo }) {
  return (
    <label className={`interruptor ${desabilitado ? 'desabilitado' : ''}`} title={desabilitado ? 'Somente visualização' : ''}>
      <input type="checkbox" checked={!!ligado} disabled={desabilitado} onChange={(e) => onChange?.(e.target.checked)} />
      <span className="interruptor-trilho"><span className="interruptor-bola" /></span>
      {rotulo && <span className="interruptor-rotulo">{rotulo}</span>}
    </label>
  );
}
