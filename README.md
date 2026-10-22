# ShieldPay

**Private Zcash checkout with unlinkable vouchers.**

A Zecathon submission for the **Shielded Payments** track.

Shielded Zcash can protect payment details, but loyalty cards and prepaid passes can reintroduce a link between a purchase and a later redemption. ShieldPay explores a way to break that link using blind signatures.

A customer pays for vouchers, generates voucher secrets in their browser, and requests blind signatures from the merchant. The merchant signs the blinded requests without seeing the underlying voucher secrets. Later, the customer redeems a voucher, and the merchant can verify its signature and check that it has not already been spent without learning which purchase issued it.

**Important:** Checkout confirmation is simulated in the current demo. Real on-chain testnet payment confirmation has not yet been verified.

## Project Status

| Component | Status |
|---|---|
| Blind-signature voucher issuance | Implemented and covered by automated tests |
| Voucher verification and redemption | Implemented and manually tested in the browser |
| Duplicate-redemption prevention | Implemented; repeated redemption was rejected in manual testing |
| Voucher cooldown and expiry | Implemented and covered by automated tests |
| Anonymity-set information | Implemented; purchase counts are displayed to communicate privacy limitations |
| ZIP-321 payment request and QR code | Implemented; scanned with Zkool on testnet, which populated the recipient, amount, and memo |
| On-chain testnet payment | Not yet verified; Zkool reported an incorrect consensus branch ID when attempting to send |
| Payment confirmation | Simulated in the demo; merchant confirmation is manual in the normal checkout flow |
| External cryptographic security audit | Not performed |

## Why ShieldPay?

A payment system should not automatically make every later interaction linkable to the original purchase.

ShieldPay separates the payment and redemption stages:

- The merchant handles the original payment and order.
- The customer’s browser generates and retains voucher secrets.
- The merchant signs blinded voucher requests without seeing the underlying secrets.
- During redemption, the merchant verifies the voucher and checks for reuse without receiving the original purchase identifier from the voucher itself.

The goal is to reduce the digital link between a purchase and a later redemption, while being transparent about the limitations of anonymity.

## How It Works

### 1. Create a payment request

The merchant creates an order. ShieldPay generates a ZIP-321-compatible payment request with a QR code and payment link, including an order reference in the memo.

### 2. Issue vouchers

After payment is confirmed, the customer’s browser creates voucher secrets and blinds them before requesting signatures from the merchant. The browser unblinds the returned signatures and stores the vouchers in a local wallet.

In the current public demo, the payment confirmation step is simulated. The subsequent voucher workflow uses the application’s implemented code.

### 3. Redeem a voucher

The customer presents a voucher code or QR code. ShieldPay verifies the signature, checks the voucher’s validity, and rejects a voucher that has already been spent.

### 4. Prevent duplicate spending

ShieldPay records spent-secret hashes so that a voucher cannot be redeemed repeatedly.

## Privacy Design

| Risk | Design approach |
|---|---|
| Linking a redemption to a specific purchase | Blind signatures separate voucher issuance from redemption |
| Immediate purchase-to-redemption timing correlation | A configurable cooldown, one day by default |
| Repeated use of the same voucher | Spent-secret tracking and duplicate-redemption rejection |
| Small anonymity sets | Purchase counts are displayed so users can understand the available crowd size |
| Merchant-issued keys used to tag customers | The wallet displays a signing-key fingerprint for consistency checks |
| Long-term voucher reuse | Voucher expiry, 30 days by default |

### Important Privacy Limitations

ShieldPay reduces the link between a purchase and voucher redemption; it does not make every part of a transaction anonymous.

- The merchant sees the original order and incoming payment.
- Small purchase volumes can make a redemption easier to guess. A displayed count is not a guarantee of strong anonymity.
- Physical, in-person redemption can reveal the customer’s identity.
- Network observers and hosting providers may observe request timing and metadata.
- Clearing browser data without a backup can permanently lose locally stored vouchers.
- A zero-day cooldown is provided for demonstrations only. It makes purchase-to-redemption timing more linkable.
- The cryptographic implementation has not received an independent security audit.

## Cryptography

ShieldPay implements Chaum RSA blind signatures using a 2048-bit RSA construction with a full-domain hash in `lib/blind.js`. The implementation is shared between the browser and Node.js.

This is a classic blind-signature construction, **not RFC 9474**. The implementation should be treated as experimental until it has undergone independent cryptographic review.

## Technology and Architecture

- **Node.js:** HTTP server and API
- **Browser JavaScript:** voucher generation, blinding, unblinding, and local wallet
- **RSA blind signatures:** voucher issuance without exposing voucher secrets to the signer
- **ZIP-321:** Zcash payment request URIs
- **QR codes:** in-repository QR encoder
- **Storage:** local file storage and Redis-backed storage
- **Tests:** main application checks, fake-Redis checks, and duplicate-spend race tests

## Getting Started

### Requirements

- Node.js 18 or newer
- A valid shielded or unified Zcash receiving address
- Git Bash, Bash, or another compatible shell for the environment-variable examples below

The project currently has no external npm dependencies required by its existing test and start scripts.

### 1. Configure environment variables

In your terminal, from the project directory, set the required values:

```sh
export SHIELDPAY_ADDRESS="YOUR_VALID_SHIELDED_ZCASH_ADDRESS"
export SHIELDPAY_ADMIN_TOKEN="YOUR_LONG_RANDOM_ADMIN_TOKEN"
export SHIELDPAY_KEY_SECRET="YOUR_LONG_RANDOM_ENCRYPTION_SECRET"

export SHIELDPAY_NAME="My Shop"
export SHIELDPAY_VOUCHER_NAME="meal"
export SHIELDPAY_VOUCHER_PRICE="0.01"
```

Use a valid address for the network you intend to test. Use a testnet address for testnet experiments. Do not publish your admin token, encryption secret, or private keys.

The application validates the receiving address and requires an admin token of at least 12 characters. Use securely generated secrets rather than the example strings above.

### 2. Start ShieldPay

```sh
npm start
```

By default, the server listens on:

`http://localhost:3000`

### 3. Run the automated tests

Open a separate terminal in the project directory and run:

```sh
npm test
```

The test command runs:

- `test/run.js`
- `test/redis.test.js`

**Latest recorded local result:**

- Main test suite: 58 checks passed
- Redis test suite: 20 checks passed
- **Total: 78 automated checks passed**

These results reflect the latest local run and are not an independent security audit.

## Demo Mode

The public demo route is disabled by default. To enable it locally:

```sh
SHIELDPAY_DEMO=1 npm start
```

Open:

`http://localhost:3000/demo`

The demo includes a simulated payment-confirmation action so visitors can explore voucher issuance and redemption without broadcasting a real payment.

For a local demo that allows same-day redemption:

```sh
SHIELDPAY_DEMO=1 SHIELDPAY_COOLDOWN_DAYS=0 npm start
```

**Use the zero-day cooldown for demonstrations only.** It weakens timing privacy by allowing a voucher to be bought and redeemed on the same day.

When recording or presenting the demo, disclose that payment confirmation is simulated. Do not present a simulated confirmation as evidence of an on-chain transaction.

## Manual Demo Evidence

Screenshots from local browser testing are intended to be stored in:

[`evidence/simulated-checkout/`](evidence/simulated-checkout/)

Suggested evidence:

- Voucher issuance after simulated checkout
- Successful first redemption
- Rejection of a repeated redemption attempt

These screenshots document the simulated-checkout workflow. They do not establish that a real Zcash payment was broadcast or confirmed. Redact voucher codes and other sensitive test data before publishing screenshots in a public repository.

## Testnet Payment Limitation

ShieldPay generates a payment request QR code and link. During testing, Zkool populated the intended testnet recipient, amount, and memo from the request.

However, an attempted testnet transaction failed with an **incorrect consensus branch ID** error. The exact cause has not been confirmed. A wallet, light-node service, or network-upgrade compatibility issue is possible, but this remains unresolved.

The current demo therefore uses simulated payment confirmation. Real on-chain testnet payment confirmation must be verified before the project can claim a successful end-to-end Zcash payment.

## Application Routes

| Route | Purpose |
|---|---|
| `/` | Merchant dashboard and order management |
| `/demo` | Public demo page, enabled only with `SHIELDPAY_DEMO=1` |
| `/wallet` | Customer voucher wallet stored in the browser |
| `/pay/:id` | Payment-request page for an order |

## Configuration Reference

| Variable | Purpose | Default |
|---|---|---|
| `SHIELDPAY_ADDRESS` | Shielded or unified receiving address | Required |
| `SHIELDPAY_ADMIN_TOKEN` | Protects administrative actions | Required |
| `SHIELDPAY_KEY_SECRET` | Protects stored signing keys | Required for the configured key-protection flow |
| `SHIELDPAY_NAME` | Merchant display name | Application default |
| `SHIELDPAY_VOUCHER_NAME` | Voucher description | Application default |
| `SHIELDPAY_VOUCHER_PRICE` | Price per voucher in ZEC | Application default |
| `SHIELDPAY_DEMO` | Enables the public demo route when set to `1` | Disabled |
| `SHIELDPAY_COOLDOWN_DAYS` | Delay before a voucher can be redeemed | `1` |
| `SHIELDPAY_VALID_DAYS` | Voucher validity period | `30` |

For deployment-specific configuration, consult [`docs/DEPLOY.md`](docs/DEPLOY.md). For test instructions, consult [`docs/TESTING.md`](docs/TESTING.md).

## Current Limitations

- Payment confirmation is manual in the normal checkout flow; automatic payment watching is not yet implemented.
- The public demo simulates payment confirmation.
- A successful on-chain testnet payment has not yet been verified.
- The project has not undergone an external cryptographic security audit.
- Vouchers are stored in the customer's browser, so losing browser data can result in losing access to vouchers.
- A single merchant is supported per deployment.
- Privacy depends on the size of the anonymity set, cooldown settings, user behavior, and network metadata.

## Project Layout

- `server.js` — HTTP server, request handling, and API
- `api/index.js` and `vercel.json` — Vercel entry point and routing configuration
- `lib/blind.js` — browser/Node blind-signature implementation
- `lib/vouchers.js` — voucher issuance, keys, expiry, cooldown, and double-spend prevention
- `lib/storage.js` — file and Redis-backed storage
- `lib/zip321.js` — payment request URI handling
- `lib/qr.js` — QR-code encoder
- `web/` — merchant, payment, demo, and wallet pages
- `test/` — automated tests, including fake-Redis and double-spend race tests
- `docs/` — testing and deployment documentation
- `evidence/simulated-checkout/` — screenshots from manual simulated-checkout testing

## License

MIT. See [`LICENSE`](LICENSE).