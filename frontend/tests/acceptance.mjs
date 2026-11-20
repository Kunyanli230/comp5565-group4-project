/**
 * Real local-chain/API acceptance check. Run after deploying and seeding the app:
 *   node frontend/tests/acceptance.mjs
 *
 * Uses only Hardhat's unlocked public development accounts, never private keys.
 * Creates two uniquely named test products and their lifecycle records. It does
 * not reset the chain, delete API data or change the shared demo product.
 * This checks integration behavior; it does not replace browser/wallet QA.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { Contract, JsonRpcProvider, ZeroAddress } = require("ethers");
const { serialHash, modelIdFromName, reasonHash, noteHash, ZERO_BYTES32, roleHash } = require("./shared/hash.js");
const { LOCAL_ACCOUNTS } = require("./shared/constants.js");

function onlyLocalHttp(value, label) {
  const url = new URL(value);
  assert.equal(url.protocol, "http:", `${label} must use local HTTP`);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), `${label} must point to localhost`);
  assert.ok(!url.username && !url.password, `${label} must not contain credentials`);
  return url.origin;
}

const config = JSON.parse(await readFile(new URL("../../deployments/local.json", import.meta.url), "utf8"));
assert.equal(config.chainId, 31337, "Only the Hardhat development chain is supported");
const rpcUrl = onlyLocalHttp(config.rpcUrl, "RPC URL");
const apiUrl = onlyLocalHttp(config.offchainBaseUrl, "API URL");
const registryArtifact = JSON.parse(await readFile(new URL("../../artifacts/contracts/ProductRegistry.sol/ProductRegistry.json", import.meta.url), "utf8"));
const warrantyArtifact = JSON.parse(await readFile(new URL("../../artifacts/contracts/WarrantyManager.sol/WarrantyManager.json", import.meta.url), "utf8"));
const provider = new JsonRpcProvider(rpcUrl);
provider.pollingInterval = 100;
const registry = new Contract(config.productRegistry, registryArtifact.abi, provider);
const warranty = new Contract(config.warrantyManager, warrantyArtifact.abi, provider);
let checkpoints = 0;
let notePosts = 0;
const transactions = [];

function pass(message) {
  checkpoints += 1;
  console.log(`PASS ${String(checkpoints).padStart(2, "0")} ${message}`);
}

async function api(path, { method = "GET", body, status = 200 } = {}) {
  if (path === "/notes" && method === "POST") notePosts += 1;
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { Origin: "http://127.0.0.1:5173", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const value = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(value)}`);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:5173");
  return value;
}

async function mined(label, pending) {
  const tx = await pending;
  const receipt = await tx.wait();
  assert.ok(receipt && receipt.status === 1, `${label} did not succeed`);
  transactions.push({ label, hash: receipt.hash, blockNumber: receipt.blockNumber });
  return receipt;
}

function parsedEvent(receipt, contract, name) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== String(contract.target).toLowerCase()) continue;
    try {
      const event = contract.interface.parseLog(log);
      if (event?.name === name) return event.args;
    } catch { /* Other contracts may emit logs in the same transaction. */ }
  }
  assert.fail(`Missing ${name} event`);
}

async function mustRevert(action, contract, expectedName) {
  let caught;
  try { await action(); } catch (error) { caught = error; }
  assert.ok(caught, `Expected ${expectedName} to revert`);
  const data = caught.data ?? caught.info?.error?.data?.data ?? caught.info?.error?.data;
  let decoded;
  if (typeof data === "string") {
    try { decoded = contract.interface.parseError(data)?.name; } catch { /* Fall back to ethers' decoded revert. */ }
  }
  assert.equal(decoded ?? caught.revert?.name, expectedName, `Wrong revert: ${caught.shortMessage ?? caught.message}`);
}

async function main() {
  assert.equal((await provider.getNetwork()).chainId, 31337n);
  assert.notEqual(config.productRegistry, ZeroAddress);
  assert.notEqual(config.warrantyManager, ZeroAddress);
  assert.notEqual(await provider.getCode(config.productRegistry), "0x");
  assert.notEqual(await provider.getCode(config.warrantyManager), "0x");
  assert.equal((await registry.warrantyManager()).toLowerCase(), config.warrantyManager.toLowerCase());
  assert.equal((await warranty.registry()).toLowerCase(), config.productRegistry.toLowerCase());
  assert.equal((await api("/health")).ok, true);
  pass("Local chain, deployed contracts, contract linkage and off-chain API are ready");

  const manufacturer = await provider.getSigner(LOCAL_ACCOUNTS.manufacturer);
  const retailer = await provider.getSigner(LOCAL_ACCOUNTS.retailer);
  const customer = await provider.getSigner(LOCAL_ACCOUNTS.customer);
  const serviceCenter = await provider.getSigner(LOCAL_ACCOUNTS.serviceCenter);
  const resaleBuyer = await provider.getSigner(LOCAL_ACCOUNTS.resaleBuyer);
  for (const [role, signer] of [["MANUFACTURER_ROLE", manufacturer], ["RETAILER_ROLE", retailer], ["SERVICE_CENTER_ROLE", serviceCenter]]) {
    assert.equal(await registry.hasRole(roleHash(role), await signer.getAddress()), true, `${role} is not seeded`);
  }
  for (const signer of [customer, resaleBuyer]) {
    for (const role of [ZERO_BYTES32, roleHash("MANUFACTURER_ROLE"), roleHash("RETAILER_ROLE"), roleHash("SERVICE_CENTER_ROLE")]) {
      assert.equal(await registry.hasRole(role, await signer.getAddress()), false, "Customers must not hold stakeholder roles");
    }
  }
  pass("Public local test accounts have the required roles");

  const unique = `${Date.now()}-${process.pid}`;
  const firstSerial = `FRONTEND-QA-${unique}-A`;
  const secondSerial = `FRONTEND-QA-${unique}-B`;
  const modelName = "Frontend acceptance smartwatch";
  const description = "Isolated local frontend acceptance record";
  const duration = 31536000n;
  const maxClaims = 2;

  async function register(serial) {
    const plaintext = await api("/products", {
      method: "POST", status: 201,
      body: { serial: `  ${serial}  `, modelName: ` ${modelName} `, description },
    });
    assert.equal(plaintext.serialHash, serialHash(serial).toLowerCase());
    assert.equal(plaintext.modelName, modelName);
    assert.equal(plaintext.modelId, modelIdFromName(modelName));
    assert.equal(plaintext.description, description);
    const receipt = await mined(`register ${serial}`, registry.connect(manufacturer).registerProduct(
      plaintext.serialHash, BigInt(plaintext.modelId), duration, maxClaims, await retailer.getAddress(),
    ));
    const id = parsedEvent(receipt, registry, "Registered").productId;
    const product = await registry.getProduct(id);
    assert.equal(product.id, id);
    assert.equal(product.modelId, BigInt(plaintext.modelId));
    assert.equal(product.owner, await retailer.getAddress());
    assert.equal(product.warrantyStart, 0n);
    assert.equal(product.claimCount, 0n);
    assert.equal(product.transferLocked, false);
    assert.equal(await registry.isWarrantyActive(id), false);
    return { id, plaintext, receipt };
  }

  const first = await register(firstSerial);
  const second = await register(secondSerial);
  pass("Two unique products store matching metadata and register to the retailer without starting warranty");

  const duplicate = await api("/products", {
    method: "POST", status: 409,
    body: { serial: firstSerial, modelName, description },
  });
  assert.equal(duplicate.error, "serial_exists");
  assert.equal(duplicate.serialHash, first.plaintext.serialHash);
  assert.equal(duplicate.modelId, first.plaintext.modelId);
  assert.deepEqual(await api(`/products/${first.plaintext.serialHash}`), first.plaintext);
  assert.notEqual(serialHash(firstSerial.toLowerCase()), serialHash(firstSerial));
  assert.equal((await registry.verify(serialHash(firstSerial.toLowerCase()))).authentic, false);
  pass("Duplicate serial returns structured conflict without overwriting; serial case is significant");

  const sale = await mined("retailer sells to customer", registry.connect(retailer).transferOwnership(first.id, await customer.getAddress()));
  const start = (await registry.getProduct(first.id)).warrantyStart;
  assert.ok(start > 0n);
  const saleEvent = parsedEvent(sale, registry, "OwnershipTransferred");
  assert.equal(saleEvent.warrantyStarted, true);
  assert.equal(saleEvent.warrantyStart, start);
  const verification = await registry.verify(first.plaintext.serialHash);
  assert.equal(verification.authentic, true);
  assert.equal(verification.productId, first.id);
  assert.equal(verification.owner, await customer.getAddress());
  assert.equal(verification.warrantyActive, true);
  pass("Retail sale starts warranty and authenticity verification reports the correct owner");

  const rawReason = `  Display flicker ${unique}  `;
  const firstReason = await api("/claims", {
    method: "POST", status: 201, body: { productId: first.id.toString(), reasonText: rawReason },
  });
  const secondReason = await api("/claims", {
    method: "POST", status: 201, body: { productId: second.id.toString(), reasonText: rawReason },
  });
  assert.equal(firstReason.reasonHash, reasonHash(rawReason).toLowerCase());
  assert.equal(firstReason.reasonHash, secondReason.reasonHash);
  assert.notEqual(firstReason.reasonHash, reasonHash(rawReason.trim()));
  for (const item of [firstReason, secondReason]) {
    const read = await api(`/claims/${item.reasonHash}?productId=${item.productId}`);
    assert.equal(read.productId, item.productId);
    assert.equal(read.reasonText, rawReason);
    assert.equal(read.createdAt, item.createdAt);
  }
  const ambiguous = await api(`/claims/${firstReason.reasonHash}`, { status: 400 });
  assert.equal(ambiguous.error, "invalid_body");
  pass("Identical raw fault text is resolved by reasonHash plus decimal productId, without trimming");

  const request = await mined("customer requests warranty", warranty.connect(customer).requestWarranty(first.id, firstReason.reasonHash));
  const claimId = parsedEvent(request, warranty, "ClaimRequested").claimId;
  const claim = await warranty.getClaim(claimId);
  assert.equal(claim.productId, first.id);
  assert.equal(claim.requester, await customer.getAddress());
  assert.equal(claim.status, 1n);
  assert.equal(await warranty.pendingClaimOf(first.id), claimId);
  assert.equal((await registry.getProduct(first.id)).transferLocked, true);
  await mustRevert(
    () => registry.connect(customer).transferOwnership.staticCall(first.id, resaleBuyer.address),
    registry, "TransferLocked",
  );
  pass("Warranty request creates a pending claim and blocks ownership transfers");

  const rawNote = `  Replaced display ${unique}  `;
  const storedNote = await api("/notes", { method: "POST", status: 201, body: { noteText: rawNote } });
  assert.equal(storedNote.noteHash, noteHash(rawNote).toLowerCase());
  assert.notEqual(storedNote.noteHash, noteHash(rawNote.trim()));
  assert.equal((await api(`/notes/${storedNote.noteHash}`)).noteText, rawNote);
  await mined("service approves warranty", warranty.connect(serviceCenter).resolveClaim(claimId, true, storedNote.noteHash));
  const approved = await warranty.getClaim(claimId);
  const repaired = await registry.getProduct(first.id);
  assert.equal(approved.status, 2n);
  assert.equal(approved.noteHash, storedNote.noteHash);
  assert.equal(approved.resolver, await serviceCenter.getAddress());
  assert.equal(repaired.claimCount, 1n);
  assert.equal(repaired.transferLocked, false);
  assert.equal(await warranty.pendingClaimOf(first.id), 0n);
  assert.equal(await registry.isWarrantyActive(first.id), true);
  await mustRevert(() => warranty.connect(serviceCenter).resolveClaim.staticCall(claimId, true, ZERO_BYTES32), warranty, "ClaimNotPending");
  pass("Service approval consumes one claim, records raw note hash and unlocks the product exactly once");

  await mined("customer resells product", registry.connect(customer).transferOwnership(first.id, await resaleBuyer.getAddress()));
  const resold = await registry.getProduct(first.id);
  assert.equal(resold.owner, await resaleBuyer.getAddress());
  assert.equal(resold.warrantyStart, start);
  assert.equal(resold.claimCount, 1n);
  pass("Resale changes owner while preserving the original warranty start and claim count");

  const resaleReason = await api("/claims", {
    method: "POST", status: 201,
    body: { productId: first.id.toString(), reasonText: `Resale inspection ${unique}` },
  });
  const secondRequest = await mined("resale buyer requests inspection", warranty.connect(resaleBuyer).requestWarranty(first.id, resaleReason.reasonHash));
  const rejectedId = parsedEvent(secondRequest, warranty, "ClaimRequested").claimId;
  assert.equal((await registry.getProduct(first.id)).transferLocked, true);
  const notePostsBeforeEmpty = notePosts;
  const emptyNoteHash = noteHash("");
  assert.equal(emptyNoteHash, ZERO_BYTES32);
  await mined("service rejects with empty note", warranty.connect(serviceCenter).resolveClaim(rejectedId, false, emptyNoteHash));
  assert.equal(notePosts, notePostsBeforeEmpty, "An empty note must not call POST /notes");
  const rejected = await warranty.getClaim(rejectedId);
  const afterRejection = await registry.getProduct(first.id);
  assert.equal(rejected.status, 3n);
  assert.equal(rejected.noteHash, ZERO_BYTES32);
  assert.equal(afterRejection.transferLocked, false);
  assert.equal(afterRejection.claimCount, 1n);
  assert.equal(afterRejection.warrantyStart, start);
  assert.equal(await warranty.pendingClaimOf(first.id), 0n);
  pass("Rejection with an empty note stores zero hash, performs no note POST, unlocks and preserves claim count");

  const fromBlock = first.receipt.blockNumber;
  // Read the head directly: ethers may cache getBlockNumber briefly after a
  // just-mined transaction on an automining local chain.
  const toBlock = Number(BigInt(await provider.send("eth_blockNumber", [])));
  const transfers = await registry.queryFilter(registry.filters.OwnershipTransferred(first.id), fromBlock, toBlock);
  const requests = await warranty.queryFilter(warranty.filters.ClaimRequested(null, first.id), fromBlock, toBlock);
  const resolutions = await warranty.queryFilter(warranty.filters.ClaimResolved(null, first.id), fromBlock, toBlock);
  assert.equal(transfers.length, 2);
  assert.equal(requests.length, 2);
  assert.equal(resolutions.length, 2);
  assert.ok([...transfers, ...requests, ...resolutions].every((event) => event.args.productId === first.id));
  pass("The product timeline is reproducible from filtered on-chain ownership and warranty events");

  console.log(JSON.stringify({
    ok: true,
    checkpoints,
    productIds: [first.id.toString(), second.id.toString()],
    finalOwner: afterRejection.owner,
    warrantyStart: start.toString(),
    claimCount: afterRejection.claimCount.toString(),
    transferLocked: afterRejection.transferLocked,
    transactions,
  }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(`Acceptance failed: ${error.shortMessage ?? error.message}`);
  process.exitCode = 1;
} finally {
  provider.destroy();
}
