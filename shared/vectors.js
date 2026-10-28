/** 与 Solidity keccak256、shared/hash.js 三方一致。由 test/interface-vectors.js 锁定。 */
const vectors = {
  serial: {
    input: "LW-2026-0001",
    paddedInput: "  LW-2026-0001  ",
    differentCase: "lw-2026-0001",
    hash: "0xeb28d70354a1cf595385ae6f176a459f71390a488bbc577a07e2898611744c21",
    differentCaseHash: "0x8def531a65b6dbc5a925614d85e643379364bfa1c81dc0a97d23fb14613d0e7e",
  },
  model: {
    input: "LuxeWatch X",
    modelId: "40525494046322591919394463917510793870049414832583048670706315369933776143009",
    hash: "0x59989de5c33dd6d4bfeca6c6ff475483c59b869cdbb7a0705ef66a677c18c2a1",
  },
  reason: {
    input: "Screen flicker after charging",
    paddedInput: " Screen flicker after charging",
    hash: "0x8c58dfa439c6a90784b85118da649c033f7202687eb6830f3fb7a28eeaa59ba7",
    paddedHash: "0x0f06fa3490ce8c1d9c3f5cbd89b6199b28dd30adae47eaf870981ded4a1fcce1",
  },
  note: {
    input: "Replaced display module",
    hash: "0x72ea0e665d819164115f522adc09e72db6b87a2bc29bf3434ef8c034b77128d4",
    empty: "0x0000000000000000000000000000000000000000000000000000000000000000",
  },
  roles: {
    MANUFACTURER_ROLE: "0xeefb95e842a3287179d933b4460be539a1d5af11aa8b325bb45c5c8dc92de4ed",
    RETAILER_ROLE: "0x2a5f906c256a5d799494fcd066e1f6c077689de1cdb65052a1624de4bace99bf",
    SERVICE_CENTER_ROLE: "0xe00629f427c6136ae9b856b472ff74184d9d0bee21b9336d8fbb33b66079065a",
  },
};

module.exports = { vectors };
