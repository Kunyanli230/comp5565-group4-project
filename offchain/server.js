const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const { FRONTEND_ORIGINS } = require("../shared/constants");
const { modelIdFromName, noteHash, reasonHash, serialHash } = require("../shared/hash");

const HOST = "127.0.0.1";
const PORT = 3001;
const DEFAULT_DATA_FILE = path.join(__dirname, "data.json");
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const PRODUCT_ID = /^[1-9][0-9]*$/;
const MAX_BODY_BYTES = 1024 * 1024;

function emptyStore() {
  return { products: {}, claims: {}, notes: {} };
}

function loadStore(dataFile) {
  if (!fs.existsSync(dataFile)) return emptyStore();
  const parsed = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  return {
    products: parsed.products && typeof parsed.products === "object" ? parsed.products : {},
    claims: parsed.claims && typeof parsed.claims === "object" ? parsed.claims : {},
    notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
  };
}

function saveStore(dataFile, store) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  const temporary = `${dataFile}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, dataFile);
}

function sendJson(response, statusCode, body, extraHeaders = {}) {
  const content = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(content),
    ...extraHeaders,
  });
  response.end(content);
}

function sendError(response, statusCode, error, message, extra = {}, headers = {}) {
  sendJson(response, statusCode, { error, message, ...extra }, headers);
}

function corsHeaders(origin) {
  if (!origin || !FRONTEND_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function hasExactKeys(body, required, optional = []) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(body, key))
    && Object.keys(body).every((key) => allowed.has(key));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
        reject(new Error("request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function normalizeHash(value) {
  return BYTES32.test(value) ? value.toLowerCase() : null;
}

function publicProduct(record) {
  return {
    serialHash: record.serialHash,
    modelId: record.modelId,
    modelName: record.modelName,
    description: record.description,
    createdAt: record.createdAt,
  };
}

function createHandler({ dataFile = DEFAULT_DATA_FILE } = {}) {
  const store = loadStore(dataFile);

  return async function handler(request, response) {
    const origin = request.headers.origin;
    const headers = corsHeaders(origin);

    if (origin && !FRONTEND_ORIGINS.includes(origin)) {
      sendError(response, 403, "invalid_body", "Origin is not allowed");
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204, headers);
      response.end();
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
    const pathname = decodeURIComponent(url.pathname);

    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, { ok: true }, headers);
      return;
    }

    if (request.method === "POST" && pathname === "/products") {
      let body;
      try {
        body = await readJson(request);
      } catch (error) {
        sendError(response, 400, "invalid_body", error.message, {}, headers);
        return;
      }
      if (!hasExactKeys(body, ["serial", "modelName"], ["description"])
          || typeof body.serial !== "string"
          || typeof body.modelName !== "string"
          || (body.description !== undefined && typeof body.description !== "string")) {
        sendError(response, 400, "invalid_body", "Body must match CreateProductBody", {}, headers);
        return;
      }
      if (!body.serial.trim() || !body.modelName.trim()) {
        sendError(response, 400, "empty_field", "serial and modelName must not be empty", {}, headers);
        return;
      }

      const serial = body.serial.trim();
      const modelName = body.modelName.trim();
      const serialKey = serialHash(serial).toLowerCase();
      const existing = store.products[serialKey];
      if (existing) {
        sendError(
          response,
          409,
          "serial_exists",
          "This serial number has already been stored",
          { serialHash: existing.serialHash, modelId: existing.modelId },
          headers,
        );
        return;
      }

      const record = {
        serial,
        serialHash: serialKey,
        modelId: modelIdFromName(modelName),
        modelName,
        description: body.description ?? "",
        createdAt: new Date().toISOString(),
      };
      store.products[serialKey] = record;
      saveStore(dataFile, store);
      sendJson(response, 201, publicProduct(record), headers);
      return;
    }

    const productMatch = pathname.match(/^\/products\/([^/]+)$/);
    if (request.method === "GET" && productMatch) {
      const key = normalizeHash(productMatch[1]);
      const record = key ? store.products[key] : undefined;
      if (!record) {
        sendError(response, 404, "not_found", "Product was not found", {}, headers);
        return;
      }
      sendJson(response, 200, publicProduct(record), headers);
      return;
    }

    if (request.method === "POST" && pathname === "/claims") {
      let body;
      try {
        body = await readJson(request);
      } catch (error) {
        sendError(response, 400, "invalid_body", error.message, {}, headers);
        return;
      }
      if (!hasExactKeys(body, ["productId", "reasonText"])
          || typeof body.productId !== "string"
          || typeof body.reasonText !== "string") {
        sendError(response, 400, "invalid_body", "Body must match CreateClaimReasonBody", {}, headers);
        return;
      }
      if (!PRODUCT_ID.test(body.productId)) {
        sendError(response, 400, "invalid_body", "productId must be a positive decimal string", {}, headers);
        return;
      }
      if (body.reasonText.length === 0) {
        sendError(response, 400, "empty_field", "reasonText must not be empty", {}, headers);
        return;
      }

      const key = reasonHash(body.reasonText).toLowerCase();
      const record = {
        productId: body.productId,
        reasonHash: key,
        reasonText: body.reasonText,
        createdAt: new Date().toISOString(),
      };
      store.claims[key] = record;
      saveStore(dataFile, store);
      sendJson(response, 201, record, headers);
      return;
    }

    const claimMatch = pathname.match(/^\/claims\/([^/]+)$/);
    if (request.method === "GET" && claimMatch) {
      const key = normalizeHash(claimMatch[1]);
      const record = key ? store.claims[key] : undefined;
      if (!record) {
        sendError(response, 404, "not_found", "Claim reason was not found", {}, headers);
        return;
      }
      sendJson(response, 200, record, headers);
      return;
    }

    if (request.method === "POST" && pathname === "/notes") {
      let body;
      try {
        body = await readJson(request);
      } catch (error) {
        sendError(response, 400, "invalid_body", error.message, {}, headers);
        return;
      }
      if (!hasExactKeys(body, ["noteText"]) || typeof body.noteText !== "string") {
        sendError(response, 400, "invalid_body", "Body must match CreateNoteBody", {}, headers);
        return;
      }
      if (body.noteText.length === 0) {
        sendError(response, 400, "empty_field", "noteText must not be empty", {}, headers);
        return;
      }

      const key = noteHash(body.noteText).toLowerCase();
      const record = {
        noteHash: key,
        noteText: body.noteText,
        createdAt: new Date().toISOString(),
      };
      store.notes[key] = record;
      saveStore(dataFile, store);
      sendJson(response, 201, record, headers);
      return;
    }

    const noteMatch = pathname.match(/^\/notes\/([^/]+)$/);
    if (request.method === "GET" && noteMatch) {
      const key = normalizeHash(noteMatch[1]);
      const record = key ? store.notes[key] : undefined;
      if (!record) {
        sendError(response, 404, "not_found", "Service note was not found", {}, headers);
        return;
      }
      sendJson(response, 200, record, headers);
      return;
    }

    sendError(response, 404, "not_found", "Route was not found", {}, headers);
  };
}

function createOffchainServer(options) {
  return http.createServer(createHandler(options));
}

if (require.main === module) {
  const server = createOffchainServer();
  server.listen(PORT, HOST, () => {
    console.log(`Off-chain API listening at http://${HOST}:${PORT}`);
  });
}

module.exports = { createHandler, createOffchainServer, loadStore };

