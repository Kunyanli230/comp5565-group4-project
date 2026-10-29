const fs = require("node:fs");
const path = require("node:path");

const hre = require("hardhat");
const {
  CHAIN_ID,
  DEPLOYMENT_FILE,
  LOCAL_ACCOUNTS,
  OFFCHAIN_BASE_URL,
  RPC_URL,
} = require("../shared/constants");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_FILE = path.join(ROOT, DEPLOYMENT_FILE);

async function deploy() {
  const { ethers } = hre;
  const [admin] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== CHAIN_ID) {
    throw new Error(`Expected chainId ${CHAIN_ID}, received ${network.chainId}`);
  }

  const Registry = await ethers.getContractFactory("ProductRegistry", admin);
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();

  const Warranty = await ethers.getContractFactory("WarrantyManager", admin);
  const warranty = await Warranty.deploy(registryAddress);
  await warranty.waitForDeployment();
  const warrantyAddress = await warranty.getAddress();

  const linkTransaction = await registry.connect(admin).setWarrantyManager(warrantyAddress);
  await linkTransaction.wait();

  const deployment = {
    chainId: CHAIN_ID,
    rpcUrl: RPC_URL,
    offchainBaseUrl: OFFCHAIN_BASE_URL,
    productRegistry: registryAddress,
    warrantyManager: warrantyAddress,
    accounts: LOCAL_ACCOUNTS,
  };
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");

  console.log(`ProductRegistry deployed at ${registryAddress}`);
  console.log(`WarrantyManager deployed at ${warrantyAddress}`);
  console.log(`Deployment manifest written to ${DEPLOYMENT_FILE}`);
  return deployment;
}

if (require.main === module) {
  deploy().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { deploy };

