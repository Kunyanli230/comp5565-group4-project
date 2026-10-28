/** Hardhat 本地链。部署脚本和前端都用这些值。 */
const CHAIN_ID = 31337;
const RPC_URL = "http://127.0.0.1:8545";
const OFFCHAIN_BASE_URL = "http://127.0.0.1:3001";
const FRONTEND_PORT = 5173;
const FRONTEND_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"];

/** npx hardhat node 默认账户，下标 0 到 5。不要给顾客和转售买家授予角色。 */
const LOCAL_ACCOUNT_INDEX = {
  admin: 0,
  manufacturer: 1,
  retailer: 2,
  customer: 3,
  serviceCenter: 4,
  resaleBuyer: 5,
};

const LOCAL_ACCOUNTS = {
  admin: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  manufacturer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  retailer: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  customer: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  serviceCenter: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  resaleBuyer: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
};

/** 365 天，按每天 86400 秒，不含闰日。 */
const DEMO_WARRANTY_SECONDS = 365 * 24 * 60 * 60;

const DEMO_PRODUCT = {
  serial: "LW-2026-0001",
  modelName: "LuxeWatch X",
  description: "Group demo watch",
  warrantyDurationSeconds: DEMO_WARRANTY_SECONDS,
  maxClaims: 2,
};

const DEMO_REASON = "Screen flicker after charging";
const DEMO_NOTE = "Replaced display module";

const ROUTES = {
  home: "/",
  register: "/register",
  transfer: "/transfer",
  verify: "/verify",
  warranty: "/warranty",
  service: "/service",
  product: "/product/:productId",
};

const DEPLOYMENT_FILE = "deployments/local.json";

module.exports = {
  CHAIN_ID,
  RPC_URL,
  OFFCHAIN_BASE_URL,
  FRONTEND_PORT,
  FRONTEND_ORIGINS,
  LOCAL_ACCOUNT_INDEX,
  LOCAL_ACCOUNTS,
  DEMO_WARRANTY_SECONDS,
  DEMO_PRODUCT,
  DEMO_REASON,
  DEMO_NOTE,
  ROUTES,
  DEPLOYMENT_FILE,
};
