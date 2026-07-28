import { useState } from 'react'
import { Check, CreditCard, Wallet, Building2, Smartphone } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { CartItem } from '../types'

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

  const subtotal = cartItems.reduce((sum, item) => sum + (item.product?.price || 0) * item.quantity, 0)
  const tax = subtotal * 0.18
  const total = subtotal + tax

  const handleSubmit = async () => {
    setProcessing(true)
    const ref = `ORD-${Date.now().toString().slice(-8)}`
    setOrderRef(ref)

    const { data: order } = await supabase.from('orders').insert({
      order_ref: ref,
      status: 'placed',
      total,
      subtotal,
      tax,
      discount: 0,
      payment_method: paymentMethod,
      buyer_name: name,
      buyer_email: email,
      shipping_address: { address, city, country },
    }).select().single()

    if (order) {
      const orderItems = cartItems.map((item) => ({
        order_id: order.id,
        product_id: item.product_id,
        product_name: item.product?.name || '',
        price: item.product?.price || 0,
        quantity: item.quantity,
        fulfil: item.product?.fulfil || 'instant',
        status: 'placed',
      }))
      await supabase.from('order_items').insert(orderItems)

      // Create subscriptions for monthly products
      const subs = cartItems
        .filter((item) => item.product?.model === 'monthly')
        .map((item) => ({
          product_id: item.product_id,
          product_name: item.product?.name || '',
          status: 'active',
          auto_renew: true,
          next_renewal: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
          price: item.product?.price || 0,
        }))
      if (subs.length > 0) {
        await supabase.from('subscriptions').insert(subs)
      }

      await onClearCart()
    }

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
          <p style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>
            Your order reference is
          </p>
          <p style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--brand-accent)', marginBottom: '24px' }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <Input label="Full name" value={name} onChange={setName} required />
                  <Input label="Email" value={email} onChange={setEmail} type="email" required />
                  <Input label="Address" value={address} onChange={setAddress} full />
                  <Input label="City" value={city} onChange={setCity} />
                  <div>
                    <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500, marginBottom: '6px', display: 'block' }}>Country</label>
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      style={inputStyle}
                    >
                      <option>India</option>
                      <option>UAE</option>
                      <option>Kenya</option>
                      <option>Singapore</option>
                      <option>Germany</option>
                      <option>UK</option>
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
                    {processing ? 'Processing...' : `Pay $${total.toFixed(2)}`}
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
                  <span style={{ fontWeight: 500 }}>${((item.product?.price || 0) * item.quantity).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Tax (18%)</span>
                <span>${tax.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', borderTop: '1px solid var(--border)', marginTop: '4px' }}>
                <span style={{ fontWeight: 700 }}>Total</span>
                <span style={{ fontWeight: 800, fontSize: 'var(--text-lg)' }}>${total.toFixed(2)}</span>
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
