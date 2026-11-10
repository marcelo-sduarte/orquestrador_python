import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { Modal, Status, duracao, hora, usePolling } from '../comum.jsx';

const ATIVOS = ['PENDENTE', 'EXECUTANDO'];

const json = (txt) => { try { return txt ? JSON.parse(txt) : null; } catch { return null; } };

/** Classe de cor de uma linha do log, pelo nível. */
function nivel(linha) {
  if (/\b(ERROR|CRITICAL)\b|Traceback|Exception|Error:|"status": "falha"/.test(linha)) return 'l-erro';
  if (/\bWARN(ING)?\b/.test(linha)) return 'l-aviso';
  if (/Bootstrap finalizado|"status": "sucesso"/.test(linha)) return 'l-fim';
  return '';
}

/** Destaca o termo buscado dentro da linha. */
function Realce({ texto, termo }) {
  if (!termo) return texto;
  const partes = texto.split(new RegExp(`(${termo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return partes.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p));
}

export default function LogModal({ execId, onFechar }) {
  const [exec, setExec] = useState(null);
  const [texto, setTexto] = useState('');
  const [seguir, setSeguir] = useState(true);
  const [busca, setBusca] = useState('');
  const [soProblemas, setSoProblemas] = useState(false);
  const [verResposta, setVerResposta] = useState(true);
  const [copiado, setCopiado] = useState(false);
  const pre = useRef(null);

  // Recarrega a cada 2 s enquanto a execução estiver na fila ou rodando
  const ativo = !exec || ATIVOS.includes(exec.status);
  usePolling(() => {
    if (!ativo) return;
    api.execucao(execId).then(setExec).catch(() => {});
    api.log(execId).then(setTexto).catch((e) => setTexto(e.message));
  }, 2000, [execId, ativo]);

  const linhas = useMemo(() => {
    const todas = texto.split(/\r?\n/).map((t, i) => ({ n: i + 1, t, c: nivel(t) }));
    while (todas.length && !todas[todas.length - 1].t) todas.pop();
    return todas.filter((l) =>
      (!soProblemas || l.c === 'l-erro' || l.c === 'l-aviso') &&
      (!busca || l.t.toLowerCase().includes(busca.toLowerCase())));
  }, [texto, busca, soProblemas]);

  useEffect(() => {
    if (seguir && pre.current) pre.current.scrollTop = pre.current.scrollHeight;
  }, [linhas, seguir]);

  if (!exec) return <Modal titulo={`Execução #${execId}`} onFechar={onFechar}><div className="dica">carregando…</div></Modal>;

  const resultado = json(exec.resultado);
  const params = json(exec.parametros) || {};
  const falhou = resultado ? resultado.status === 'falha' : exec.status === 'ERRO' || exec.status === 'TIMEOUT';

  function copiar() {
    navigator.clipboard?.writeText(texto).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); });
  }
  function baixar() {
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `execucao_${exec.id}_${exec.robo}.log` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal titulo={<>Execução #{exec.id} — {exec.robo} <Status valor={exec.status} /></>} onFechar={onFechar}>
      <div className="log-resumo">
        <div><span>Origem</span>{exec.origem}{exec.agendamento_id ? ` · agendamento #${exec.agendamento_id}` : ''}{exec.solicitado_por ? ` · ${exec.solicitado_por}` : ''}</div>
        <div><span>Início</span>{hora(exec.inicio || exec.criado_em)}</div>
        <div><span>Fim</span>{exec.fim ? hora(exec.fim) : ativo ? 'em andamento…' : '—'}</div>
        <div><span>Duração</span>{duracao(exec.duracao_s)}</div>
        <div><span>Código de saída</span>{exec.exit_code ?? '—'}</div>
        <div><span>Máquina</span>{exec.worker || '—'}{exec.pid ? ` · PID ${exec.pid}` : ''}</div>
      </div>

      {Object.keys(params).length > 0 && (
        <div className="log-params">
          <span className="dica">Parâmetros:</span>
          {Object.entries(params).map(([k, v]) => (
            <span key={k} className="chip-param"><b>{k}</b> {typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
          ))}
        </div>
      )}

      {resultado ? (
        <div className={`log-resultado ${falhou ? 'falhou' : 'ok'}`}>
          <div className="log-resultado-topo">
            <b>{falhou ? '✕ Falha' : '✓ Sucesso'}</b>
            <span>{resultado.mensagem}</span>
            {resultado.ambiente && <span className="chip-param"><b>ambiente</b> {resultado.ambiente}</span>}
          </div>
          {resultado.resposta != null && (
            <>
              <button className="btn-link" onClick={() => setVerResposta(!verResposta)}>
                {verResposta ? '▾' : '▸'} Resposta do robô
              </button>
              {verResposta && <pre className="log-json">{JSON.stringify(resultado.resposta, null, 2)}</pre>}
            </>
          )}
        </div>
      ) : exec.mensagem && !ativo ? (
        <div className="log-resultado falhou"><div className="log-resultado-topo"><b>Mensagem</b><span>{exec.mensagem}</span></div></div>
      ) : null}

      <div className="log-barra">
        <input placeholder="buscar no log…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <label className="dica"><input type="checkbox" checked={soProblemas} onChange={(e) => setSoProblemas(e.target.checked)} /> só avisos e erros</label>
        <label className="dica"><input type="checkbox" checked={seguir} onChange={(e) => setSeguir(e.target.checked)} /> acompanhar o final</label>
        <span className="cresce" />
        <span className="dica">{linhas.length} linha(s)</span>
        <button className="btn-link" onClick={copiar}>{copiado ? 'copiado ✓' : 'copiar'}</button>
        <button className="btn-link" onClick={baixar}>baixar .log</button>
      </div>

      <pre ref={pre} className="log">
        {linhas.length ? linhas.map((l) => (
          <div key={l.n} className={`l ${l.c}`}>
            <span className="l-n">{l.n}</span>
            <span className="l-t"><Realce texto={l.t} termo={busca} /></span>
          </div>
        )) : <span className="dica">{texto ? 'nenhuma linha encontrada' : ativo ? 'aguardando saída…' : '(sem log)'}</span>}
      </pre>
    </Modal>
  );
}
