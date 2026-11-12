import { format, money, type Currency } from './money'

/* An account price written the way every other figure in the app is: from the
   operator-controlled currency row (symbol, placement, locale), never
   converted. One decimals decision for a price and the published price beside
   it, so "₹21,999" never sits next to "₹23,999.50". With no row for the code,
   the platform's own formatting stands in. */
export function priceText(n: number, currency: string, currencies: readonly Currency[], decimals: boolean): string {
  if (currencies.some(c => c.code === currency)) return format(money(n, currency), currencies, { decimals })
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency', currency, currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: decimals ? 2 : 0 })}`
  }
}

/** Whether a tag needs decimals: only when either figure has them. */
export const needsDecimals = (...n: number[]) => n.some(x => !Number.isInteger(x))
