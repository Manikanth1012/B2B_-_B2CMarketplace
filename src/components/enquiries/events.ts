/* A raised enquiry can come from the header, a listing or the requisition
   drawer, none of which own the Enquiries screen. They say so here and the
   screen, if it is showing, reads the book again. */
const EVENT = 'aventa:enquiries-changed'

export function enquiriesChanged(): void {
  window.dispatchEvent(new Event(EVENT))
}

export function onEnquiriesChanged(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}
