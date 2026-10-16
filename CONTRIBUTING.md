# Contributing

Use Node.js 22.18 or later. Run `npm ci`, `npm test`, `npm run build` and `npm run test:browser`. Install the test browser with `npx playwright install chromium` (Linux CI also needs `--with-deps`).

Open an issue describing a problem or a focused pull request. Include meaningful validation, especially for changes affecting signatures, amounts, recipients, network switching or recovery. Tests must use synthetic accounts and mock wallet broadcasts; never add keys, signed live authorizations, recovery files or personal wallet addresses.

New network support requires Circle's official Gateway and native USDC addresses, chain/domain IDs, known read-only RPCs, fee ceilings, network gas token labels, tests, and read-only live verification. Cross-network withdrawals and smart-contract wallets are deliberately outside the first release's scope.

Report security issues using [SECURITY.md](SECURITY.md). Contributions are licensed under the MIT license.
