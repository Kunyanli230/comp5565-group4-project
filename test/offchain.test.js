const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, test } = require("node:test");

const { createOffchainServer } = require("../offchain/server");
const { noteHash, reasonHash, serialHash } = require("../shared/hash");

let server;
let baseUrl;
let temporaryDirectory;
let dataFile;

async function startServer() {
  server = createOffchainServer({ dataFile });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function stopServer() {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server = undefined;
}

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "comp5565-offchain-"));
  dataFile = path.join(temporaryDirectory, "data.json");
  await startServer();
});

afterEach(async () => {
  await stopServer();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("健康检查和允许的前端来源应返回正确的 CORS 头", async () => {
  const health = await request("/health", {
    headers: { Origin: "http://127.0.0.1:5173" },
  });
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.body, { ok: true });
  assert.equal(
    health.response.headers.get("access-control-allow-origin"),
    "http://127.0.0.1:5173",
  );

  const options = await request("/products", {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:5173" },
  });
  assert.equal(options.response.status, 204);

  const forbidden = await request("/health", {
    headers: { Origin: "http://evil.example" },
  });
  assert.equal(forbidden.response.status, 403);
});

test("产品明文应被保存，哈希应匹配共享算法，并阻止重复序列号", async () => {
  const created = await request("/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serial: "  LW-2026-0001  ",
      modelName: "  LuxeWatch X  ",
      description: "Group demo watch",
    }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.serialHash, serialHash("LW-2026-0001").toLowerCase());
  assert.equal(created.body.modelName, "LuxeWatch X");
  assert.match(created.body.modelId, /^[0-9]+$/);
  assert.equal(Object.hasOwn(created.body, "serial"), false);

  const lookup = await request(`/products/${created.body.serialHash.toUpperCase().replace("0X", "0x")}`);
  assert.equal(lookup.response.status, 200);
  assert.deepEqual(lookup.body, created.body);

  const duplicate = await request("/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serial: "LW-2026-0001", modelName: "Other" }),
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error, "serial_exists");
  assert.equal(duplicate.body.serialHash, created.body.serialHash);

  const stored = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  assert.equal(stored.products[created.body.serialHash].serial, "LW-2026-0001");
});

test("产品接口应拒绝空字段、额外字段和错误的请求体", async () => {
  const empty = await request("/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serial: "   ", modelName: "Watch" }),
  });
  assert.equal(empty.response.status, 400);
  assert.equal(empty.body.error, "empty_field");

  const extra = await request("/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serial: "A", modelName: "B", ownerName: "not allowed" }),
  });
  assert.equal(extra.response.status, 400);
  assert.equal(extra.body.error, "invalid_body");

  const invalidJson = await request("/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(invalidJson.response.status, 400);
  assert.equal(invalidJson.body.error, "invalid_body");
});

test("故障描述不得 trim，且 productId 必须是正十进制字符串", async () => {
  const reasonText = " Screen flicker after charging";
  const created = await request("/claims", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId: "1", reasonText }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.reasonText, reasonText);
  assert.equal(created.body.reasonHash, reasonHash(reasonText).toLowerCase());

  const lookup = await request(`/claims/${created.body.reasonHash}`);
  assert.equal(lookup.response.status, 200);
  assert.deepEqual(lookup.body, created.body);

  for (const productId of ["0", "01", "-1", "1.0", 1]) {
    const invalid = await request("/claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, reasonText: "Fault" }),
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.error, "invalid_body");
  }
});

test("维修备注应保存原始空格，空字符串应被拒绝", async () => {
  const noteText = " Replaced display module ";
  const created = await request("/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ noteText }),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.noteHash, noteHash(noteText).toLowerCase());
  assert.equal(created.body.noteText, noteText);

  const empty = await request("/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ noteText: "" }),
  });
  assert.equal(empty.response.status, 400);
  assert.equal(empty.body.error, "empty_field");
});

test("数据文件在服务重启后仍应被读取", async () => {
  const created = await request("/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serial: "PERSIST-1", modelName: "Persistent Model" }),
  });
  assert.equal(created.response.status, 201);

  await stopServer();
  await startServer();
  const lookup = await request(`/products/${created.body.serialHash}`);
  assert.equal(lookup.response.status, 200);
  assert.equal(lookup.body.modelName, "Persistent Model");
});

test("未知或格式错误的哈希查询应返回统一的 not_found 错误", async () => {
  for (const route of [
    `/products/${"0x" + "00".repeat(32)}`,
    "/claims/not-a-hash",
    `/notes/${"0x" + "11".repeat(32)}`,
  ]) {
    const result = await request(route);
    assert.equal(result.response.status, 404);
    assert.equal(result.body.error, "not_found");
    assert.equal(typeof result.body.message, "string");
  }
});

test("坏URL和非法Unicode不能中断服务，合法中文与emoji仍可存储", async () => {
  for (const route of ["/products/%", "/claims/%FF"]) {
    const bad = await request(route);
    assert.equal(bad.response.status, 400);
    assert.equal(bad.body.error, "invalid_body");
    assert.equal((await request("/health")).response.status, 200);
  }
  for (const [route, body] of [
    ["/products", { serial: "BAD-\ud800", modelName: "Watch" }],
    ["/products", { serial: "VALID", modelName: "\udc00" }],
    ["/claims", { productId: "1", reasonText: "\ud800" }],
    ["/notes", { noteText: "\ud800" }],
  ]) {
    const bad = await request(route, { method: "POST", body: JSON.stringify(body) });
    assert.equal(bad.response.status, 400);
    assert.equal(bad.body.error, "invalid_body");
    assert.equal((await request("/health")).response.status, 200);
  }
  const good = await request("/notes", { method: "POST", body: JSON.stringify({ noteText: "维修完成 ⌚😀" }) });
  assert.equal(good.response.status, 201);
  assert.equal(good.body.noteHash, noteHash("维修完成 ⌚😀"));
});

test("相同原因的多产品记录独立保存并在重启后可准确查询", async () => {
  const reasonText = "Same fault";
  const post = productId => request("/claims", { method: "POST", body: JSON.stringify({ productId, reasonText }) });
  const first = await post("1");
  const second = await post("2");
  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 201);
  assert.equal(first.body.reasonHash, second.body.reasonHash);
  assert.deepEqual((await post("1")).body, first.body);
  await stopServer();
  await startServer();
  const route = `/claims/${first.body.reasonHash}`;
  assert.deepEqual((await request(route + "?productId=1")).body, first.body);
  assert.deepEqual((await request(route + "?productId=2")).body, second.body);
  assert.equal((await request(route)).response.status, 400);
  assert.equal((await request(route + "?productId=3")).response.status, 404);
  assert.equal((await request(route + "?productId=01")).response.status, 400);
});

test("旧版本数据自动兼容，新产品不得覆盖旧关联", async () => {
  await stopServer();
  const reasonText = "Legacy fault";
  const hash = reasonHash(reasonText);
  const legacy = { productId: "9", reasonHash: hash, reasonText, createdAt: "2026-01-01T00:00:00.000Z" };
  fs.writeFileSync(dataFile, JSON.stringify({ products: {}, claims: { [hash]: legacy }, notes: {} }));
  await startServer();
  assert.deepEqual((await request(`/claims/${hash}`)).body, legacy);
  const added = await request("/claims", { method: "POST", body: JSON.stringify({ productId: "10", reasonText }) });
  assert.equal(added.response.status, 201);
  await stopServer();
  await startServer();
  assert.deepEqual((await request(`/claims/${hash}?productId=9`)).body, legacy);
  assert.deepEqual((await request(`/claims/${hash}?productId=10`)).body, added.body);
});

test("存储失败返回500且不产生虚假成功记录，恢复后可重试", async () => {
  fs.mkdirSync(dataFile); // This test's private temporary path is deliberately unwritable as a file.
  const body = JSON.stringify({ serial: "RETRY-DISK", modelName: "Watch" });
  const failed = await request("/products", { method: "POST", body });
  assert.equal(failed.response.status, 500);
  assert.equal(failed.body.error, "internal_error");
  assert.equal((await request("/health")).response.status, 200);
  assert.equal((await request(`/products/${serialHash("RETRY-DISK")}`)).response.status, 404);
  fs.rmdirSync(dataFile);
  assert.equal((await request("/products", { method: "POST", body })).response.status, 201);
});

