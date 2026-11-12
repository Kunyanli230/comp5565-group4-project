const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  impersonateAccount,
  loadFixture,
  setBalance,
  time,
} = require("@nomicfoundation/hardhat-network-helpers");

describe("ProductRegistry", function () {
  const SERIAL = ethers.id("LW-2026-0001");
  const SERIAL_2 = ethers.id("LW-2026-0002");
  const MODEL_ID = BigInt(ethers.id("LuxeWatch X"));

  async function deployFixture() {
    const [admin, manufacturer, retailer, customer, serviceCenter, resaleBuyer, other] =
      await ethers.getSigners();
    const registry = await ethers.deployContract("ProductRegistry");
    const manager = await ethers.deployContract("InterfaceProbe");

    const manufacturerRole = await registry.MANUFACTURER_ROLE();
    const retailerRole = await registry.RETAILER_ROLE();
    const serviceCenterRole = await registry.SERVICE_CENTER_ROLE();
    await registry.grantRole(manufacturerRole, manufacturer.address);
    await registry.grantRole(retailerRole, retailer.address);
    await registry.grantRole(serviceCenterRole, serviceCenter.address);

    return {
      registry,
      manager,
      admin,
      manufacturer,
      retailer,
      customer,
      serviceCenter,
      resaleBuyer,
      other,
      manufacturerRole,
      retailerRole,
      serviceCenterRole,
    };
  }

  async function register(registry, manufacturer, retailer, options = {}) {
    const serial = options.serial ?? SERIAL;
    const duration = options.duration ?? 365 * 24 * 60 * 60;
    const maxClaims = options.maxClaims ?? 2;
    await registry
      .connect(manufacturer)
      .registerProduct(serial, MODEL_ID, duration, maxClaims, retailer.address);
    return 1n;
  }

  async function linkedFixture() {
    const fixture = await deployFixture();
    const managerAddress = await fixture.manager.getAddress();
    await fixture.registry.setWarrantyManager(managerAddress);
    await impersonateAccount(managerAddress);
    await setBalance(managerAddress, ethers.parseEther("1"));
    fixture.managerSigner = await ethers.getSigner(managerAddress);
    await register(fixture.registry, fixture.manufacturer, fixture.retailer);
    return fixture;
  }

  it("initializes the admin and frozen role constants", async function () {
    const { registry, admin, manufacturer, manufacturerRole } = await loadFixture(deployFixture);
    expect(await registry.nextProductId()).to.equal(1);
    expect(await registry.warrantyManager()).to.equal(ethers.ZeroAddress);
    expect(await registry.DEFAULT_ADMIN_ROLE()).to.equal(ethers.ZeroHash);
    expect(await registry.hasRole(ethers.ZeroHash, admin.address)).to.equal(true);
    expect(await registry.hasRole(manufacturerRole, manufacturer.address)).to.equal(true);
  });

  it("registers a complete product before the warranty manager is linked", async function () {
    const { registry, manufacturer, retailer } = await loadFixture(deployFixture);
    const tx = await registry
      .connect(manufacturer)
      .registerProduct(SERIAL, MODEL_ID, 31536000, 2, retailer.address);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt.blockNumber);

    await expect(tx)
      .to.emit(registry, "Registered")
      .withArgs(1, SERIAL, manufacturer.address, retailer.address, MODEL_ID, 31536000, 2, block.timestamp);

    const product = await registry.getProduct(1);
    expect(product.id).to.equal(1);
    expect(product.serialHash).to.equal(SERIAL);
    expect(product.modelId).to.equal(MODEL_ID);
    expect(product.manufacturer).to.equal(manufacturer.address);
    expect(product.retailer).to.equal(retailer.address);
    expect(product.owner).to.equal(retailer.address);
    expect(product.manufacturedAt).to.equal(block.timestamp);
    expect(product.warrantyStart).to.equal(0);
    expect(product.claimCount).to.equal(0);
    expect(product.transferLocked).to.equal(false);
    expect(await registry.nextProductId()).to.equal(2);
    expect(await registry.productIdBySerial(SERIAL)).to.equal(1);
  });

  it("rejects unauthorized registration and invalid registration data", async function () {
    const { registry, manufacturer, retailer, customer } = await loadFixture(deployFixture);
    await expect(
      registry.connect(customer).registerProduct(SERIAL, MODEL_ID, 1, 1, retailer.address)
    ).to.be.revertedWithCustomError(registry, "NotManufacturer").withArgs(customer.address);
    await expect(
      registry.connect(manufacturer).registerProduct(ethers.ZeroHash, MODEL_ID, 1, 1, retailer.address)
    ).to.be.revertedWithCustomError(registry, "EmptyHash");
    await expect(
      registry.connect(manufacturer).registerProduct(SERIAL, MODEL_ID, 0, 1, retailer.address)
    ).to.be.revertedWithCustomError(registry, "InvalidWarrantyTerms");
    await expect(
      registry.connect(manufacturer).registerProduct(SERIAL, MODEL_ID, 1, 0, retailer.address)
    ).to.be.revertedWithCustomError(registry, "InvalidWarrantyTerms");
    await expect(
      registry.connect(manufacturer).registerProduct(SERIAL, MODEL_ID, 1, 1, customer.address)
    ).to.be.revertedWithCustomError(registry, "NotRetailer").withArgs(customer.address);
  });

  it("rejects duplicate serial hashes", async function () {
    const { registry, manufacturer, retailer } = await loadFixture(deployFixture);
    await register(registry, manufacturer, retailer);
    await expect(
      registry.connect(manufacturer).registerProduct(SERIAL, MODEL_ID, 1, 1, retailer.address)
    ).to.be.revertedWithCustomError(registry, "SerialAlreadyRegistered").withArgs(SERIAL);
  });

  it("starts the warranty only on the first transfer to a role-free account", async function () {
    const { registry, manufacturer, retailer, customer, resaleBuyer } = await loadFixture(deployFixture);
    await register(registry, manufacturer, retailer, { duration: 1000 });

    const roleTransfer = await registry.connect(retailer).transferOwnership(1, manufacturer.address);
    const roleReceipt = await roleTransfer.wait();
    const roleBlock = await ethers.provider.getBlock(roleReceipt.blockNumber);
    await expect(roleTransfer)
      .to.emit(registry, "OwnershipTransferred")
      .withArgs(1, retailer.address, manufacturer.address, false, 0, roleBlock.timestamp);
    expect((await registry.getProduct(1)).warrantyStart).to.equal(0);

    const customerTransfer = await registry.connect(manufacturer).transferOwnership(1, customer.address);
    const customerReceipt = await customerTransfer.wait();
    const customerBlock = await ethers.provider.getBlock(customerReceipt.blockNumber);
    await expect(customerTransfer)
      .to.emit(registry, "OwnershipTransferred")
      .withArgs(1, manufacturer.address, customer.address, true, customerBlock.timestamp, customerBlock.timestamp);

    await registry.connect(customer).transferOwnership(1, resaleBuyer.address);
    const product = await registry.getProduct(1);
    expect(product.owner).to.equal(resaleBuyer.address);
    expect(product.warrantyStart).to.equal(customerBlock.timestamp);
  });

  it("rejects unknown products, non-owners and invalid recipients", async function () {
    const { registry, manager, manufacturer, retailer, customer } = await loadFixture(deployFixture);
    await register(registry, manufacturer, retailer);
    await registry.setWarrantyManager(await manager.getAddress());

    await expect(registry.connect(retailer).transferOwnership(999, customer.address))
      .to.be.revertedWithCustomError(registry, "UnknownProduct").withArgs(999);
    await expect(registry.connect(customer).transferOwnership(1, customer.address))
      .to.be.revertedWithCustomError(registry, "NotProductOwner")
      .withArgs(customer.address, retailer.address);
    for (const target of [
      ethers.ZeroAddress,
      retailer.address,
      await registry.getAddress(),
      await manager.getAddress(),
    ]) {
      await expect(registry.connect(retailer).transferOwnership(1, target))
        .to.be.revertedWithCustomError(registry, "InvalidRecipient").withArgs(target);
    }
  });

  it("links one deployed warranty manager and rejects invalid links", async function () {
    const { registry, manager, admin, customer } = await loadFixture(deployFixture);
    await expect(registry.connect(customer).setWarrantyManager(await manager.getAddress()))
      .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
      .withArgs(customer.address, ethers.ZeroHash);
    for (const target of [ethers.ZeroAddress, customer.address, await registry.getAddress()]) {
      await expect(registry.connect(admin).setWarrantyManager(target))
        .to.be.revertedWithCustomError(registry, "WarrantyManagerNotContract").withArgs(target);
    }
    await expect(registry.setWarrantyManager(await manager.getAddress()))
      .to.emit(registry, "WarrantyManagerSet").withArgs(await manager.getAddress());
    await expect(registry.setWarrantyManager(await manager.getAddress()))
      .to.be.revertedWithCustomError(registry, "WarrantyManagerAlreadySet")
      .withArgs(await manager.getAddress());
  });

  it("allows only the linked manager to lock and unlock transfers", async function () {
    const { registry, managerSigner, retailer, customer } = await loadFixture(linkedFixture);
    await expect(registry.connect(customer).lockTransfer(1))
      .to.be.revertedWithCustomError(registry, "NotWarrantyManager").withArgs(customer.address);
    await registry.connect(managerSigner).lockTransfer(1);
    expect((await registry.getProduct(1)).transferLocked).to.equal(true);
    await expect(registry.connect(managerSigner).lockTransfer(1))
      .to.be.revertedWithCustomError(registry, "TransferAlreadyLocked").withArgs(1);
    await expect(registry.connect(retailer).transferOwnership(1, customer.address))
      .to.be.revertedWithCustomError(registry, "TransferLocked").withArgs(1);
    await registry.connect(managerSigner).unlockTransfer(1);
    await expect(registry.connect(managerSigner).unlockTransfer(1))
      .to.be.revertedWithCustomError(registry, "TransferNotLocked").withArgs(1);
  });

  it("records claims only while locked and enforces the claim limit", async function () {
    const { registry, managerSigner } = await loadFixture(linkedFixture);
    await expect(registry.connect(managerSigner).recordClaim(1))
      .to.be.revertedWithCustomError(registry, "TransferNotLocked").withArgs(1);
    await registry.connect(managerSigner).lockTransfer(1);
    expect(await registry.connect(managerSigner).recordClaim.staticCall(1)).to.equal(1);
    await registry.connect(managerSigner).recordClaim(1);
    expect((await registry.getProduct(1)).claimCount).to.equal(1);
    await registry.connect(managerSigner).recordClaim(1);
    await expect(registry.connect(managerSigner).recordClaim(1))
      .to.be.revertedWithCustomError(registry, "ClaimLimitReached").withArgs(1);
  });

  it("reports authenticity and unknown serials without reverting", async function () {
    const { registry, manufacturer, retailer, customer } = await loadFixture(deployFixture);
    expect(await registry.verify(SERIAL_2)).to.deep.equal([false, 0n, ethers.ZeroAddress, false]);
    expect(await registry.productIdBySerial(SERIAL_2)).to.equal(0);
    await register(registry, manufacturer, retailer, { duration: 100 });
    expect(await registry.verify(SERIAL)).to.deep.equal([true, 1n, retailer.address, false]);
    await registry.connect(retailer).transferOwnership(1, customer.address);
    expect(await registry.verify(SERIAL)).to.deep.equal([true, 1n, customer.address, true]);
  });

  it("uses an inclusive warranty deadline and ignores transfer locks", async function () {
    const { registry, managerSigner, retailer, customer } = await loadFixture(linkedFixture);
    await registry.connect(retailer).transferOwnership(1, customer.address);
    const product = await registry.getProduct(1);
    const deadline = product.warrantyStart + product.warrantyDuration;
    await registry.connect(managerSigner).lockTransfer(1);
    expect(await registry.isWarrantyActive(1)).to.equal(true);
    await time.increaseTo(deadline);
    expect(await registry.isWarrantyActive(1)).to.equal(true);
    await time.increase(1);
    expect(await registry.isWarrantyActive(1)).to.equal(false);
    expect(await registry.isWarrantyActive(999)).to.equal(false);
  });

  it("reverts product getters for unknown ids and rejects Ether", async function () {
    const { registry, admin } = await loadFixture(deployFixture);
    await expect(registry.ownerOf(99)).to.be.revertedWithCustomError(registry, "UnknownProduct").withArgs(99);
    await expect(registry.getProduct(99)).to.be.revertedWithCustomError(registry, "UnknownProduct").withArgs(99);
    await expect(admin.sendTransaction({ to: await registry.getAddress(), value: 1 })).to.be.reverted;
  });
});
