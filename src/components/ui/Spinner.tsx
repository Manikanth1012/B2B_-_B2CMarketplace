/* A small inline spinner. Decorative unless given a `label`, which is then
   read out. The rotation lives in ui.css and is switched off under reduced
   motion, leaving a static arc. */
export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <svg
      className="ui-spinner" width={size} height={size} viewBox="0 0 24 24" fill="none"
      aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
