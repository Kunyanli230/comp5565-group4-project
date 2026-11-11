const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, test } = require("node:test");

const { createOffchainServer } = require("../offchain/server");
const { storeDemoPlaintext } = require("../scripts/seed");
const { DEMO_PRODUCT } = require("../shared/constants");
const { modelIdFromName, serialHash } = require("../shared/hash");

const TEMP_PREFIX = "comp5565-seed-plaintext-";
const temporaryRoot = fs.realpathSync(os.tmpdir());
const expectedHash = serialHash(DEMO_PRODUCT.serial).toLowerCase();

let server;
let baseUrl;
let temporaryDirectory;
let dataFile;

async function startServer() {
  server = createOffchainServer({ dataFile });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function stopServer() {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
}

async function createExistingProduct(overrides = {}) {
  const response = await fetch(`${baseUrl}/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serial: DEMO_PRODUCT.serial,
      modelName: DEMO_PRODUCT.modelName,
      description: DEMO_PRODUCT.description,
      ...overrides,
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function readExistingProduct() {
  const response = await fetch(`${baseUrl}/products/${expectedHash}`);
  assert.equal(response.status, 200);
  return response.json();
}

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(temporaryRoot, TEMP_PREFIX));
  dataFile = path.join(temporaryDirectory, "data.json");
  await startServer();
});

afterEach(async () => {
  await stopServer();
  if (!temporaryDirectory) return;
  // Resolve and check the exact test directory before recursively deleting it.
  const cleanupDirectory = fs.realpathSync(temporaryDirectory);
  assert.equal(path.dirname(cleanupDirectory), temporaryRoot);
  assert.ok(path.basename(cleanupDirectory).startsWith(TEMP_PREFIX));
  fs.rmSync(cleanupDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

test("首次 seed 应保存演示商品并返回正确的共享哈希", async () => {
  const product = await storeDemoPlaintext(baseUrl);

  assert.equal(product.serialHash, expectedHash);
  assert.equal(product.modelId, modelIdFromName(DEMO_PRODUCT.modelName));
  assert.equal(product.modelName, DEMO_PRODUCT.modelName);
  assert.equal(product.description, DEMO_PRODUCT.description);
  assert.ok(Number.isFinite(Date.parse(product.createdAt)));
  assert.equal(Object.hasOwn(product, "serial"), false);
  assert.deepEqual(await readExistingProduct(), product);

  const stored = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  assert.deepEqual(Object.keys(stored.products), [expectedHash]);
  assert.equal(stored.products[expectedHash].serial, DEMO_PRODUCT.serial);
});

test("重复 seed 和服务重启后应复用完全相同的商品且保持时间与文件内容不变", async () => {
  const original = await storeDemoPlaintext(baseUrl);
  const originalFile = fs.readFileSync(dataFile, "utf8");

  const reused = await storeDemoPlaintext(baseUrl);
  assert.deepEqual(reused, original);
  assert.equal(reused.createdAt, original.createdAt);
  assert.equal(fs.readFileSync(dataFile, "utf8"), originalFile);

  await stopServer();
  await startServer();
  const reusedAfterRestart = await storeDemoPlaintext(baseUrl);
  assert.deepEqual(reusedAfterRestart, original);
  assert.equal(reusedAfterRestart.createdAt, original.createdAt);
  assert.equal(fs.readFileSync(dataFile, "utf8"), originalFile);
});

test("同一序列号已有不同型号时应拒绝 seed 且不覆盖原记录", async () => {
  const existing = await createExistingProduct({ modelName: "Conflicting Model" });
  const originalFile = fs.readFileSync(dataFile, "utf8");

  await assert.rejects(storeDemoPlaintext(baseUrl), /conflicting hashes/);

  assert.deepEqual(await readExistingProduct(), existing);
  assert.equal(fs.readFileSync(dataFile, "utf8"), originalFile);
});

test("同一序列号和型号已有不同描述时应拒绝 seed 且不覆盖原记录", async () => {
  const existing = await createExistingProduct({ description: "Existing custom description" });
  const originalFile = fs.readFileSync(dataFile, "utf8");

  await assert.rejects(
    storeDemoPlaintext(baseUrl),
    /does not match DEMO_PRODUCT; no data was overwritten/,
  );

  assert.deepEqual(await readExistingProduct(), existing);
  assert.equal(fs.readFileSync(dataFile, "utf8"), originalFile);
});

test("链外服务不可用时应明确提示服务地址和启动方式", async () => {
  await stopServer();

  await assert.rejects(storeDemoPlaintext(baseUrl), (error) => {
    assert.match(error.message, /Off-chain API is unavailable/);
    assert.ok(error.message.includes(baseUrl));
    assert.match(error.message, /npm run offchain/);
    return true;
  });
  assert.equal(fs.existsSync(dataFile), false);
});
