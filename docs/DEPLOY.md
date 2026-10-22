# Deploying ShieldPay live on Vercel

Vercel's disk is read-only and wiped between requests, so ShieldPay keeps its data (day keys, orders, spent vouchers) in a Redis database from the Vercel Marketplace (Upstash). The free tier is enough.

## 1. Put the code on GitHub
Push this folder to your GitHub repository (the `public/` folder was renamed `web/`; delete the old `public/` folder from the repo).

## 2. Import into Vercel
1. vercel.com → **Add New… → Project** → pick the `shieldpay` repository → **Import**.
2. Leave every build setting as it is (the `vercel.json` file configures it). Do **not** deploy yet; first add the database and settings below, or the first deploy will show "not configured" (harmless, you can redeploy).

## 3. Add the database
Project → **Storage** (or Marketplace) → **Upstash → Redis** → create (free plan, any region) → **Connect to project**. Vercel adds the database variables for you (`KV_REST_API_URL` and `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_*`; a custom prefix is also accepted).

## 4. Add the settings
Project → **Settings → Environment Variables**:

| Name | Value |
|---|---|
| `SHIELDPAY_ADDRESS` | your **testnet** `utest1…` address (never a mainnet address on a public demo) |
| `SHIELDPAY_ADMIN_TOKEN` | a long secret, 12+ characters (the merchant key; keep it private) |
| `SHIELDPAY_KEY_SECRET` | another long secret; it encrypts the signing keys in the database. Do not change it later or old vouchers stop working |
| `SHIELDPAY_DEMO` | `1` (turns on the public `/demo` page with the simulated payment button) |
| `SHIELDPAY_COOLDOWN_DAYS` | `0` (demo only: lets judges spend a voucher the same day) |
| `SHIELDPAY_NAME` | e.g. `ShieldPay Demo Cafe` |
| `SHIELDPAY_VOUCHER_NAME` | e.g. `meal` |
| `SHIELDPAY_VOUCHER_PRICE` | e.g. `0.0001` |

## 5. Deploy and check
**Deployments → Redeploy** (after adding variables). Then open:
- `https://<your-project>.vercel.app/demo` and do the whole flow: buy → simulate payment → wallet → redeem → redeem again (refused).
- `/` is the merchant page (unlock with your admin token).

HTTPS is automatic, which the browser cryptography needs.

## If something fails
| Symptom | Cause |
|---|---|
| "ShieldPay is not configured: …" | a setting from step 3 or 4 is missing; add it and redeploy |
| `/demo` is a 404 | `SHIELDPAY_DEMO` is not `1`, or you did not redeploy |
| "Server error" on every action | database not connected, or its variables are missing |

## Real use vs demo
For a real shop: `SHIELDPAY_DEMO` off, `SHIELDPAY_COOLDOWN_DAYS` at 1 or more, your own shielded mainnet address. Payment confirmation is still manual (*Mark paid*) in this version.
