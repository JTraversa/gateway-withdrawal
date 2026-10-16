# Gateway Withdraw

A small, open-source tool for withdrawing **Circle Gateway USDC into a normal wallet balance**. Connect an existing wallet, choose the network, review the amount and fees, and sign in your wallet. No Circle account, API key or private-key import is required.

**[Open the app](https://tools.traversa.dev/gateway)** · [Security and limitations](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [MIT license](LICENSE)

> Experimental community software. Not affiliated with Circle and not independently audited. An external security review is still outstanding.

## What it does

- Uses the connected wallet as the Gateway depositor; defaults the withdrawal recipient to that same wallet.
- Offers an explicit custom recipient, with address validation and the full destination shown before signing.
- Supports same-network mainnet withdrawals on **Base, Arbitrum, Optimism, Polygon PoS, Avalanche C-Chain and Ethereum**.
- Fetches live Gateway balances and unsigned fee estimates. Pending batch settlement is displayed separately.
- Reserves the signed maximum Gateway fee when choosing Max. There is no app fee.
- Requests a typed-data withdrawal authorization, then a wallet transaction to Circle's Gateway Minter. Your wallet holds your keys and pays native network gas.
- Checks the attestation's packed transfer fields against the signed authorization before minting. Saves the authorization, attestation and transaction hash for recovery, with validated recovery-file import/export and same-browser tab locking.
- Confirms success only after finding the exact USDC transfer to the reviewed recipient in a successful transaction receipt.

The app does not bridge between networks, deposit USDC, redeem USDC for bank dollars, or support smart-contract/delegated-code wallets. Other Circle Gateway networks are not enabled in this first release. See [supported network configuration](src/networks.js).

## Use it

1. Open the app in a browser with your EVM wallet extension, or inside your wallet's browser.
2. Connect the wallet that owns the Gateway balance. Choose the network holding that balance.
3. Keep the recipient as your wallet, or explicitly enter another address.
4. Enter an amount or choose Max. Review the recipient, network, fee allowance and maximum debit.
5. Sign the authorization, then approve the mint transaction. Keep some of the network's native token for gas.

The first signature authorizes the specified Gateway funds; it is not a harmless login signature. Gateway fees come from your Gateway balance, in addition to the amount the recipient receives. The separate mint transaction fee is shown by your wallet. The app caps the signed Gateway fee at 0.10 USDC on the five lower-cost networks and 2 USDC on Ethereum. Estimates have a 20% buffer, with at least 0.001 USDC extra. Circle's production API may return a recommended fee allowance rather than a separate exact fee; the UI labels it accordingly. Max can leave a small remainder.

## Run locally

Requires Node.js **22.18+** and npm.

```sh
git clone https://github.com/JTraversa/gateway-withdrawal.git
cd gateway-withdrawal
npm ci
npm run dev
```

Open `http://127.0.0.1:4173/gateway/`. The development server includes both the frontend and local adapters for the two API functions. No environment variables or secrets are needed.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Browser tests use synthetic accounts and mocked Circle/RPC calls. They do not move funds. `npm run test:live` separately verifies the configured chain IDs, deployed Circle contracts, USDC decimals and unsigned fee estimates over the public internet. You can pass a public source wallet address with `npm run test:live -- 0x...`; it is never used for signing.

## Deploy your own

Import the repository into Vercel, using its detected Vite settings, or run:

```sh
npx vercel --prod
```

`vercel.json` configures the static build, API functions and security headers. The app is mounted at `/gateway/`; the deployment root redirects to `/gateway`. Vite assets and browser API requests are scoped to that prefix. For an external reverse proxy, forward `/gateway` and `/gateway/:path*` unchanged to the deployment. Deploy both API functions; serving `dist/` alone is insufficient. Other hosts need equivalent Node.js API adapters. Apply hosting-level abuse/rate limits and monitor resource usage if you run a public instance.

Browser recovery data is tied to its origin. Before moving from a `vercel.app` URL to a custom domain, download any unfinished withdrawal's recovery file and import it on the new domain. A path change on the same origin does not change its storage.

## Architecture and privacy

`src/protocol.js` defines and validates Circle's EIP-712 authorization. `src/networks.js` is an explicit allowlist of domains, tokens, fee limits and RPCs. `src/main.ts` handles wallet discovery, review, signing, minting, confirmation and recovery.

`api/gateway.js` forwards only balance, estimate and cryptographically authorized transfer requests to Circle's fixed mainnet endpoint. It verifies the signer and validates every supported transfer field. `api/rpc.js` forwards only allowlisted read/simulation methods to fixed network RPCs; transaction broadcasts happen in the user's wallet. URLs supplied by visitors are never used as upstream endpoints.

There is no database or analytics. Public wallet addresses and request data reach the hosting provider, Circle and RPC providers. Recovery state stays in your browser unless you export it. A hosted frontend and its dependencies are part of the trust model: self-hosting makes deployment control yours. See [SECURITY.md](SECURITY.md) for the full boundaries and limitations.

## Recovery

After a signed authorization is saved, the page blocks a new withdrawal until the saved one is resolved. Reconnect its source wallet and select Continue. A declined mint can resume without another burn signature. A transaction receipt timeout keeps its hash for confirmation on retry.

Download the recovery JSON before changing browsers. To restore it, use **Restore a saved withdrawal**. The file's signature and transfer fields are checked locally; importing never automatically submits a request. Review the signed recipient and network before continuing. Previous private-version recovery files are also supported.

Keep recovery files private. They contain an amount-limited signed authorization. Expiry, a lost API response, a transaction broadcast before hash persistence, or completion from another device can require manual reconciliation. Do not clear an unresolved record and sign a fresh withdrawal as a workaround. The seven-day trustless fallback and automatic attestation renewal are not implemented.

## Security and project status

This is an initial community release. Automated tests cover arithmetic, field validation, signature binding, network configuration, recovery, API restrictions and mocked wallet flows. Read-only live checks verify network configuration; they are not funded end-to-end tests on every network. Independent security review remains outstanding; no audit claim is made. Please use [private vulnerability reporting](https://github.com/JTraversa/gateway-withdrawal/security/advisories/new) for sensitive issues.

## Circle references

- [Transfer a unified USDC balance](https://developers.circle.com/gateway/howtos/transfer-unified-usdc-balance)
- [Estimate transfers](https://developers.circle.com/api-reference/gateway/all/estimate-transfer)
- [Gateway contract addresses](https://developers.circle.com/gateway/references/contract-addresses)
- [USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Gateway fees](https://developers.circle.com/gateway/references/fees)

MIT licensed. Contributions and independent security review are welcome.
