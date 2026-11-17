# Deployment integration verification — 2026-11-17

PR #4 already contains the merged deployment/service fixes. This follow-up records a new local deployment and integration run against merged main. It introduces no runtime code changes and does not deploy a public server.

## Version and environment

- Verified main: `a58eb7d2f4ddbc5564552ee5e25aad1735718050`.
- Compared with PR #4 head `9806add33e9cd9daa87c5a581ee439a671181345`: no changed files, only the merge commit.
- All 32 non-PDF tracked source files in the test snapshot matched their Git blob hashes.
- Windows x64, Node.js 24.16.0, npm 11.13.0, Hardhat 2.29.1, Solidity 0.8.24.
- This run reused the dependency installation validated by a clean `npm ci` on 2026-11-16 after checking the unchanged lockfile. It did not run another clean installation.
- Fresh source snapshot, fresh compilation and new test runtime data; existing working data was preserved.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Compile and contract/interface tests | 13 sources compiled; 34 passed | [Contract log](verification/2026-11-17/contracts.log) |
| Off-chain API and seed tests | 16 passed; 0 failed | [API/seed log](verification/2026-11-17/api-seed.log) |
| Actual deployment and lifecycle | 8 checkpoints passed | [Integration log](verification/2026-11-17/integration.log) |
| TypeScript declarations | `tsc --noEmit` exited 0 | No output on success |

The eight integration checkpoints verified:

1. Deploy creates and links both contracts; roles and products remain for seed.
2. Seed clearly reports an unavailable API.
3. Seed assigns the intended roles and creates a retailer-owned product whose warranty has not started.
4. Repeating seed does not create a duplicate product.
5. Retailer sale starts warranty; requesting warranty locks transfers; approval consumes one claim and unlocks; resale preserves the original warranty start.
6. Seed after that journey preserves the new owner, claim count and warranty start.
7. API restart preserves product details, claim reasons and service notes.
8. Redeploying contracts can reuse matching persisted demo plaintext.

The API regression suite also covers malformed input, storage failure recovery, and separate records for products sharing the same fault text.

## Recheck and demonstrate

From the repository root:

```text
npm ci
npx hardhat test test/interface-vectors.js test/ProductRegistry.js test/WarrantyManager.js
node --test test/offchain.test.js test/seed-plaintext.test.js
npx tsc --noEmit
```

For the demo follow the [startup instructions](local-deployment.md): local chain → deploy and bind → off-chain API → seed → frontend when delivered. Keep the chain and API running in separate terminals. The eight-check integration run additionally exercised actual contract calls with the shared demo accounts; it is not included in the four commands above.

The test chain and API were stopped after verification. No test service remained listening on ports 8545 or 3001. Addresses in the log belong to that temporary local test chain; generate a new `deployments/local.json` for the next chain session. Runtime data, generated deployment manifests, dependencies and private keys are not part of this submission.

## Frontend handoff and presentation

At the verified commit there is no frontend application. Browser rendering, wallet connection and frontend-to-contract/API calls remain unverified.

The frontend needs chain ID 31337, current generated contract addresses, the API on port 3001, and `GET /claims/{reasonHash}?productId={claim.productId}` for product-specific claim text. Product IDs remain decimal strings.

The existing shared presentation was updated separately: the deployment slides are currently pages 8 and 9, titled **Deployment & integration** and **Integration checks & results**. Bilingual speaker notes explain the deployment sequence and verified results. Frontend/wallet integration is explicitly marked pending. Page numbers can change if other members insert slides.

## 中文交接摘要

PR #4 已合并。本次基于正式版本重新部署并完成联调，没有新增代码修改。本 PR 补交检查记录、实际测试日志和最新启动说明。34 项合约/接口测试、16 项 API/初始化测试、8 项完整流程检查全部通过。共享 PPT 两页已同步更新。前端和钱包仍待前端代码交付后联调；测试服务已关闭，不代表存在长期在线部署。
