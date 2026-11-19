/** Marca PyKronos: relógio com PK (a perna de cima do K é o ponteiro). claro = sobre a barra roxa. */
export function Logo({ claro = false, grande = false }) {
  const t = grande ? 46 : 32;
  const ponteiro = '#F2B705';
  return (
    <span className={`logo ${claro ? 'logo-claro' : ''} ${grande ? 'logo-grande' : ''}`}>
      <svg width={t} height={t} viewBox="0 0 200 200" aria-hidden="true">
        <circle cx="100" cy="100" r="84" fill="none" stroke="currentColor" strokeWidth="11" />
        <g stroke="currentColor" strokeWidth="7" strokeLinecap="round">
          <line x1="100" y1="27" x2="100" y2="37" /><line x1="173" y1="100" x2="163" y2="100" />
          <line x1="100" y1="173" x2="100" y2="163" /><line x1="27" y1="100" x2="37" y2="100" />
        </g>
        <g fill="none" stroke="currentColor" strokeWidth="14" strokeLinejoin="round">
          <path d="M46 140 V60 H62 A20 20 0 0 1 62 100 H46" />
          <path d="M100 60 V140" />
          <path d="M100 100 L134 138" strokeLinecap="round" />
        </g>
        <path d="M100 100 L140 52" stroke={ponteiro} strokeWidth="13" strokeLinecap="round" fill="none" />
        <circle cx="100" cy="100" r="10" fill={ponteiro} stroke="currentColor" strokeWidth="4" />
      </svg>
      <span className="logo-texto">
        <span style={{ fontWeight: 500, opacity: 0.85 }}>Py</span>Kronos
      </span>
    </span>
  );
}
