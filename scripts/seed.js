const fs = require("node:fs");
const path = require("node:path");

const hre = require("hardhat");
const {
  DEMO_PRODUCT,
  DEPLOYMENT_FILE,
  LOCAL_ACCOUNT_INDEX,
  LOCAL_ACCOUNTS,
} = require("../shared/constants");
const { modelIdFromName, serialHash } = require("../shared/hash");

const ROOT = path.resolve(__dirname, "..");
const DEPLOYMENT_PATH = path.join(ROOT, DEPLOYMENT_FILE);

function readDeployment() {
  if (!fs.existsSync(DEPLOYMENT_PATH)) {
    throw new Error(`Missing ${DEPLOYMENT_FILE}. Run npm run deploy:local first.`);
  }
  return JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
}

async function storeDemoPlaintext(baseUrl) {
  let response;
  try {
    response = await fetch(`${baseUrl}/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serial: DEMO_PRODUCT.serial,
        modelName: DEMO_PRODUCT.modelName,
        description: DEMO_PRODUCT.description,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    throw new Error(
      `Off-chain API is unavailable at ${baseUrl}. Start it with npm run offchain before seeding. (${error.message})`,
    );
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Off-chain product storage failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function grantRoleIfMissing(registry, role, account, admin) {
  if (!(await registry.hasRole(role, account))) {
    await (await registry.connect(admin).grantRole(role, account)).wait();
  }
}

async function seed() {
  const { ethers } = hre;
  const deployment = readDeployment();
  const signers = await ethers.getSigners();
  const admin = signers[LOCAL_ACCOUNT_INDEX.admin];
  const manufacturer = signers[LOCAL_ACCOUNT_INDEX.manufacturer];

  const registry = await ethers.getContractAt(
    "ProductRegistry",
    deployment.productRegistry,
    admin,
  );

  const manufacturerRole = await registry.MANUFACTURER_ROLE();
  const retailerRole = await registry.RETAILER_ROLE();
  const serviceCenterRole = await registry.SERVICE_CENTER_ROLE();

  await grantRoleIfMissing(registry, manufacturerRole, LOCAL_ACCOUNTS.manufacturer, admin);
  await grantRoleIfMissing(registry, retailerRole, LOCAL_ACCOUNTS.retailer, admin);
  await grantRoleIfMissing(registry, serviceCenterRole, LOCAL_ACCOUNTS.serviceCenter, admin);

  const offchainRecord = await storeDemoPlaintext(deployment.offchainBaseUrl);
  const expectedSerialHash = serialHash(DEMO_PRODUCT.serial).toLowerCase();
  const expectedModelId = modelIdFromName(DEMO_PRODUCT.modelName);
  if (offchainRecord.serialHash !== expectedSerialHash || offchainRecord.modelId !== expectedModelId) {
    throw new Error("Off-chain API returned hashes that do not match shared/hash.js");
  }

  const productId = await registry.nextProductId();
  const registerTransaction = await registry.connect(manufacturer).registerProduct(
    expectedSerialHash,
    BigInt(expectedModelId),
    DEMO_PRODUCT.warrantyDurationSeconds,
    DEMO_PRODUCT.maxClaims,
    LOCAL_ACCOUNTS.retailer,
  );
  await registerTransaction.wait();

  const product = await registry.getProduct(productId);
  if (product.owner.toLowerCase() !== LOCAL_ACCOUNTS.retailer.toLowerCase()
      || product.warrantyStart !== 0n
      || product.claimCount !== 0n
      || product.transferLocked !== false) {
    throw new Error("Seeded product does not match the required initial on-chain state");
  }

  console.log(`Granted local roles and registered demo product ${productId}`);
  console.log(`serialHash=${expectedSerialHash}`);
  console.log(`modelId=${expectedModelId}`);
  return { productId, serialHash: expectedSerialHash, modelId: expectedModelId };
}

if (require.main === module) {
  seed().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { readDeployment, seed, storeDemoPlaintext };

