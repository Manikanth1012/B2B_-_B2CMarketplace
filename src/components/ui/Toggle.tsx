import { useId } from 'react'

/* An on/off switch: a button with role="switch". Space and Enter toggle it, as
   they do for any button. The label is visible and is the accessible name. */
export function Toggle({ checked, onChange, label, disabled, id }: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
  id?: string
}) {
  const auto = useId()
  const btnId = id ?? auto
  return (
    <span className="ui-toggle">
      <button
        type="button" role="switch" id={btnId} aria-checked={checked} disabled={disabled}
        className="ui-toggle__track" onClick={() => onChange(!checked)}
      >
        <span className="ui-toggle__thumb" aria-hidden />
      </button>
      <label className="ui-toggle__label" htmlFor={btnId}>{label}</label>
    </span>
  )
}
