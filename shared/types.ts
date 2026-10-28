/** 链下 HTTP 的请求和响应。`uint256` 全部用十进制字符串。 */

export interface ProductRecord {
  serialHash: string;
  modelId: string;
  modelName: string;
  description: string;
  createdAt: string;
}

export interface CreateProductBody {
  serial: string;
  modelName: string;
  description?: string;
}

export interface ClaimReasonRecord {
  productId: string;
  reasonHash: string;
  reasonText: string;
  createdAt: string;
}

export interface CreateClaimReasonBody {
  productId: string;
  reasonText: string;
}

export interface NoteRecord {
  noteHash: string;
  noteText: string;
  createdAt: string;
}

export interface CreateNoteBody {
  noteText: string;
}

export type OffchainErrorCode =
  | "empty_field"
  | "invalid_body"
  | "serial_exists"
  | "not_found";

export interface OffchainErrorBody {
  error: OffchainErrorCode;
  message: string;
}

export interface SerialExistsBody extends OffchainErrorBody {
  error: "serial_exists";
  serialHash: string;
  modelId: string;
}

/** `scripts/deploy.js` 写出的 `deployments/local.json`。 */
export interface DeploymentFile {
  chainId: 31337;
  rpcUrl: string;
  offchainBaseUrl: string;
  productRegistry: string;
  warrantyManager: string;
  accounts: {
    admin: string;
    manufacturer: string;
    retailer: string;
    customer: string;
    serviceCenter: string;
    resaleBuyer: string;
  };
}
