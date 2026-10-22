# ShieldPay

**Private Zcash checkout with unlinkable vouchers.** Zecathon entry, *Shielded Payments* track.

Shielded Zcash hides who paid whom, but a shop's loyalty card or prepaid pass quietly rebuilds the link: buy a voucher, redeem it later, and the shop knows it was you. ShieldPay breaks that link with blind signatures. You pay privately in ZEC, your phone creates voucher codes the shop signs *without seeing them*, and when you redeem one later the shop can verify it is genuine but cannot tell which purchase it came from.

## Status: what is real and what is simulated

| Part | Status |
|---|---|
| Blind-signature voucher issuing, redeeming, double-spend protection, cooldown, expiry | **Real**, covered by automated tests (`npm test`) and checked in a real browser |
| Payment request (ZIP-321 QR and link with order-ref memo) | **Real.** Scanned with the Zkool wallet on testnet: it filled in the correct address, amount (0.0001) and memo |
| Sending the payment on testnet | **Not working yet.** Zkool built the transaction but the testnet rejected it with "incorrect consensus branch id"; the cause was not determined (wallet/testnet version mismatch suspected, not confirmed) |
| Payment confirmation | **Simulated in the demo.** The merchant taps *Mark paid*. Automatic detection needs a payment watcher; a signed webhook for one is planned |

The demo video states this openly. Nothing in the voucher flow depends on the simulated step: once an order is marked paid, issuing and redeeming vouchers is real code.

**Live demo:** _add your Vercel link here_ (`/demo` page, testnet, payment simulated)

**Demo video:** _add link here_

## How it works

1. **Pay.** The merchant creates an order. ShieldPay shows a ZIP-321 payment request (QR and `zcash:` link) with a unique order ref in the encrypted memo. The customer pays from any shielded wallet.
2. **Get vouchers.** After the merchant confirms the payment, the customer's browser creates secrets, blinds them, and asks the shop to sign. The browser unblinds the signatures and keeps the vouchers in a local wallet. The shop never sees the secrets.
3. **Redeem.** Later the customer shows a voucher (QR or code). The shop checks the signature, checks the voucher was not already used, and accepts it.

The cryptography is Chaum RSA blind signatures with a full-domain hash (2048-bit), in `lib/blind.js`. It runs in both the browser (WebCrypto) and Node. It is the classic construction, **not** RFC 9474, and it has not had an external audit.

### Defences against timing and linking

| Risk | Defence |
|---|---|
| Matching purchase time to redemption time | **Epoch keys**: a fresh signing key per UTC day, so a voucher only reveals its day |
| Buy-and-redeem within seconds | **Cooldown**: vouchers become usable `SHIELDPAY_COOLDOWN_DAYS` (default 1) days after purchase |
| One-purchase-one-redemption matching | **Bundles**: buy up to 20 and spend them one at a time |
| Small crowds make hiding meaningless | **Anonymity set** is counted and shown; the shop is warned when too few purchases were made that day |
| A shop serving each customer a different key to tag them | **Key fingerprint** shown in the wallet; every customer must see the same one |
| Double spending | Spent-secret hashes are stored; vouchers expire after `SHIELDPAY_VALID_DAYS` (default 30) |

The tests include a mathematical check that every possible pairing of purchase and redemption is equally consistent with what the shop saw.

## Run it

Needs Node 18+. No `npm install`: there are no dependencies.

```sh
export SHIELDPAY_ADDRESS="u1..."            # your shielded / unified receiving address
export SHIELDPAY_ADMIN_TOKEN="a-long-secret-key"
export SHIELDPAY_NAME="My Shop"             # optional
export SHIELDPAY_VOUCHER_NAME="meal"        # optional
export SHIELDPAY_VOUCHER_PRICE="0.01"       # ZEC per voucher
npm start                                   # http://localhost:3000
npm test
```

- `/` merchant page: create payment or voucher orders, mark paid, redeem vouchers.
- `/demo` (only when `SHIELDPAY_DEMO=1`) public try-it page with a *simulate payment* button, for testnet demos.
- `/wallet` customer voucher wallet (stored in the customer's browser).
- Browsers only allow the cryptography on **https or localhost**, so serve it behind HTTPS in production.
- `SHIELDPAY_COOLDOWN_DAYS=0` allows same-day redemption. Use it only for demos: it makes timing linkable.
- Testing guide: [docs/TESTING.md](docs/TESTING.md). Live hosting on Vercel: [docs/DEPLOY.md](docs/DEPLOY.md).
- On Vercel the data lives in Redis (Upstash). The signing keys are encrypted before they are stored (`SHIELDPAY_KEY_SECRET`).

## Privacy design

- Transparent addresses (`t1`/`t3`) are rejected, so payments cannot leak publicly.
- No request logging, cookies, analytics, third-party scripts, fonts or images. A strict CSP is enforced. The QR generator is in-repo (`lib/qr.js`).
- Orders store only ref, amount, status and times. No payer data.
- Viewing keys never touch the server.
- Customer voucher secrets are generated and kept in the customer's browser.

## Honest limits

- **Payment confirmation is manual.** The merchant checks their wallet for the payment and its memo ref, then taps *Mark paid*. Automatic detection needs a light client with a viewing key.
- **The purchase itself is known to the shop** (they see the incoming payment and the order). What stays hidden is the link between that purchase and a later redemption.
- **Small shops have small anonymity sets.** With 3 purchases in a day, a redemption from that day is easy to guess. Privacy grows with volume.
- **In-person redemption shows a face.** The system hides the digital link, not physical presence.
- **Network metadata.** The server does not log IPs, but the hosting provider or a network observer could see when requests arrive. Use Tor or a VPN if that matters.
- Vouchers live only in the customer's browser: clearing browser data without a backup loses them.
- Locally, data is one JSON file (mode 0600 on Linux/macOS; Windows ignores file modes). On Vercel it is a Redis database; signing keys are stored encrypted, but whoever holds both the database and `SHIELDPAY_KEY_SECRET` can sign vouchers.
- Single merchant per deployment.

## Layout

`server.js` HTTP handler and API · `api/index.js` + `vercel.json` Vercel entry · `lib/blind.js` blind signatures (shared browser/Node) · `lib/vouchers.js` issuer, keys, double-spend, anonymity counts · `lib/storage.js` file and Redis storage · `lib/zip321.js` payment request URIs · `lib/qr.js` QR encoder · `web/` pages · `test/` tests (including a fake Redis and double-spend races)

## License

MIT, see [LICENSE](LICENSE).
