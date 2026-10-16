# Security status and reporting

This is an experimental community tool, not an official Circle product. It has **not received an independent security audit**. Passing automated tests or a successful withdrawal is not an audit. The current release supports ordinary EOA wallets and same-network EVM withdrawals only.

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/JTraversa/gateway-withdrawal/security/advisories/new). Do not publish signatures, recovery files, private keys, or live exploit instructions in public issues. If private reporting is unavailable, open an issue asking for a private reporting channel without including sensitive details.

## What a user authorizes

The connected wallet signs Circle's EIP-712 `BurnIntent`. Its transfer spec commits to the source wallet, recipient, source/destination domains, Circle contracts, USDC tokens, amount, random salt, empty hook data and zero destination caller. The authorization includes an expiry block and maximum fee. It can spend the specified Gateway balance without further signature prompts after submission. Reject a prompt whose fields do not match the review page.

The server validates the intent against its network registry and verifies the source wallet's signature before forwarding it to the fixed Circle mainnet API. It cannot create signatures. The browser compares the attestation's packed transfer spec with the signed authorization, simulates `gatewayMint`, requests the wallet's transaction, then checks the receipt for the exact USDC transfer to the reviewed recipient. No ERC-20 approval is requested.

## Trust boundaries

- A hosted frontend can change. You trust its deployment operator and dependencies; inspect the source and self-host if appropriate. CSP and input validation do not protect against a malicious site operator.
- Circle's API issues attestations, and Circle's contracts enforce their validity. RPC providers supply read state and simulation results. These external services can be unavailable or return inconsistent information.
- The public RPC function permits only allowlisted read/simulation methods and fixed endpoints. It cannot broadcast. Public deployers should apply hosting-level rate limits and budget limits to prevent resource abuse.
- Wallet accounts, addresses, balances and network requests are visible to the hosting provider, Circle and RPC providers. The app has no database or analytics and does not intentionally log authorizations or request bodies. Infrastructure access logs may still exist.
- A signed recovery file is an authorization, not just a receipt. Anyone with it may submit the same authorized withdrawal to its already-signed recipient. Keep it private. Import validates its signature and transfer fields but does not prove whether it has already been submitted or minted.
- Web Locks prevent concurrent execution only among tabs on the same browser origin. They do not coordinate different browsers, devices or self-hosted instances.

## Recovery limitations

Records are saved before Circle submission, after attestation receipt and after transaction broadcast. If the browser closes between broadcast and hash persistence, or Circle accepts a request but the response is lost, the record may be incomplete. Reusing the same salt prevents a new authorization, but duplicate requests may be rejected; manual reconciliation with Circle or a block explorer can be necessary. Do not delete an unresolved record and sign a fresh withdrawal as a workaround.

Attestations and burn intents can expire. This app does not automatically re-sign expired intents, renew attestations, initiate the seven-day fallback withdrawal, or discover transactions broadcast from another device. A pending hash is kept on receipt timeout. A failed mint can be retried with the saved attestation. Recovery import and reload do not automatically submit anything.

## Review before wider promotion

Independent review remains outstanding. Suggested scope: EIP-712 encoding and signature binding, account/network races, RPC responses and simulation handling, attestation validation and expiry, transaction replacement and recovery ambiguity, imported-file validation, API abuse limits, dependency provenance, and deployed-source integrity. The maintainers' automated tests and implementation review are documented in the repository, separately from any future external audit.
