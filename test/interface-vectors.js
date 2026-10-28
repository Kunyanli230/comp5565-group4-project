const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  DEMO_NOTE,
  DEMO_PRODUCT,
  DEMO_REASON,
  DEMO_WARRANTY_SECONDS,
} = require("../shared/constants");
const {
  ROLE_NAME,
  hashUtf8,
  modelIdFromName,
  noteHash,
  reasonHash,
  roleHash,
  serialHash,
  ZERO_BYTES32,
} = require("../shared/hash");
const { vectors } = require("../shared/vectors");

describe("frozen interface vectors", function () {
  it("locks the demo warranty length and the shared sample strings", function () {
    expect(DEMO_WARRANTY_SECONDS).to.equal(31536000);
    expect(DEMO_PRODUCT.warrantyDurationSeconds).to.equal(DEMO_WARRANTY_SECONDS);
    expect(DEMO_PRODUCT.maxClaims).to.equal(2);
    expect(DEMO_PRODUCT.serial).to.equal(vectors.serial.input);
    expect(DEMO_PRODUCT.modelName).to.equal(vectors.model.input);
    expect(DEMO_REASON).to.equal(vectors.reason.input);
    expect(DEMO_NOTE).to.equal(vectors.note.input);
  });

  it("matches Solidity keccak256 and the committed vectors", async function () {
    const probe = await ethers.deployContract("InterfaceProbe");

    const serialOnChain = await probe.hashUtf8(vectors.serial.input);
    expect(serialHash(vectors.serial.input)).to.equal(vectors.serial.hash);
    expect(serialHash(vectors.serial.paddedInput)).to.equal(vectors.serial.hash);
    expect(serialOnChain).to.equal(vectors.serial.hash);

    const differentCaseOnChain = await probe.hashUtf8(vectors.serial.differentCase);
    expect(serialHash(vectors.serial.differentCase)).to.equal(vectors.serial.differentCaseHash);
    expect(differentCaseOnChain).to.equal(vectors.serial.differentCaseHash);
    expect(differentCaseOnChain).to.not.equal(serialOnChain);

    const modelOnChain = await probe.hashUtf8(vectors.model.input);
    expect(hashUtf8(vectors.model.input)).to.equal(vectors.model.hash);
    expect(modelOnChain).to.equal(vectors.model.hash);
    expect(modelIdFromName(vectors.model.input)).to.equal(vectors.model.modelId);
    expect(BigInt(modelOnChain).toString(10)).to.equal(vectors.model.modelId);

    const reasonOnChain = await probe.hashUtf8(vectors.reason.input);
    expect(reasonHash(vectors.reason.input)).to.equal(vectors.reason.hash);
    expect(reasonOnChain).to.equal(vectors.reason.hash);
    const paddedReasonOnChain = await probe.hashUtf8(vectors.reason.paddedInput);
    expect(reasonHash(vectors.reason.paddedInput)).to.equal(vectors.reason.paddedHash);
    expect(paddedReasonOnChain).to.equal(vectors.reason.paddedHash);
    expect(paddedReasonOnChain).to.not.equal(reasonOnChain);

    const noteOnChain = await probe.hashUtf8(vectors.note.input);
    expect(noteHash(vectors.note.input)).to.equal(vectors.note.hash);
    expect(noteOnChain).to.equal(vectors.note.hash);
    expect(noteHash("")).to.equal(ZERO_BYTES32);
    expect(vectors.note.empty).to.equal(ZERO_BYTES32);

    expect(await probe.manufacturerRole()).to.equal(vectors.roles.MANUFACTURER_ROLE);
    expect(await probe.retailerRole()).to.equal(vectors.roles.RETAILER_ROLE);
    expect(await probe.serviceCenterRole()).to.equal(vectors.roles.SERVICE_CENTER_ROLE);
    expect(roleHash(ROLE_NAME.manufacturer)).to.equal(vectors.roles.MANUFACTURER_ROLE);
    expect(roleHash(ROLE_NAME.retailer)).to.equal(vectors.roles.RETAILER_ROLE);
    expect(roleHash(ROLE_NAME.serviceCenter)).to.equal(vectors.roles.SERVICE_CENTER_ROLE);
    expect(await probe.hashUtf8(ROLE_NAME.manufacturer)).to.equal(vectors.roles.MANUFACTURER_ROLE);
  });
});
