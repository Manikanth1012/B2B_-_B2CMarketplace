import { useState, useEffect, useCallback } from 'react'
import { WalletCard } from '../WalletCard'
import { Callout } from '../OnboardingJourney'
import { loadAccount } from '../../lib/enterpriseRepo'
import type { AccountBook } from '../../lib/enterpriseRepo'

/* The company's wallet.
 *
 * It existed in the database and nowhere in this persona. `wallets` has held
 * business rows since it was seeded — Brightline and Harbourpoint both have
 * one — but the only way in was `user_id = auth.uid()`, which is a person's
 * link and not a company's, so a business could not read its own balance even
 * where one was sitting there. The demo account had no wallet at all, which is
 * why nobody noticed the screen was missing rather than empty.
 *
 * The panel itself is the customer's, unchanged: same two pots, same statement,
 * same rule about which pot is spent first. What differs is who the money
 * belongs to, and that changes the prose rather than the arithmetic.
 */

export function EnterpriseWallet() {
  const [account, setAccount] = useState<AccountBook | null>(null)
  const reload = useCallback(async () => setAccount(await loadAccount()), [])
  useEffect(() => { void reload() }, [reload])

  const me = account?.me
  const role = account?.roles.find(r => r.id === me?.role)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Wallet</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          Money the marketplace is holding for {account?.account?.company ?? 'this account'}, and every
          movement of it.
        </p>
      </div>

      <WalletCard
        whose="company"
        title="The company wallet"
        intro={
          <Callout tone="info" title="This is the company's money, not a credit line">
            A wallet is a balance the marketplace holds and owes back — it is not a limit to draw against
            and it is not the account's credit position, which is on Billing. What is topped up here is
            returnable to the account's own instrument; what arrives as reward credit or goodwill is not,
            and the two are kept apart below for exactly that reason.
            {role && !role.can_view_billing && (
              <> Your role can see the balance but not the account's billing, so the invoices these
              movements settle against are not shown to you.</>
            )}
          </Callout>
        }
        onChanged={reload}
      />
    </div>
  )
}
