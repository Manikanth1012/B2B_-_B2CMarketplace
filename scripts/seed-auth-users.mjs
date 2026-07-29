#!/usr/bin/env node
// Task 2 of docs/superpowers/plans/2026-07-29-real-authentication-and-rls.md.
//
// Creates one auth user per persona with the passwords DEMO_CREDENTIALS already
// documents, and stamps the persona onto app_metadata.
//
// Persona lives in app_metadata rather than the planned `profiles` table because
// creating that table is DDL, and this environment has no route to DDL (see
// docs/superpowers/plans/2026-07-29-rls-live-audit.md). app_metadata is the safe
// half of the JWT: it is writable only with the service_role key, never by the
// signed-in user, so a policy may trust it. user_metadata is user-settable and
// must not be used for this.
//
// Idempotent: re-running updates the existing user rather than erroring.
//
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-auth-users.mjs

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Need VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.')
  process.exit(1)
}

// Must stay in step with DEMO_CREDENTIALS in src/components/LoginScreen.tsx.
export const PERSONA_USERS = [
  { persona: 'consumer',   email: 'priya.raman@example.com',          password: 'demo1234' },
  { persona: 'operator',   email: 'anika.sharma@aventa.com',          password: 'operator123' },
  { persona: 'partner',    email: 'rajesh.kumar@nimbussensors.com',   password: 'partner123', partner_id: 'PTR-1004' },
  { persona: 'enterprise', email: 'vikram.shah@smartbuild.in',        password: 'enterprise123' },
]

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
}

async function listUsers() {
  const res = await fetch(`${url}/auth/v1/admin/users?per_page=200`, { headers })
  if (!res.ok) throw new Error(`list users: ${res.status} ${await res.text()}`)
  return (await res.json()).users ?? []
}

async function seed() {
  const existing = new Map((await listUsers()).map((u) => [u.email, u]))

  for (const { persona, email, password, partner_id } of PERSONA_USERS) {
    const app_metadata = { persona, ...(partner_id ? { partner_id } : {}) }
    const found = existing.get(email)

    const res = found
      ? await fetch(`${url}/auth/v1/admin/users/${found.id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ password, app_metadata, email_confirm: true }),
        })
      : await fetch(`${url}/auth/v1/admin/users`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ email, password, app_metadata, email_confirm: true }),
        })

    if (!res.ok) throw new Error(`${email}: ${res.status} ${await res.text()}`)
    const user = await res.json()
    console.log(`${found ? 'updated' : 'created'}  ${email.padEnd(38)} persona=${persona}${partner_id ? ` partner_id=${partner_id}` : ''}  id=${user.id}`)
  }
}

seed().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
