import { fireEvent } from '@testing-library/react'

/**
 * For DOM tests: choose the option whose value is `value` in a Dropdown (the
 * shared `Select`), the way a person does — open the control, click the
 * option. It replaces `fireEvent.change(select, { target: { value } })`,
 * which drove the native select this used to be. Throws when the control is
 * disabled or has no such option, as the native change would have silently
 * done nothing and left the test to fail later for a less obvious reason.
 */
export function chooseOption(combobox: HTMLElement, value: string): void {
  if (combobox.getAttribute('role') !== 'combobox') throw new Error('chooseOption: not a combobox')
  if ((combobox as HTMLButtonElement).disabled) throw new Error('chooseOption: the control is disabled')
  if (combobox.getAttribute('aria-expanded') !== 'true') fireEvent.click(combobox)
  const list = document.getElementById(combobox.getAttribute('aria-controls') ?? '')
  const option = Array.from(list?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])
    .find(o => o.dataset.value === value)
  if (!option) throw new Error(`chooseOption: no option with value "${value}"`)
  fireEvent.click(option)
}
