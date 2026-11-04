/* The sellers actually trading here, as wordmarks set in type. Not third-party
   logos: showing a brand implies a partnership, and we hold no approved marks. */
export function EcosystemStrip({ sellers }: { sellers: readonly string[] }) {
  if (sellers.length === 0) return null
  return (
    <section className="container home-band" aria-label="Sellers on Aventa">
      <div className="eco-strip">
        <span className="eco-strip__label">Sellers on Aventa</span>
        <ul className="eco-strip__list">
          {sellers.map(s => <li key={s} className="eco-strip__item">{s}</li>)}
        </ul>
      </div>
    </section>
  )
}
