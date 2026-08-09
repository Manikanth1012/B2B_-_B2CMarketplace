/* Reading the contract register, and the three acts that change it.
 *
 * The standing of each contract comes from `account_contract` rather than being
 * computed here, for the same reason the credit position does: "expiring" is a
 * fact about two dates and the clock, and the database is where the guard reads
 * it. Two evaluations that agree today are one edit away from not agreeing, so
 * the module has `standingOf` for the cases a screen needs to ask about another
 * date, and the integration test reconciles the two.
 *
 * Renewing goes through a function because it is two writes that must not half
 * happen: the old agreement is superseded and the new one is created pointing
 * back at it. A client that did those separately would, on a dropped
 * connection, leave an account with either two live agreements or none.
 */

import { supabase } from './supabase'
import type { Contract, Amendment } from './contracts'

const NUM = ['term_value', 'days_left', 'notice_days']

const num = <T,>(row: T): T => {
  const out = { ...row } as Record<string, unknown>
  for (const k of NUM) if (out[k] != null) out[k] = Number(out[k])
  return out as T
}

export interface ContractBook {
  contracts: Contract[]
  amendments: Amendment[]
  /* The accounts, so the register can say who has nothing at all. A contract
     table alone cannot report the absence of a contract. */
  accounts: { id: string; company: string; status: string; terms: string; currency: string }[]
  /* What each account has actually been invoiced across its current term,
     against what it said it would spend. Keyed by contract. */
  spentByContract: Record<string, number>
  loadError?: string
}

export async function loadContractBook(): Promise<ContractBook> {
  const [c, m, a, i] = await Promise.all([
    supabase.from('account_contract').select('*').order('account_id').order('starts_on'),
    supabase.from('enterprise_contract_amendment').select('*').order('effective_on'),
    supabase.from('enterprise_accounts').select('id,company,status,terms,currency'),
    supabase.from('enterprise_invoices').select('account_id,total,currency,issued,status'),
  ])

  const errors: string[] = []
  if (c.error) errors.push(`the agreements: ${c.error.message}`)
  if (m.error) errors.push(`the amendments: ${m.error.message}`)
  if (a.error) errors.push(`the accounts: ${a.error.message}`)

  const contracts = ((c.data ?? []) as Contract[]).map(num)

  /* Invoiced inside the term, in the term's own currency. An invoice raised in
     one of the market's other currencies is deliberately left out rather than
     converted: the stated term value is one figure in one currency, and mixing
     a converted total into it would make the comparison depend on today's rate.
     What is left out is visible on the screen as the count. */
  const spentByContract: Record<string, number> = {}
  const invoices = (i.data ?? []) as
    { account_id: string; total: string; currency: string; issued: string; status: string }[]
  for (const con of contracts) {
    const inTerm = invoices.filter(v =>
      v.account_id === con.account_id
      && v.currency === con.currency
      && v.status !== 'credited'
      && v.issued >= con.starts_on && v.issued <= con.ends_on)
    spentByContract[con.id] =
      Math.round(inTerm.reduce((t, v) => t + Number(v.total), 0) * 100) / 100
  }

  return {
    contracts,
    amendments: (m.data ?? []) as Amendment[],
    accounts: (a.data ?? []) as ContractBook['accounts'],
    spentByContract,
    ...(errors.length ? { loadError: `Some of the register did not load (${errors.join('; ')}).` } : {}),
  }
}

/** One account's own agreement and its amendments, for the buyer's own screen. */
export async function loadMyContract(): Promise<{
  contract: Contract | null; history: Contract[]; amendments: Amendment[]; loadError?: string
}> {
  const [c, m] = await Promise.all([
    supabase.from('account_contract').select('*').order('starts_on', { ascending: false }),
    supabase.from('enterprise_contract_amendment').select('*').order('effective_on'),
  ])
  if (c.error) {
    return { contract: null, history: [], amendments: [], loadError: `Your agreement did not load (${c.error.message}).` }
  }
  const all = ((c.data ?? []) as Contract[]).map(num)
  const live = all.find(x => x.in_force) ?? null
  return {
    contract: live,
    history: all.filter(x => x.id !== live?.id),
    amendments: ((m.data ?? []) as Amendment[])
      .filter(x => all.some(con => con.id === x.contract_id)),
  }
}

export interface Saved { ok: boolean; why?: string; id?: string }

/**
 * Renew an agreement into a new term.
 *
 * One call, because it is two writes that must both land: the old one is
 * superseded and the new one points back at it. Done separately from a client,
 * a dropped connection between them leaves the account with two agreements in
 * force or with none — and "none" means every purchase is refused until somebody
 * notices.
 */
export async function renewContract(
  from: Contract,
  next: {
    id: string; signed_on: string; starts_on: string; ends_on: string
    terms: string; auto_renew: boolean; notice_days: number
    term_value: number | null; signed_by: string; signed_title: string
    countersigned_by: string; title: string; note?: string
  },
): Promise<Saved> {
  if (next.starts_on <= from.ends_on && next.starts_on >= from.starts_on) {
    return {
      ok: false,
      why: `${from.id} runs to ${from.ends_on}. A new term starting ${next.starts_on} would `
        + 'overlap it, and two agreements in force at once is two sets of payment terms.',
    }
  }
  const { data, error } = await supabase.rpc('renew_contract', {
    p_from: from.id,
    p_id: next.id,
    p_signed_on: next.signed_on,
    p_starts_on: next.starts_on,
    p_ends_on: next.ends_on,
    p_terms: next.terms,
    p_auto_renew: next.auto_renew,
    p_notice_days: next.notice_days,
    p_term_value: next.term_value,
    p_signed_by: next.signed_by,
    p_signed_title: next.signed_title,
    p_countersigned_by: next.countersigned_by,
    p_title: next.title,
    p_note: next.note ?? null,
  })
  if (error) return { ok: false, why: error.message }
  const r = (data ?? {}) as Saved
  return { ok: r.ok === true, why: r.why, id: r.id }
}

/**
 * End an agreement before its term is up.
 *
 * The reason is not optional. An account that suddenly cannot buy will ring
 * somebody, and "terminated" with no recorded why leaves whoever answers with
 * nothing to say.
 */
export async function terminateContract(
  id: string, on: string, why: string,
): Promise<Saved> {
  if (!why.trim()) {
    return { ok: false, why: 'Say why it is being ended. Whoever takes the call from the account needs it.' }
  }
  const { data, error } = await supabase.rpc('terminate_contract',
    { p_id: id, p_on: on, p_why: why.trim() })
  if (error) return { ok: false, why: error.message }
  const r = (data ?? {}) as Saved
  return { ok: r.ok === true, why: r.why }
}

/** Record a change to an agreement already in force. */
export async function addAmendment(
  a: {
    contract_id: string; kind: string; signed_on: string; effective_on: string
    was: string; now_says: string; why: string; signed_by: string
    /* The new payment terms, for a `terms` amendment, as a value rather than
       as prose to be parsed out of `now_says`. The first version derived it
       with a regular expression and turned "Payment terms: Net 45 from date of
       invoice." into "Net 45 from date of invoice", which then became the
       account's billing terms — a whole sentence where every other account
       reads "Net 45". Asking for the value is one field; guessing it is a
       string that quietly grows. */
    terms?: string
  },
): Promise<Saved> {
  const n = await supabase.from('enterprise_contract_amendment')
    .select('id').eq('contract_id', a.contract_id)
  const id = `${a.contract_id}-A${((n.data ?? []).length) + 1}`

  const { error } = await supabase.from('enterprise_contract_amendment').insert({
    id,
    contract_id: a.contract_id,
    kind: a.kind,
    signed_on: a.signed_on,
    effective_on: a.effective_on,
    was: a.was.trim(),
    now_says: a.now_says.trim(),
    why: a.why.trim(),
    signed_by: a.signed_by.trim(),
  })
  if (error) return { ok: false, why: error.message }

  /* An amendment that changes the payment terms has to change them. Recording
     the paper and leaving the agreement reading the old wording is two records
     of one change, which is how Harbourpoint would have ended up on Net 30 in
     the database and Net 15 on the document. The contract's trigger carries it
     on to the account and billing rows from there. */
  if (a.kind === 'terms' && a.terms?.trim()) {
    const { error: e2 } = await supabase.from('enterprise_contract')
      .update({ terms: a.terms.trim() }).eq('id', a.contract_id)
    if (e2) {
      return { ok: false, why: `The amendment was recorded but the agreement still reads the old terms (${e2.message}).` }
    }
  }
  return { ok: true, id }
}

/**
 * A link to the signed copy, good for a few minutes.
 *
 * The bucket is private, so a path is not a URL. Returning null rather than a
 * broken link when there is nothing there — a download button that produces a
 * 404 is worse than one that is not offered.
 */
export async function signedCopyUrl(path: string | null): Promise<string | null> {
  if (!path) return null
  const { data, error } = await supabase.storage.from('evidence').createSignedUrl(path, 300)
  return error ? null : (data?.signedUrl ?? null)
}
