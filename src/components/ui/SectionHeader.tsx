import { ArrowRight } from 'lucide-react'

export function SectionHeader({ title, subtitle, action, id }: {
  title: string
  subtitle?: string
  action?: { label: string; onClick: () => void }
  id?: string
}) {
  return (
    <div className="ui-section-header">
      <div>
        <h2 className="ui-section-title" id={id}>{title}</h2>
        {subtitle && <p className="ui-section-sub">{subtitle}</p>}
      </div>
      {action && (
        <button className="ui-link" onClick={action.onClick}>
          {action.label} <ArrowRight size={14} aria-hidden />
        </button>
      )}
    </div>
  )
}
