/* What a lazily loaded screen shows while its code arrives.

   Each persona's console and the heavier public and shop pages are their own
   download, so the first visit to one has a moment with nothing to draw. The
   shell around it stays on screen; only the area the screen will fill shows
   this. Quiet on purpose: a spinner and a status a screen reader announces,
   with the spin stopped for anyone who has asked for less motion. */
export function PageLoading({ label = 'Loading…', fill = false }: { label?: string; fill?: boolean }) {
  return (
    <div className={fill ? 'page-loading page-loading--fill' : 'page-loading'} role="status">
      <div className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )
}
