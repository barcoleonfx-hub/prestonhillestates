export function LogoMark({ className, color = '#C4972F' }: { className?: string; color?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true" style={{ color }}>
      <rect x="59" y="15" width="7" height="14" rx="1.5" fill="currentColor" />
      <path d="M50 13 L83 42 L74.5 42 L50 20.5 L25.5 42 L17 42 Z" fill="currentColor" />
      <path d="M28 44 H72 V67 H28 Z M45 51 h9 v16 h-9 Z M59.5 51 h8 v8 h-8 Z" fill="currentColor" fillRule="evenodd" />
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M18 74 C 30 89.5, 70 89.5, 82 74" strokeWidth="7.5" />
        <path d="M17.5 73 C 12.5 67.5, 13 60, 19 55.5" strokeWidth="6.5" />
        <path d="M86.5 68 l7.5 -3.5" strokeWidth="3.6" />
        <path d="M88 74.5 l8 -0.5" strokeWidth="3.6" />
      </g>
    </svg>
  )
}
