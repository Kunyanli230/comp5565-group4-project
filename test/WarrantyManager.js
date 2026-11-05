const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("WarrantyManager", function () {
  const SERIAL = ethers.id("LW-2026-0001");
  const SERIAL_2 = ethers.id("LW-2026-0002");
  const MODEL_ID = BigInt(ethers.id("LuxeWatch X"));
  const REASON = ethers.id("Screen flicker after charging");
  const NOTE = ethers.id("Replaced display module");

  const PENDING = 1;
  const APPROVED = 2;
  const REJECTED = 3;

  async function deployFixture() {
    const [admin, manufacturer, retailer, customer, serviceCenter, resaleBuyer, other] =
      await ethers.getSigners();

    const registry = await ethers.deployContract("ProductRegistry");
    const warranty = await ethers.deployContract("WarrantyManager", [await registry.getAddress()]);

    const manufacturerRole = await registry.MANUFACTURER_ROLE();
    const retailerRole = await registry.RETAILER_ROLE();
    const serviceCenterRole = await registry.SERVICE_CENTER_ROLE();
    await registry.grantRole(manufacturerRole, manufacturer.address);
    await registry.grantRole(retailerRole, retailer.address);
    await registry.grantRole(serviceCenterRole, serviceCenter.address);

    return {
      registry,
      warranty,
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
    const productId = await registry.nextProductId();
    await registry
      .connect(manufacturer)
      .registerProduct(serial, MODEL_ID, duration, maxClaims, retailer.address);
    return productId;
  }

  async function linkedFixture(options = {}) {
    const fixture = await deployFixture();
    await fixture.registry.setWarrantyManager(await fixture.warranty.getAddress());
    fixture.productId = await register(
      fixture.registry,
      fixture.manufacturer,
      fixture.retailer,
      options,
    );
    return fixture;
  }

  async function activeFixture(options = {}) {
    const fixture = await linkedFixture(options);
    await fixture.registry
      .connect(fixture.retailer)
      .transferOwnership(fixture.productId, fixture.customer.address);
    return fixture;
  }

  describe("deployment and wiring", function () {
    it("starts claim ids at 1 and stores the registry address", async function () {
      const { registry, warranty } = await loadFixture(deployFixture);
      expect(await warranty.nextClaimId()).to.equal(1);
      expect(await warranty.registry()).to.equal(await registry.getAddress());
    });

    it("rejects a zero registry address", async function () {
      const Warranty = await ethers.getContractFactory("WarrantyManager");
      await expect(Warranty.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        Warranty,
        "ZeroAddress",
      );
    });

    it("reverts getClaim for unknown ids", async function () {
      const { warranty } = await loadFixture(deployFixture);
      await expect(warranty.getClaim(999))
        .to.be.revertedWithCustomError(warranty, "UnknownClaim")
        .withArgs(999);
    });

    it("never reverts pendingClaimOf for unknown products", async function () {
      const { warranty } = await loadFixture(deployFixture);
      expect(await warranty.pendingClaimOf(999)).to.equal(0);
    });

    it("blocks every write until the registry points back at this contract", async function () {
      const { warranty, customer } = await loadFixture(deployFixture);
      await expect(warranty.connect(customer).requestWarranty(1, REASON)).to.be.revertedWithCustomError(
        warranty,
        "RegistryNotLinked",
      );
      await expect(
        warranty.connect(customer).resolveClaim(1, true, ethers.ZeroHash),
      ).to.be.revertedWithCustomError(warranty, "RegistryNotLinked");
    });
  });

  describe("requestWarranty", function () {
    it("opens a pending claim for the owner and locks the product", async function () {
      const { registry, warranty, customer, productId } = await loadFixture(activeFixture);

      const tx = await warranty.connect(customer).requestWarranty(productId, REASON);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(warranty, "ClaimRequested")
        .withArgs(1, productId, customer.address, REASON, block.timestamp);

      const claim = await warranty.getClaim(1);
      expect(claim.id).to.equal(1);
      expect(claim.productId).to.equal(productId);
      expect(claim.requester).to.equal(customer.address);
      expect(claim.resolver).to.equal(ethers.ZeroAddress);
      expect(claim.reasonHash).to.equal(REASON);
      expect(claim.noteHash).to.equal(ethers.ZeroHash);
      expect(claim.status).to.equal(PENDING);
      expect(claim.requestedAt).to.equal(block.timestamp);
      expect(claim.resolvedAt).to.equal(0);

      expect(await warranty.pendingClaimOf(productId)).to.equal(1);
      expect(await warranty.nextClaimId()).to.equal(2);
      expect((await registry.getProduct(productId)).transferLocked).to.equal(true);
    });

    it("rejects callers that are not the current owner", async function () {
      const { warranty, customer, other, productId } = await loadFixture(activeFixture);
      await expect(warranty.connect(other).requestWarranty(productId, REASON))
        .to.be.revertedWithCustomError(warranty, "NotProductOwner")
        .withArgs(other.address, customer.address);
    });

    it("rejects an empty reason hash", async function () {
      const { warranty, customer, productId } = await loadFixture(activeFixture);
      await expect(warranty.connect(customer).requestWarranty(productId, ethers.ZeroHash))
        .to.be.revertedWithCustomError(warranty, "EmptyHash");
    });

    it("surfaces UnknownProduct from the registry for missing products", async function () {
      const { registry, warranty, customer } = await loadFixture(activeFixture);
      await expect(warranty.connect(customer).requestWarranty(999, REASON))
        .to.be.revertedWithCustomError(registry, "UnknownProduct")
        .withArgs(999);
    });

    it("rejects products whose warranty has not started", async function () {
      const { registry, warranty, retailer, productId } = await loadFixture(linkedFixture);
      expect((await registry.getProduct(productId)).warrantyStart).to.equal(0);

      await expect(warranty.connect(retailer).requestWarranty(productId, REASON))
        .to.be.revertedWithCustomError(warranty, "WarrantyInactive")
        .withArgs(productId);
    });

    it("allows only one pending claim per product", async function () {
      const { warranty, customer, productId } = await loadFixture(activeFixture);
      await warranty.connect(customer).requestWarranty(productId, REASON);
      await expect(warranty.connect(customer).requestWarranty(productId, REASON))
        .to.be.revertedWithCustomError(warranty, "ClaimPending")
        .withArgs(productId, 1);
    });

    it("assigns increasing claim ids across products", async function () {
      const { registry, warranty, customer, retailer, manufacturer, productId } =
        await loadFixture(activeFixture);

      const second = await register(registry, manufacturer, retailer, { serial: SERIAL_2 });
      await registry.connect(retailer).transferOwnership(second, customer.address);

      await warranty.connect(customer).requestWarranty(productId, REASON);
      await warranty.connect(customer).requestWarranty(second, REASON);

      expect((await warranty.getClaim(1)).productId).to.equal(productId);
      expect((await warranty.getClaim(2)).productId).to.equal(second);
      expect(await warranty.nextClaimId()).to.equal(3);
    });
  });

  describe("resolveClaim", function () {
    async function pendingClaimFixture(options = {}) {
      const fixture = await activeFixture(options);
      await fixture.warranty.connect(fixture.customer).requestWarranty(fixture.productId, REASON);
      return fixture;
    }

    async function singleClaimFixture() {
      return pendingClaimFixture({ maxClaims: 1 });
    }

    it("approves, burns a claim slot and releases the lock", async function () {
      const { registry, warranty, customer, serviceCenter, productId } =
        await loadFixture(pendingClaimFixture);
      const before = await registry.getProduct(productId);

      const tx = await warranty.connect(serviceCenter).resolveClaim(1, true, NOTE);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(tx)
        .to.emit(warranty, "ClaimResolved")
        .withArgs(1, productId, serviceCenter.address, true, NOTE, 1, block.timestamp);

      const claim = await warranty.getClaim(1);
      expect(claim.status).to.equal(APPROVED);
      expect(claim.resolver).to.equal(serviceCenter.address);
      expect(claim.noteHash).to.equal(NOTE);
      expect(claim.resolvedAt).to.equal(block.timestamp);
      expect(await warranty.pendingClaimOf(productId)).to.equal(0);

      const after = await registry.getProduct(productId);
      expect(after.claimCount).to.equal(before.claimCount + 1n);
      expect(after.transferLocked).to.equal(false);

      await registry.connect(customer).transferOwnership(productId, serviceCenter.address);
      expect((await registry.getProduct(productId)).owner).to.equal(serviceCenter.address);
    });

    it("rejects without burning a claim slot and frees the product", async function () {
      const { registry, warranty, serviceCenter, productId } =
        await loadFixture(pendingClaimFixture);
      const before = await registry.getProduct(productId);

      await expect(warranty.connect(serviceCenter).resolveClaim(1, false, ethers.ZeroHash))
        .to.emit(warranty, "ClaimResolved")
        .withArgs(1, productId, serviceCenter.address, false, ethers.ZeroHash, 0, anyValue);

      const claim = await warranty.getClaim(1);
      expect(claim.status).to.equal(REJECTED);
      expect(claim.noteHash).to.equal(ethers.ZeroHash);

      const after = await registry.getProduct(productId);
      expect(after.claimCount).to.equal(before.claimCount);
      expect(after.transferLocked).to.equal(false);
      expect(await warranty.pendingClaimOf(productId)).to.equal(0);
    });

    it("only service centers may resolve a claim", async function () {
      const { warranty, other } = await loadFixture(pendingClaimFixture);
      await expect(warranty.connect(other).resolveClaim(1, true, ethers.ZeroHash))
        .to.be.revertedWithCustomError(warranty, "NotServiceCenter")
        .withArgs(other.address);
    });

    it("stops a requester from resolving their own claim", async function () {
      const { registry, warranty, customer, serviceCenterRole, productId } =
        await loadFixture(pendingClaimFixture);
      await registry.grantRole(serviceCenterRole, customer.address);

      await expect(warranty.connect(customer).resolveClaim(1, true, ethers.ZeroHash))
        .to.be.revertedWithCustomError(warranty, "SelfResolution")
        .withArgs(customer.address);
      expect(await warranty.pendingClaimOf(productId)).to.equal(1);
    });

    it("reverts for unknown and already resolved claims", async function () {
      const { warranty, serviceCenter } = await loadFixture(pendingClaimFixture);

      await expect(warranty.connect(serviceCenter).resolveClaim(999, true, ethers.ZeroHash))
        .to.be.revertedWithCustomError(warranty, "UnknownClaim")
        .withArgs(999);

      await warranty.connect(serviceCenter).resolveClaim(1, true, ethers.ZeroHash);
      await expect(warranty.connect(serviceCenter).resolveClaim(1, true, ethers.ZeroHash))
        .to.be.revertedWithCustomError(warranty, "ClaimNotPending")
        .withArgs(1);
    });

    it("lets the product be claimed again after a rejection", async function () {
      const { warranty, customer, serviceCenter, productId } =
        await loadFixture(pendingClaimFixture);

      await warranty.connect(serviceCenter).resolveClaim(1, false, ethers.ZeroHash);
      await warranty.connect(customer).requestWarranty(productId, REASON);

      expect(await warranty.pendingClaimOf(productId)).to.equal(2);
      expect((await warranty.getClaim(2)).status).to.equal(PENDING);
    });

    it("still approves a claim opened before the warranty expired", async function () {
      const { registry, warranty, serviceCenter, productId } =
        await loadFixture(pendingClaimFixture);

      const product = await registry.getProduct(productId);
      await time.increaseTo(product.warrantyStart + product.warrantyDuration + 1n);
      expect(await registry.isWarrantyActive(productId)).to.equal(false);

      await warranty.connect(serviceCenter).resolveClaim(1, true, NOTE);
      expect((await warranty.getClaim(1)).status).to.equal(APPROVED);
      expect((await registry.getProduct(productId)).claimCount).to.equal(1);
    });

    it("closes the warranty once the claim limit is reached", async function () {
      const { registry, warranty, customer, serviceCenter, productId } =
        await loadFixture(singleClaimFixture);

      await warranty.connect(serviceCenter).resolveClaim(1, true, NOTE);
      expect((await registry.getProduct(productId)).claimCount).to.equal(1);
      expect(await registry.isWarrantyActive(productId)).to.equal(false);

      await expect(warranty.connect(customer).requestWarranty(productId, REASON))
        .to.be.revertedWithCustomError(warranty, "WarrantyInactive")
        .withArgs(productId);
    });
  });
});
