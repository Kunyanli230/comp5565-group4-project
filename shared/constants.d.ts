export const CHAIN_ID: 31337;
export const RPC_URL: "http://127.0.0.1:8545";
export const OFFCHAIN_BASE_URL: "http://127.0.0.1:3001";
export const FRONTEND_PORT: 5173;
export const FRONTEND_ORIGINS: readonly ["http://127.0.0.1:5173", "http://localhost:5173"];
export const LOCAL_ACCOUNT_INDEX: {
  readonly admin: 0;
  readonly manufacturer: 1;
  readonly retailer: 2;
  readonly customer: 3;
  readonly serviceCenter: 4;
  readonly resaleBuyer: 5;
};
export const LOCAL_ACCOUNTS: {
  readonly admin: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  readonly manufacturer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  readonly retailer: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  readonly customer: "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
  readonly serviceCenter: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
  readonly resaleBuyer: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
};
export const DEMO_WARRANTY_SECONDS: number;
export const DEMO_PRODUCT: {
  readonly serial: "LW-2026-0001";
  readonly modelName: "LuxeWatch X";
  readonly description: "Group demo watch";
  readonly warrantyDurationSeconds: number;
  readonly maxClaims: 2;
};
export const DEMO_REASON: "Screen flicker after charging";
export const DEMO_NOTE: "Replaced display module";
export const ROUTES: {
  readonly home: "/";
  readonly register: "/register";
  readonly transfer: "/transfer";
  readonly verify: "/verify";
  readonly warranty: "/warranty";
  readonly service: "/service";
  readonly product: "/product/:productId";
};
export const DEPLOYMENT_FILE: "deployments/local.json";
