import { useState, useEffect } from 'react'
import { Check, CreditCard, Wallet, Building2, Smartphone, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { CartItem } from '../types'
import { orderedAddresses, defaultAddress, formatAddress, type Address } from '../lib/addresses'
import { basketMoney, bySeller } from '../lib/basket'
import { useMarket } from '../lib/MarketContext'

/** `guard_shoppable()` and the RLS policies refuse in their own words on
    purpose. This strips the Postgres wrapper so the shopper reads a sentence. */
function friendly(message: string | undefined): string | null {
  if (!message) return null
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/row-level security/i.test(m)) return 'Something in your basket cannot be ordered from this account. Nothing has been charged.'
  return `${m} Nothing has been charged.`
}

interface CheckoutProps {
  cartItems: CartItem[]
  onClearCart: () => void
  onComplete: () => void
}

export function Checkout({ cartItems, onClearCart, onComplete }: CheckoutProps) {
  const [step, setStep] = useState<'details' | 'payment' | 'confirm'>('details')
  // step can be 'confirm' after order placement
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('India')
  const [paymentMethod, setPaymentMethod] = useState('card')
  const [processing, setProcessing] = useState(false)
  const [orderRef, setOrderRef] = useState('')
  /* Why the order did not go through. Every write below used to be
     fire-and-forget, so a refusal reached the customer as a confirmation. */
  const [failure, setFailure] = useState<string | null>(null)
  /* The address book. Typing the same address on every order was the whole problem —
     the saved ones are offered first and free text stays as the fallback. */
  const [addresses, setAddresses] = useState<Address[]>([])
  const [chosen, setChosen] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('consumer_addresses').select('*').then(({ data }) => {
      const rows = (data ?? []) as Address[]
      setAddresses(rows)
      const preferred = defaultAddress(rows)
      if (preferred) {
        setChosen(preferred.id)
        setAddress(preferred.line1)
        setCity(preferred.city)
      }
    })
  }, [])

  const pick = (a: Address) => {
    setChosen(a.id)
    setAddress(a.line1)
    setCity(a.city)
  }

  /* The shopper's own money and the rate where they are.
   *
   * This used to add eighteen percent — India's GST — on top of a price that
   * already includes it, and write the result into `orders` in whatever currency
   * the base product row happened to carry. So a basket showing ₹549 produced an
   * order for $7.66: the wrong number, in the wrong currency, and recorded that
   * way. Both halves come from the market now, and the split is worked back out
   * of the total rather than added to it. */
  const { book, market, currency, fmt } = useMarket()
  const shopCurrency = currency?.code ?? market?.currency ?? 'USD'
  const taxRate = Number(market?.tax_rate ?? 0)
  const taxLabel = market?.tax_label ?? 'Tax'
  const { net: subtotal, tax, total } = basketMoney(cartItems, taxRate)

  /* Who each order is against.
   *
   * `orders.seller` holds one name and settlement is per seller, so a basket
   * spanning two of them becomes two orders rather than one order with two
   * sellers written into a single column. This used to say "every basket here
   * is single-seller in practice" and join the names with a comma; the
   * catalogue-integrity suite caught the result the first time anybody actually
   * filled a mixed basket — "Aventa Telecom, ClearVault Cloud" is not a seller.
   */
  const groups = bySeller(cartItems)

  const handleSubmit = async () => {
    setProcessing(true)
    setFailure(null)

    const stamp = Date.now().toString().slice(-8)
    const placed: { id: string; ref: string }[] = []
    /* Everything or nothing. A basket that produced one order and then failed on
       the second would leave the shopper charged for half a purchase with no way
       to tell which half. */
    const undo = async () => {
      for (const o of placed) await supabase.from('orders').delete().eq('id', o.id)
    }

    for (const [n, group] of groups.entries()) {
      const ref = groups.length === 1 ? `ORD-${stamp}` : `ORD-${stamp}-${n + 1}`
      const { net, tax: groupTax, total: groupTotal } = basketMoney(group.lines, taxRate)

      const { data: order, error: orderErr } = await supabase.from('orders').insert({
        order_ref: ref,
        seller: group.seller || null,
        status: 'placed',
        total: groupTotal,
        subtotal: net,
        tax: groupTax,
        discount: 0,
        /* Frozen with the order. A reprice tomorrow must not change what somebody
           paid today, and `guard_order_currency` refuses a currency the customer
           is not billed in. */
        currency: shopCurrency,
        market: market?.code ?? null,
        tax_rate: taxRate,
        payment_method: paymentMethod,
        buyer_name: name,
        buyer_email: email,
        shipping_address: { address, city, country },
      }).select().single()

      if (orderErr || !order) {
        await undo()
        setProcessing(false)
        setFailure(friendly(orderErr?.message) ?? 'The order could not be placed. Nothing has been charged.')
        return
      }
      placed.push({ id: order.id, ref })

      const orderItems = group.lines.map((item) => ({
        order_id: order.id,
        product_id: item.product_id,
        product_name: item.product?.name || '',
        price: item.product?.price || 0,
        quantity: item.quantity,
        fulfil: item.product?.fulfil || 'instant',
        status: 'placed',
      }))
      const { error: itemsErr } = await supabase.from('order_items').insert(orderItems)

      /* A refused line — a shelf this shopper cannot buy from, say — used to be
         swallowed, and the customer was shown a confirmation for an order with
         nothing in it. The orders go back rather than standing empty. */
      if (itemsErr) {
        await undo()
        setProcessing(false)
        setFailure(friendly(itemsErr.message) ?? 'Something in your basket could not be ordered. Nothing has been charged.')
        return
      }

      // Create subscriptions for monthly products
      const subs = group.lines
        .filter((item) => item.product?.model === 'monthly')
        .map((item) => ({
          ref,
          product_id: item.product_id,
          product_name: item.product?.name || '',
          seller: item.product?.seller ?? null,
          status: 'active',
          auto_renew: true,
          next_renewal: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
          price: item.product?.price || 0,
          /* NOT NULL since subscriptions got a currency, and guarded against the
             customer's bills — so this insert was failing outright, not merely
             recording the wrong mark. */
          currency: shopCurrency,
        }))
      if (subs.length > 0) {
        await supabase.from('subscriptions').insert(subs)
      }
    }

    await onClearCart()
    setOrderRef(placed.map(o => o.ref).join(' · '))
    setProcessing(false)
    setStep('confirm')
  }

  if (cartItems.length === 0 && step !== 'confirm') {
    return (
      <section style={{ padding: '64px 0' }}>
        <div className="container" style={{ textAlign: 'center', maxWidth: '400px', margin: '0 auto' }}>
          <h2 style={{ marginBottom: '12px' }}>Your cart is empty</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
            Add some products before checking out.
          </p>
          <button onClick={onComplete} className="btn btn-primary">Browse Marketplace</button>
        </div>
      </section>
    )
  }

  if (step === 'confirm') {
    return (
      <section style={{ padding: '64px 0' }}>
        <div className="container" style={{ maxWidth: '480px', textAlign: 'center' }}>
          <div style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: 'var(--success-bg)',
            color: 'var(--success)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            <Check size={32} />
          </div>
          <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, marginBottom: '12px' }}>
            Order confirmed!
          </h1>
          {/* Plural when the basket spanned sellers, because it produced one
              order each and both references are real. Saying "your order
              reference" and showing two is how somebody quotes the wrong one at
              support. */}
          <p style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>
            {orderRef.includes(' · ')
              ? 'Your basket covered more than one seller, so it was placed as separate orders'
              : 'Your order reference is'}
          </p>
          <p style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--brand-accent-dark)', marginBottom: '24px' }}>
            {orderRef}
          </p>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>
            We've sent a confirmation to {email}. Digital services will activate immediately, and physical items will ship within 2-3 business days.
          </p>
          <button onClick={onComplete} className="btn btn-primary btn-lg">
            Continue Shopping
          </button>
        </div>
      </section>
    )
  }

  return (
    <section style={{ padding: '32px 0 64px' }}>
      <div className="container" style={{ maxWidth: '900px' }}>
        <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, marginBottom: '32px' }}>Checkout</h1>

        {/* Steps indicator */}
        <div style={{ display: 'flex', gap: '0', marginBottom: '32px' }}>
          {['details', 'payment', 'confirm'].map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < 2 ? 1 : 'none' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: (step === s) || (step as string === 'confirm' && s !== 'confirm') ? 'var(--brand-accent)' : 'var(--gray-200)',
                color: (step === s) || (step as string === 'confirm' && s !== 'confirm') ? 'white' : 'var(--text-tertiary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'var(--text-sm)',
                fontWeight: 700,
              }}>
                {i + 1}
              </div>
              {i < 2 && (
                <div style={{ flex: 1, height: '2px', background: 'var(--gray-200)', margin: '0 8px' }} />
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '32px' }}>
          {/* Form */}
          <div>
            {step === 'details' && (
              <div className="fade-in">
                <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, marginBottom: '20px' }}>Delivery details</h2>
                {addresses.length > 0 && (
                  <div style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {orderedAddresses(addresses).map(a => (
                      <button
                        key={a.id}
                        onClick={() => pick(a)}
                        aria-pressed={chosen === a.id}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: '10px', textAlign: 'left',
                          padding: '12px 14px', borderRadius: 'var(--radius)', cursor: 'pointer',
                          border: `1px solid ${chosen === a.id ? 'var(--brand-accent-dark)' : 'var(--border)'}`,
                          background: chosen === a.id ? 'rgba(0,166,166,0.06)' : 'white',
                        }}
                      >
                        <MapPin size={15} style={{ marginTop: '2px', color: chosen === a.id ? 'var(--brand-accent-dark)' : 'var(--text-tertiary)', flexShrink: 0 }} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 700 }}>
                            {a.label}{a.is_default && <span style={{ fontWeight: 500, color: 'var(--text-tertiary)' }}> · default</span>}
                          </span>
                          <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                            {formatAddress(a)}
                          </span>
                          {a.notes && (
                            <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                              {a.notes}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: '2px 0 0' }}>
                      Or type a different address below. Manage saved addresses in My details.
                    </p>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <Input label="Full name" value={name} onChange={setName} required />
                  <Input label="Email" value={email} onChange={setEmail} type="email" required />
                  <Input label="Address" value={address} onChange={(v) => { setAddress(v); setChosen(null) }} full />
                  <Input label="City" value={city} onChange={(v) => { setCity(v); setChosen(null) }} />
                  <div>
                    <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500, marginBottom: '6px', display: 'block' }}>Country</label>
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      style={inputStyle}
                    >
                      {/* The markets the marketplace actually trades in, from
                          `markets` — not a hard-coded six. Singapore, Germany
                          and the UK were on this list and are not markets: an
                          order addressed to any of them had a delivery country
                          nothing ships to, no tax rate, and no entity to bill
                          from. */}
                      {/* Until the book loads there is nothing to offer; keep
                          the current value as the only option so the field is
                          never momentarily blank with a value set. */}
                      {book.markets.length === 0
                        ? <option>{country}</option>
                        : book.markets.map(m => <option key={m.code}>{m.name}</option>)}
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => setStep('payment')}
                  disabled={!name || !email}
                  className="btn btn-primary btn-lg"
                  style={{ marginTop: '24px' }}
                >
                  Continue to Payment
                </button>
              </div>
            )}

            {step === 'payment' && (
              <div className="fade-in">
                <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 600, marginBottom: '20px' }}>Payment method</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {[
                    { id: 'card', label: 'Credit / Debit Card', icon: <CreditCard size={20} />, desc: 'Visa, Mastercard, Amex' },
                    { id: 'wallet', label: 'Mobile Wallet', icon: <Wallet size={20} />, desc: 'PayTM, Airtel Money, M-Pesa' },
                    { id: 'carrier', label: 'Carrier Billing', icon: <Smartphone size={20} />, desc: 'Add to your telecom bill' },
                    { id: 'bank', label: 'Net Banking', icon: <Building2 size={20} />, desc: 'Direct bank transfer' },
                  ].map((method) => (
                    <button
                      key={method.id}
                      onClick={() => setPaymentMethod(method.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                        padding: '16px',
                        borderRadius: 'var(--radius)',
                        border: paymentMethod === method.id ? '2px solid var(--brand-accent)' : '1px solid var(--border)',
                        background: paymentMethod === method.id ? 'rgba(0,166,166,0.05)' : 'white',
                        transition: 'all 150ms ease',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ color: paymentMethod === method.id ? 'var(--brand-accent)' : 'var(--text-tertiary)' }}>
                        {method.icon}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{method.label}</div>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{method.desc}</div>
                      </div>
                      <div style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        border: paymentMethod === method.id ? '6px solid var(--brand-accent)' : '2px solid var(--gray-300)',
                      }} />
                    </button>
                  ))}
                </div>
                {failure && (
                  <div role="alert" style={{
                    marginTop: '20px', padding: '12px 14px', borderRadius: 'var(--radius)',
                    background: 'var(--danger-bg)', color: 'var(--danger)',
                    fontSize: 'var(--text-sm)', fontWeight: 600,
                  }}>
                    {failure}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                  <button onClick={() => setStep('details')} className="btn btn-secondary btn-lg">
                    Back
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={processing}
                    className="btn btn-primary btn-lg"
                    style={{ flex: 1 }}
                  >
                    {processing ? 'Processing...' : `Pay ${fmt(total)}`}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Order summary */}
          <div style={{
            background: 'var(--bg-alt)',
            borderRadius: 'var(--radius-lg)',
            padding: '20px',
            border: '1px solid var(--border)',
            height: 'fit-content',
          }}>
            <h3 style={{ fontWeight: 700, marginBottom: '16px' }}>Order Summary</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
              {cartItems.map((item) => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                  <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '180px' }}>
                    {item.product?.name} × {item.quantity}
                  </span>
                  <span style={{ fontWeight: 500 }}>{fmt((item.product?.price || 0) * item.quantity)}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Before {taxLabel.toLowerCase()}</span>
                <span>{fmt(subtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{taxLabel} ({taxRate}%)</span>
                <span>{fmt(tax)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid var(--border)', marginTop: '4px' }}>
                <span style={{ fontWeight: 700 }}>Total</span>
                <span style={{ fontWeight: 800, fontSize: 'var(--text-lg)' }}>{fmt(total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  background: 'white',
  fontSize: 'var(--text-sm)',
  outline: 'none',
}

function Input({ label, value, onChange, type = 'text', required, full }: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
  full?: boolean
}) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : undefined }}>
      <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500, marginBottom: '6px', display: 'block' }}>
        {label}{required && ' *'}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
    </div>
  )
}
