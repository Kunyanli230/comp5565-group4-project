export const ZERO_BYTES32: "0x0000000000000000000000000000000000000000000000000000000000000000";
export const ROLE_NAME: {
  readonly manufacturer: "MANUFACTURER_ROLE";
  readonly retailer: "RETAILER_ROLE";
  readonly serviceCenter: "SERVICE_CENTER_ROLE";
};
export type Bytes32 = `0x${string}`;
export function hashUtf8(value: string): Bytes32;
export function normalizeText(value: string): string;
export function serialHash(serial: string): Bytes32;
export function modelIdFromName(modelName: string): string;
export function reasonHash(reasonText: string): Bytes32;
export function noteHash(noteText: string): Bytes32;
export function roleHash(roleName: string): Bytes32;
