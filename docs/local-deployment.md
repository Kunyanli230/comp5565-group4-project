# Local deployment and integration

Use `main`: PR #4 was merged on 2026-11-16. The latest deployment and integration verification on 2026-11-17 used commit `a58eb7d2f4ddbc5564552ee5e25aad1735718050`, including both business contracts and the deployment/service fixes. It passed 34 contract/interface tests, 16 API/seed tests and 8 lifecycle checks; TypeScript checking also passed. See [the verification record and logs](integration-verification-2026-11-17.md). All commands run from the repository root; use separate terminals for the chain and API.

The off-chain API is implemented with Node.js built-in `node:http` and stores data in a local JSON file. It does not use Express. The API is a separate required process; starting the chain or deploying contracts does not start it.

## Start a demo

1. Install dependencies with `npm ci`. Use a supported Node.js version with built-in fetch; the 2026-11-13 verification used Node.js 24.16.0.
2. Run `npm run check:interface` and `npm run compile`.
3. Terminal A: `npm run node`. Keep this process running (chain ID 31337, RPC http://127.0.0.1:8545). Its displayed accounts are public development accounts only.
4. Terminal B: `npm run deploy:local`. This deploys both contracts, links them and writes `deployments/local.json`. It does not grant business roles or register a product.
5. Terminal C: `npm run offchain`. Keep this process running at http://127.0.0.1:3001. Open http://127.0.0.1:3001/health and confirm it returns `{"ok":true}` before seeding.
6. Terminal B: `npm run seed:local`. This grants manufacturer/retailer/service roles and registers the shared demo product. Customer and resale-buyer accounts receive no roles.
7. The verified main commit has no frontend application or browser entry point. When it is supplied, start it using its own instructions. It must use chain ID 31337, the current addresses from `deployments/local.json`, and the API at http://127.0.0.1:3001. The API allows browser origins http://localhost:5173 and http://127.0.0.1:5173.

Use the `deploy:local` and `seed:local` package commands exactly as shown: they select the persistent `localhost` network. Running a bare Hardhat script can select a temporary chain instead. `deployments/local.example.json` is a template containing zero addresses; only the generated `deployments/local.json` is usable. If the local chain restarts, deploy again before using the addresses.

Initial demo state: retailer owns the product, warrantyStart is zero, claimCount is zero, transferLocked is false. Selling to the customer starts the warranty; applying locks transfers; approving consumes one claim and unlocks; resale preserves warrantyStart.

## Restart and repeat

- API data is persisted in `offchain/data.json`. Restarting the API keeps products, claims and notes.
- Running seed again reuses matching demo plaintext and matching on-chain product. It does not reset ownership, warranty timestamps or claim history.
- Restarting the Hardhat node resets its local chain. Deploy again, then seed again; matching persisted demo plaintext is reusable.
- An existing off-chain record with a conflicting model or description is rejected without overwriting data. Investigate the conflicting record instead of automatically deleting storage.
- A missing API gives a clear error. Start `npm run offchain`, then retry seed.
- Stop the API and chain with Ctrl+C in their respective terminals when the demo ends. Generated contract addresses are only valid while that chain state exists; do not reuse addresses from an ended test session.
- Do not commit `offchain/data.json`, `deployments/local.json`, private keys or `node_modules`.

## Checks

```text
npm run check:interface
npm run test:offchain
npm run test:seed
npx hardhat test test/ProductRegistry.js test/WarrantyManager.js
```

On 2026-11-13, a fresh local snapshot of merged main `e80ef8402f472e94a2a0f42b9e2a5093938d1dc8` passed the real deployment/API acceptance flow:

- Both contracts deploy and reference each other; business roles and the demo product are initialized by seed.
- Seed reports an unavailable API clearly; after starting the API, it registers the product with the expected initial warranty state.
- Repeating seed reuses the product and preserves existing ownership and warranty history.
- Retailer sale, warranty request, service approval and resale complete successfully; warranty start is preserved and an approved claim consumes one claim.
- Products, claim reasons and service notes remain readable after an API restart.
- Redeploying contracts while keeping the API data allows the same demo plaintext to be reused.

All 32 non-PDF files in the verification snapshot matched the final commit's Git blob hashes. The repository's course PDF was not needed for execution. The contracts and their tests were unchanged from the 2026-11-11 run, which passed 34 contract/interface tests and 12 API/seed tests; those suites were not rerun solely for the merge. The final acceptance run reused the existing dependency installation and Solidity 0.8.24 build after checking every compilation input against the snapshot. A clean `npm ci` installation was not revalidated in that run.

The test chain and API were stopped after acceptance. Browser rendering, wallet connections and frontend-to-contract/API calls remain pending until the frontend is delivered; the backend acceptance above does not verify those interactions.


## 2026-11-16 final service fixes and client handoff

The earlier installation caveat above is superseded: on Windows x64 / Node 24.16.0 / npm 11.13.0, a clean npm ci installed 375 packages from the unchanged lockfile; Solidity 0.8.24 was freshly downloaded and 13 sources compiled. 34 contract/interface tests passed. After these fixes, all 16 API/seed tests and all 8 real deployment/lifecycle checkpoints passed. Test processes were stopped. No frontend is delivered in the reviewed main, so browser/wallet acceptance is still pending.

### Error recovery
Malformed URL encoding and ill-formed Unicode return HTTP 400 / invalid_body without terminating the service. Valid Chinese and emoji remain supported. Unexpected storage failures return HTTP 500 / internal_error without exposing local paths; the in-memory state is committed only after disk persistence succeeds. Retry after fixing the storage problem does not encounter phantom records.

### Multiple products with identical fault text
The canonical reasonHash algorithm and all on-chain interfaces are unchanged. Off-chain storage indexes records by both reasonHash and productId, preserves each product's creation timestamp on retries, and reads existing data.json files automatically without deleting them.

Frontend code should always read fault text with:

GET /claims/{reasonHash}?productId={claim.productId}

Use the productId returned by the on-chain getClaim result; keep it as a decimal string. POST /claims and the response fields are unchanged. Existing hash-only GET calls continue to work for a unique product. When several products share a reason, hash-only GET returns HTTP 400 / invalid_body rather than guessing the product; add productId and retry. An unknown product association returns 404. The shared OpenAPI v0.1.1 documents this additive query and error handling. This additive integration change was merged in PR #4; clients must not treat reasonHash alone as a product identity. Old links already overwritten by the old service cannot be reconstructed from the current file; restore them from a trusted backup or re-post the known product/reason pair. No existing data is silently erased.

### Report and presentation alignment
Report Table 1 and section 5.2.3 should say Node.js built-in HTTP service, not Express. Section 5.2.3 must explicitly start npm run offchain before npm run seed:local. The shared presentation's two deployment slides and bilingual notes describe the updated service. Keep the presentation concise; frontend/wallet completion must only be claimed after those flows are actually tested.
