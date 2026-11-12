# Local deployment and integration

Use the group-approved ProductRegistry and WarrantyManager implementations together with the deployment/off-chain service files. The frozen interfaces alone cannot be deployed. All commands run from the repository root; use separate terminals for the chain and API.

## Start a demo

1. Install dependencies with `npm ci`. Use a supported Node.js version with built-in fetch; the 2026-11-11 verification used Node.js 24.
2. Run `npm run check:interface` and `npm run compile`.
3. Terminal A: `npm run node`. Keep this process running (chain ID 31337, RPC http://127.0.0.1:8545). Its displayed accounts are public development accounts only.
4. Terminal B: `npm run deploy:local`. This deploys both contracts, links them and writes `deployments/local.json`. It does not grant business roles or register a product.
5. Terminal C: `npm run offchain`. Keep this process running at http://127.0.0.1:3001.
6. Terminal B: `npm run seed:local`. This grants manufacturer/retailer/service roles and registers the shared demo product. Customer and resale-buyer accounts receive no roles.
7. Start the frontend using its own instructions after it is available. It must use the current addresses from `deployments/local.json` and port 5173.

Initial demo state: retailer owns the product, warrantyStart is zero, claimCount is zero, transferLocked is false. Selling to the customer starts the warranty; applying locks transfers; approving consumes one claim and unlocks; resale preserves warrantyStart.

## Restart and repeat

- API data is persisted in `offchain/data.json`. Restarting the API keeps products, claims and notes.
- Running seed again reuses matching demo plaintext and matching on-chain product. It does not reset ownership, warranty timestamps or claim history.
- Restarting the Hardhat node resets its local chain. Deploy again, then seed again; matching persisted demo plaintext is reusable.
- An existing off-chain record with a conflicting model or description is rejected without overwriting data. Investigate the conflicting record instead of automatically deleting storage.
- A missing API gives a clear error. Start `npm run offchain`, then retry seed.
- Do not commit `offchain/data.json`, `deployments/local.json`, private keys or `node_modules`.

## Checks

```text
npm run check:interface
npm run test:offchain
npm run test:seed
npx hardhat test test/ProductRegistry.js test/WarrantyManager.js
```

On 2026-11-11, a local combination of PR #2 plus PR #3 at `902f23ec53136e394bc559e294bac8c3b312ea4c` passed contract tests and the deployment/API/ownership/warranty/resale flow. The seed retry fix additionally passed repeated seeding and redeployment with persisted API data.

This is pre-merge integration evidence. PR #3 contains the ProductRegistry from commit `903232d233faf67c9f979999e15603f70124a0dc`, originally in closed PR #1. The group must confirm which Registry implementation is final, then repeat integration on the merged main branch. The frontend was not present in the checked branches, so browser/wallet integration is still pending.
