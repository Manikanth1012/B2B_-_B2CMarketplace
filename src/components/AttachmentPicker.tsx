import { useRef } from 'react'
import { Paperclip, Trash2, FileText, Image as ImageIcon } from 'lucide-react'
import {
  ACCEPT_ATTRIBUTE, MAX_FILES, acceptedLabel, validateFile, guessKind, sizeOf,
} from '../lib/attachments'

/* Choosing files, before there is anything to attach them to.
 *
 * Every one of these forms creates its case and its files in the same submit —
 * you cannot attach a photograph to a refund request that does not exist yet —
 * so the picker holds `File` objects and the form uploads them once the case
 * has an id. That ordering is why this is a controlled list rather than an
 * uploader.
 *
 * It exists because the markup was written once inside `RaiseTicketModal` and
 * the four other forms that ask for evidence got a text box instead. One of
 * them, the refund request, had a placeholder reading "A photograph or a fault
 * report" above a single-line field — so a seller deciding the refund read the
 * words and was never sent the photograph.
 */

export function AttachmentPicker({
  files, onChange, disabled, label, hint, onError,
}: {
  files: File[]
  onChange: (files: File[]) => void
  disabled?: boolean
  /* The forms differ in what they are asking for — "anything that backs it up"
     on a refund, "a photo or document" on a ticket — so the wording is the
     caller's and only the mechanism is shared. */
  label?: string
  hint?: string
  /* Refusals go to the form's own error line rather than a toast, so they sit
     next to the field that caused them. Called with '' to clear. */
  onError?: (reason: string) => void
}) {
  const picker = useRef<HTMLInputElement>(null)

  const pick = (chosen: FileList | null) => {
    if (!chosen) return
    onError?.('')
    const next = [...files]
    for (const f of Array.from(chosen)) {
      /* Checked against what is already staged, not just the one file, so the
         count and the duplicate check mean something. */
      const check = validateFile(f, next.map(x => ({ filename: x.name, bytes: x.size })))
      if (!check.ok) { onError?.(check.reason); break }
      next.push(f)
    }
    onChange(next)
    /* Cleared so choosing the same file twice in a row still fires a change. */
    if (picker.current) picker.current.value = ''
  }

  return (
    <div>
      <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '8px' }}>
        {label ?? 'Add a photo or document'}{' '}
        <span style={{ fontWeight: 400, color: 'var(--text-tertiary)' }}>— optional</span>
      </label>

      <input
        ref={picker}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        onChange={e => pick(e.target.files)}
        style={{ display: 'none' }}
      />

      {files.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '0 0 10px', padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 10px', borderRadius: 'var(--radius)',
              background: 'var(--bg-alt)', border: '1px solid var(--border-light)',
            }}>
              <span style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
                {f.type.startsWith('image/') ? <ImageIcon size={15} /> : <FileText size={15} />}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {sizeOf(f.size)} · {guessKind(f)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, n) => n !== i))}
                aria-label={`Remove ${f.name}`}
                disabled={disabled}
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', padding: '2px' }}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => picker.current?.click()}
        disabled={disabled || files.length >= MAX_FILES}
        className="btn btn-secondary btn-sm"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
      >
        <Paperclip size={14} />
        {files.length ? 'Add another' : 'Choose a file'}
      </button>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '6px' }}>
        {hint ?? `${acceptedLabel()}, up to 10 MB each and ${MAX_FILES} in total.`}
        {files.length >= MAX_FILES && ' That is the lot — remove one to add another.'}
      </div>
    </div>
  )
}
