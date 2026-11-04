import { Signal, Smartphone, PlayCircle, Cpu, ShieldCheck, Handshake, Package, type LucideIcon } from 'lucide-react'

/* Keyed on the category id, which is stable, rather than the free-text `icon`
   column. A shelf added later gets the generic package. */
const ICONS: Record<string, LucideIcon> = {
  consumer: Signal, device: Smartphone, content: PlayCircle,
  iot: Cpu, security: ShieldCheck, partner: Handshake,
}

export function categoryIcon(id: string): LucideIcon {
  return ICONS[id] ?? Package
}
