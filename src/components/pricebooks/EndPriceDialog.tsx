import { useEffect, useId, useState } from 'react'
import { Modal, Btn, FormField, TextArea } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import { priceText } from '../../lib/priceText'
import { endAccountPrice } from '../../lib/priceBookRepo'
import { endOn } from '../../lib/accountPrices'
import type { AccountPrice } from '../../lib/accountPrices'
import { day } from '../../lib/enterprise'

/* Ending a price (end_account_price): ends_on becomes yesterday, or the day
   before it starts for one that has not started — which withdraws it. The
   dialog says which before anything is pressed. A reason is required by the
   database; the screen asks for it in the database's words. */

/** What ending `p` today does, in one sentence. Exported for the test. */
export function endSentence(p: Pick<AccountPrice, 'starts_on'>, today: string): string {
  const e = endOn(p, today)
  if (e >= p.starts_on) return `It will end on ${day(e)}.`
  if (p.starts_on > today) return 'It has not started, so it will be withdrawn: it never applies.'
  return 'It started today, so ending it today withdraws it: it will read as never having applied, though requisitions already raised at it keep it.'
}

export function EndPriceDialog({ price, productName, today, onClose, onEnded }: {
  price: AccountPrice | null
  productName: string
  today: string
  onClose: () => void
  onEnded: () => void
}) {
  const { book } = useMarket()
  const ids = useId()
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  useEffect(() => { setReason(''); setTried(false); setBusy(false); setRefusal(null) }, [price?.id])

  if (!price) return null
  const missing = reason.trim() === ''
  const problem = missing ? 'Say why the price is ending.' : null

  async function submit() {
    setTried(true)
    if (problem || busy || !price) return
    setBusy(true); setRefusal(null)
    const r = await endAccountPrice(price.id, reason.trim())
    setBusy(false)
    if (!r.ok) { setRefusal(r.error); return }
    onEnded()
  }

  return (
    <Modal open onClose={onClose} title={`End ${price.id}`}
      footer={<>
        <Btn variant="secondary" className="pb-target" onClick={onClose}>Keep it</Btn>
        <Btn variant="danger" className="pb-target" onClick={submit} disabled={busy}>
          {busy ? 'Ending…' : 'End the price'}
        </Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <p style={{ margin: 0 }}>
          {productName} at {priceText(price.unit_price, price.currency, book?.currencies ?? [], true)}, from {day(price.starts_on)}
          {price.ends_on ? ` to ${day(price.ends_on)}` : ', open-ended'}.
        </p>
        <p style={{ margin: 0, fontWeight: 600 }}>{endSentence(price, today)}</p>
        <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
          Requisitions already raised at this price keep it.
        </p>
        <FormField label="Why it is ending" required>
          <TextArea rows={3} value={reason}
            aria-invalid={(tried && !!problem) || undefined}
            aria-describedby={tried && problem ? `${ids}-err` : undefined}
            onChange={e => setReason(e.target.value)} />
        </FormField>
        {tried && problem && (
          <div id={`${ids}-err`} style={{ color: 'var(--danger)', fontSize: 'var(--text-xs)' }}>{problem}</div>
        )}
        {refusal && (
          <div role="alert">
            <Callout tone="danger" title="The price was not ended">{refusal}</Callout>
          </div>
        )}
      </div>
    </Modal>
  )
}
