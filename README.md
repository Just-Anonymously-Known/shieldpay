# ShieldPay 🔐

### Privacy-Preserving Payments with Anonymous Vouchers

ShieldPay is an open-source privacy-focused payment prototype exploring how merchants can accept payments while reducing the linkability between a customer's payment and their later purchase.

It uses blind-signed digital vouchers to separate voucher issuance from redemption, with voucher verification, expiry controls, and double-spend protection.

## 🌐 Live Links

- **Main application:** https://shieldpay-nine.vercel.app/
- **Interactive demo:** https://shieldpay-nine.vercel.app/demo
- **GitHub repository:** https://github.com/Just-Anonymously-Known/shieldpay

> **Demo notice:** The public demo uses simulated payment confirmation. It demonstrates the voucher workflow but does not confirm receipt of a real Zcash transaction.

## 💡 The Problem

Digital payment systems can expose information that makes it possible to associate a customer's payment with a later purchase. ShieldPay explores a different approach: a merchant issues a cryptographically signed voucher that can be redeemed later without necessarily linking the redemption to the original payment.

The goal is to explore practical privacy-preserving payment workflows while maintaining voucher validity checks and protection against repeated redemption.

## 🚀 How It Works

1. **Checkout:** A customer initiates a payment request through the merchant interface.
2. **Payment confirmation:** The merchant's payment workflow authorizes voucher issuance. This step is simulated in the public demo.
3. **Voucher issuance:** ShieldPay issues a voucher using a blind-signature mechanism.
4. **Wallet storage:** The voucher is stored in the browser-based demo wallet.
5. **Redemption:** The merchant verifies the voucher's signature and validity.
6. **Double-spend prevention:** Once redeemed, the voucher cannot be successfully redeemed again.
7. **Privacy controls:** Expiry and configurable cooldown rules are intended to reduce linkability through timing.

## ✨ Features

- **Blind-signature vouchers:** Uses a Chaum-style RSA blind-signature approach to explore separating issuance from redemption.
- **Voucher verification:** Checks voucher authenticity and validity before acceptance.
- **Double-spend protection:** Rejects attempts to redeem an already-used voucher.
- **Browser-based demo wallet:** Stores demo vouchers in the browser for the demonstration workflow.
- **Expiry and cooldown controls:** Configurable rules govern voucher validity and redemption timing.
- **Redis-backed state:** Uses Redis-compatible storage for persistent application state and redemption tracking.
- **Interactive simulated demo:** Lets users explore checkout, voucher issuance, and redemption without a real payment.
- **Open-source code:** The implementation is available for inspection and further development.

## 🛠️ Technology Stack

- **Runtime:** Node.js
- **Frontend:** HTML, CSS, and JavaScript
- **Backend:** Node.js application and API routes
- **Cryptography:** RSA blind signatures using a full-domain hash approach
- **Storage:** Upstash Redis
- **Deployment:** Vercel
- **Testing:** Automated core-application and Redis-related test suites

## 🧪 Testing and Verification

During development, the local automated test suites passed **78 checks**:

| Test suite | Result |
|---|---:|
| Core application checks | 58 passed |
| Redis-related checks | 20 passed |
| **Total** | **78 passed** |

The live simulated demo was also manually tested for the following:

- Simulated payment confirmation
- Voucher issuance
- Voucher storage in the browser wallet
- Successful first redemption
- Rejection of a second redemption attempt using the same voucher

These results describe the tests performed. They are not a formal security audit or proof that every production scenario has been covered.

## 🔗 Zcash Testnet Integration Status

ShieldPay's main application was tested with **Zkool**, a Zcash wallet, to evaluate its payment-request flow.

### What worked

- Zkool successfully recognized and read the ShieldPay payment request.
- The wallet populated the recipient address, requested amount, and memo from the payment request.

### What remains unresolved

- The attempted transaction did not complete successfully.
- During testing, the wallet returned an **incorrect consensus branch ID** error.
- Successful transaction broadcast, receipt, and confirmation have not yet been verified.

This test demonstrates that the wallet could interpret the payment request. It does **not** establish that ShieldPay successfully completed a real Zcash payment.

The public demo therefore uses simulated payment confirmation while the testnet transaction issue remains under investigation.

## 🔒 Security and Privacy Considerations

ShieldPay is an experimental prototype. Its cryptographic design and privacy properties require further independent review before any real-funds or sensitive-transaction use.

Important limitations:

- The implementation has not undergone an independent security audit.
- The RSA blind-signature approach is not claimed to be compliant with RFC 9474.
- Timing, voucher metadata, merchant behavior, browser state, network information, and operational logs may still create privacy risks.
- Double-spend protection depends on correct server-side storage and application behavior.
- Real Zcash testnet payment confirmation remains unverified.
- The public demo's zero-day cooldown is a testing convenience that weakens timing-based privacy protection. It should remain limited to simulated demo use; real-use configurations should retain an appropriate cooldown.
- Administrative credentials, private signing material, and environment secrets must never be committed to source control or exposed publicly.

ShieldPay demonstrates privacy-preserving payment concepts; it does not guarantee complete anonymity.

## ⚙️ Run Locally

### Requirements

- Node.js 18 or later
- npm
- A Redis-compatible backend for testing persistent-storage functionality

### Installation

```bash
git clone https://github.com/Just-Anonymously-Known/shieldpay.git
cd shieldpay
npm install
```

Configure the environment variables required by the application. Refer to [`docs/DEPLOY.md`](docs/DEPLOY.md) for the deployment configuration and storage settings.

### Run tests

```bash
npm test
```

### Start the application

Follow the startup instructions and environment-variable requirements in [`docs/DEPLOY.md`](docs/DEPLOY.md). Enable demo mode only when running a simulated demonstration.

## ☁️ Deployment

ShieldPay is deployed on Vercel and uses Upstash Redis for hosted storage.

- Main application: https://shieldpay-nine.vercel.app/
- Interactive demo: https://shieldpay-nine.vercel.app/demo

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for deployment instructions and environment-variable configuration.

**Secret management:** Keep `SHIELDPAY_KEY_SECRET` stable after deployment. Changing it may make previously stored signing-key material inaccessible. Store secrets in the hosting provider's environment-variable settings, not in source control.

## 🗺️ Roadmap

- Resolve the Zcash testnet transaction error and verify successful payment confirmation.
- Improve payment-status handling and reconciliation.
- Expand automated integration and deployment tests.
- Obtain independent cryptographic and application security reviews.
- Improve the merchant experience and integration workflow.
- Evaluate stronger protections against timing and metadata correlation.

## 🤝 Contributing

Contributions, bug reports, testing, and feedback are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Make your changes and add relevant tests.
4. Open a pull request explaining the changes and test results.

Never commit private keys, administrative tokens, credentials, or other secrets.

## 📄 License

See the repository's license file for the applicable terms.

## 👨‍💻 Author

**Godis Akachukwu**

- GitHub: https://github.com/Just-Anonymously-Known

---

*ShieldPay is an experimental privacy-preserving payment prototype intended for research, demonstration, and further development. It is not a production-ready payment processor and does not guarantee complete anonymity or privacy.*
