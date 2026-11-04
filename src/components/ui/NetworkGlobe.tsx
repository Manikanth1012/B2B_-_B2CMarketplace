import { useId } from 'react'
import { RadioTower, Cloud, ShieldCheck, Smartphone, Cpu } from 'lucide-react'

const CX = 300, CY = 225, R = 170

/* A seeded generator so the "city lights" are the same on every render and in
   every screenshot. */
function lcg(seed: number) {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

/* Dots clustered into loose continents: a point is kept where a smooth field
   is high, so they read as land masses rather than noise. */
const DOTS = (() => {
  const rand = lcg(7)
  const out: { x: number; y: number; o: number }[] = []
  while (out.length < 320) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * R * 0.96
    const x = CX + Math.cos(a) * d, y = CY + Math.sin(a) * d
    const field = Math.sin(x * 0.045) + Math.cos(y * 0.06 + x * 0.02)
    if (field > 0.35) out.push({ x, y, o: 0.35 + rand() * 0.65 })
  }
  return out
})()

const NODES: [number, number][] = [
  [228, 150], [330, 118], [392, 196], [268, 252], [356, 300], [205, 318], [420, 258], [300, 190],
]
const LINKS: [number, number][] = [[0, 1], [1, 2], [0, 3], [3, 4], [2, 6], [5, 3], [7, 4], [1, 7], [6, 4]]

function arc([x1, y1]: [number, number], [x2, y2]: [number, number]): string {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  const cx = mx + (mx - CX) * 0.7, cy = my + (my - CY) * 0.7 - 18
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`
}

const RINGS = [
  { Icon: RadioTower, left: '64%', top: '2%', delay: '0s' },
  { Icon: Cloud, left: '84%', top: '20%', delay: '1.2s' },
  { Icon: ShieldCheck, left: '78%', top: '45%', delay: '2.4s' },
  { Icon: Smartphone, left: '66%', top: '68%', delay: '0.6s' },
  { Icon: Cpu, left: '84%', top: '72%', delay: '1.8s' },
]

/** The hero's connected-globe artwork. Decorative, so hidden from assistive tech. */
export function NetworkGlobe() {
  const id = useId().replace(/:/g, '')
  return (
    <div className="globe" aria-hidden>
      <svg viewBox="0 0 560 440">
        <defs>
          <radialGradient id={`${id}-fill`} cx="38%" cy="32%" r="75%">
            <stop offset="0" stopColor="#0E4C8F" />
            <stop offset="0.55" stopColor="#061B3A" />
            <stop offset="1" stopColor="#03132B" />
          </radialGradient>
          <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
            <stop offset="0.6" stopColor="#12CDE0" stopOpacity="0.28" />
            <stop offset="1" stopColor="#12CDE0" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-arc`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#168BFF" />
            <stop offset="1" stopColor="#7FE9F4" />
          </linearGradient>
        </defs>

        <circle cx={CX} cy={CY} r={R + 34} fill={`url(#${id}-glow)`} />
        <circle cx={CX} cy={CY} r={R} fill={`url(#${id}-fill)`} stroke="rgba(127,233,244,0.35)" />

        <g fill="none" stroke="rgba(127,190,255,0.16)">
          {[-60, -30, 0, 30, 60].map(lat => {
            const r = Math.cos((lat * Math.PI) / 180) * R
            return <ellipse key={`lat${lat}`} cx={CX} cy={CY + Math.sin((lat * Math.PI) / 180) * R} rx={r} ry={r * 0.22} />
          })}
          {[25, 55, 80].map(lon => (
            <ellipse key={`lon${lon}`} cx={CX} cy={CY} rx={Math.sin((lon * Math.PI) / 180) * R} ry={R} />
          ))}
        </g>

        <g fill="#7FE9F4">
          {DOTS.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={1.2} opacity={d.o} />)}
        </g>

        <g stroke={`url(#${id}-arc)`}>
          {LINKS.map(([a, b], i) => (
            <path key={i} className="globe-arc" d={arc(NODES[a], NODES[b])} style={{ animationDelay: `${i * -0.7}s` }} />
          ))}
        </g>

        {NODES.map(([x, y], i) => (
          <g key={i}>
            <circle className="globe-halo" cx={x} cy={y} r={6} fill="#12CDE0" style={{ animationDelay: `${i * 0.35}s` }} />
            <circle cx={x} cy={y} r={2.8} fill="#E6FBFE" />
          </g>
        ))}
      </svg>

      {RINGS.map(({ Icon, left, top, delay }) => (
        <span key={left + top} className="globe-ring" style={{ left, top, animationDelay: delay }}>
          <Icon strokeWidth={1.75} />
        </span>
      ))}
    </div>
  )
}
