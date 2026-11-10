import { useEffect, useRef, useState } from 'react';

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

export function Modal({ titulo, onFechar, children }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);
  return (
    <div className="modal-fundo" onClick={onFechar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-topo">
          <strong>{titulo}</strong>
          <button className="btn-link" onClick={onFechar}>fechar ✕</button>
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

/** '{"cliente":"TAESA","reprocessar":true}' -> 'cliente: TAESA · reprocessar: sim' */
export function resumoParametros(json) {
  try {
    const o = JSON.parse(json || '{}');
    const partes = Object.entries(o).map(([k, v]) => `${k}: ${v === true ? 'sim' : v === false ? 'não' : v}`);
    return partes.length ? partes.join(' · ') : '(padrão)';
  } catch {
    return json;
  }
}
