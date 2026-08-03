import { useEffect } from 'react'

/**
 * Bring a named card into view once the page holding it has actually rendered.
 *
 * The account menu sends people to a section of a long profile page — "Sign-in
 * & security" is a card two thirds of the way down, not a screen. Scrolling on
 * mount is too early: the page is still a spinner, the card does not exist yet,
 * and `getElementById` returns null. So `ready` is the page's own "I have my
 * data" flag, and the scroll waits for it.
 */
export function useAnchor(anchor: string | undefined, ready: boolean): void {
  useEffect(() => {
    if (!anchor || !ready) return
    /* One frame, so the browser has laid the card out before we ask where it
       is. Without it the scroll lands on wherever the element was mid-paint. */
    const id = requestAnimationFrame(() => {
      document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => cancelAnimationFrame(id)
  }, [anchor, ready])
}
