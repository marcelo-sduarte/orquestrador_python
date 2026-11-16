// Opções do bootstrap escolhidas por combo box. Vão dentro de "parametros" e o worker as
// sobe para o topo do JSON do bootstrap (CHAVES_BOOTSTRAP no executor.py).
// Vazio = não envia a chave: vale o padrão (branch padrão do repositório / ORQ_AMBIENTE do worker).

export const OPCOES_BOOTSTRAP = [
  { chave: 'branch', rotulo: 'Branch', padrao: '', opcoes: ['main', 'DEV', 'QAS', 'PRD'],
    vazio: '— padrão do repositório —' },
  { chave: 'ambiente', rotulo: 'Ambiente', padrao: '', opcoes: ['DEV', 'QAS', 'PRD'],
    vazio: '— padrão do worker —' },
  { chave: 'executar_bot', rotulo: 'Executar bot', padrao: 'True', opcoes: ['True', 'False'],
    ajuda: 'False = só atualiza código e dependências, sem rodar o robô' },
];

export const BOOTSTRAP_INICIAL = Object.fromEntries(OPCOES_BOOTSTRAP.map((o) => [o.chave, o.padrao]));

/** Só as chaves preenchidas, para juntar aos parâmetros do robô. */
export function bootstrapParaParametros(valores) {
  return Object.fromEntries(Object.entries(valores).filter(([, v]) => v !== '' && v != null));
}

/** Texto curto para a lista: "branch DEV · ambiente QAS · executar False" (só o que difere do padrão). */
export function resumoBootstrap(parametrosJson) {
  let p;
  try { p = JSON.parse(parametrosJson || '{}'); } catch { return ''; }
  return OPCOES_BOOTSTRAP
    .filter((o) => p[o.chave] !== undefined && p[o.chave] !== '' && String(p[o.chave]) !== o.padrao)
    .map((o) => `${o.chave === 'executar_bot' ? 'executar' : o.chave} ${p[o.chave]}`)
    .join(' · ');
}

export default function BootstrapCampos({ valores, onChange }) {
  return (
    <fieldset className="grupo">
      <legend>Execução (bootstrap)</legend>
      <div className="parametros">
        {OPCOES_BOOTSTRAP.map((o) => (
          <div className="campo" key={o.chave}>
            <span className="campo-rotulo">{o.rotulo}</span>
            <select value={valores[o.chave] ?? ''} onChange={(e) => onChange({ ...valores, [o.chave]: e.target.value })}>
              {o.vazio && <option value="">{o.vazio}</option>}
              {o.opcoes.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            {o.ajuda && <span className="dica">{o.ajuda}</span>}
          </div>
        ))}
      </div>
    </fieldset>
  );
}
