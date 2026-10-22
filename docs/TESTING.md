# Testing ShieldPay with a real wallet

Automated tests (`npm test`) cover the logic. This guide covers the one thing a computer in the cloud cannot check: that a real Zcash wallet understands the payment request and that the memo arrives.

## What to verify

1. The payment QR/link opens in your wallet with the right **amount** and **memo** (the `SP-XXXXXX` order ref).
2. The payment arrives, and the memo shows in your wallet.
3. After *Mark paid*, vouchers appear in the customer wallet and can be redeemed once.

## Route A: tiny mainnet self-payment (recommended, nearly free)

Wallet apps such as Zodl are mainnet apps, so this is the surest way to test the exact path real users take. You pay yourself, so the only cost is the network fee (check the exact fee your wallet shows before confirming).

1. In your wallet, copy your own shielded (unified) receiving address.
2. Start ShieldPay with that address as `SHIELDPAY_ADDRESS` and `SHIELDPAY_VOUCHER_PRICE="0.0001"`.
3. For same-day testing also set `SHIELDPAY_COOLDOWN_DAYS=0` (demo only).
4. Open `/`, unlock, choose **Vouchers**, quantity 1, **Create request**.
5. Scan the QR from a second device (or open the *Open in wallet* link on your phone). Check the amount and memo before sending.
6. Wait for the payment to show in your wallet. Confirm the memo reads the `SP-…` ref.
7. On `/`, tap **Mark paid**. The customer page should say the voucher is saved.
8. Open `/wallet`, tap **Show code**, then redeem it on the merchant page (paste, or *Scan QR* on phones that support it).
9. Try redeeming the same code again: it must say *already used*.

## Route B: testnet (free test coins, more setup)

ShieldPay accepts testnet addresses (`utest1…`). Faucets I confirmed exist:

- Valar faucet: https://faucet.testnet.valargroup.dev (0.125 TAZ per IP per 24 hours; its docs use a `utest1…` unified address).
- Another faucet: https://zcashfaucet.jinolabs.xyz (asks for a small in-browser proof of work).

I could **not** confirm that any phone wallet app has a testnet switch. The practical route is a command-line testnet wallet such as `zcash-devtool` (see ZecHub's guide: https://zechub.wiki/guides/zcash-devtool). Its exact commands were not available to me, so run its `--help` output and follow its README rather than trusting commands from memory.

Outline: create a testnet wallet, get a `utest1…` address, request coins from a faucet, set that address as `SHIELDPAY_ADDRESS`, then pay a request from the same CLI wallet and confirm the memo.

TAZ has no value. Never reuse testnet keys or seed phrases on mainnet.

## If something goes wrong

| Symptom | Likely cause |
|---|---|
| Wallet rejects the link | Report the exact `zcash:` link text (replace the address with `ADDR`) |
| Memo missing in wallet | Wallet may not display memos for this payment; check its transaction details |
| "This browser cannot create private vouchers" | Page is not on https or localhost |
| Vouchers show "from <date>" | Cooldown is active, as designed |
