// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IWarrantyManager} from "./interfaces/IWarrantyManager.sol";
import {IProductRegistry} from "./interfaces/IProductRegistry.sol";
import {Claim, ClaimStatus} from "./types/Types.sol";
import {Roles} from "./types/Roles.sol";

contract WarrantyManager is IWarrantyManager {
    address public immutable registry;
    uint256 public nextClaimId = 1;

    mapping(uint256 => Claim) private _claims;
    mapping(uint256 => uint256) private _pendingClaimOf;

    constructor(address productRegistry) {
        if (productRegistry == address(0)) revert ZeroAddress();
        registry = productRegistry;
    }

    modifier onlyLinked() {
        if (IProductRegistry(registry).warrantyManager() != address(this)) revert RegistryNotLinked();
        _;
    }

    function requestWarranty(uint256 productId, bytes32 reasonHash)
        external
        onlyLinked
        returns (uint256 claimId)
    {
        IProductRegistry productRegistry = IProductRegistry(registry);

        address owner = productRegistry.ownerOf(productId);
        if (msg.sender != owner) revert NotProductOwner(msg.sender, owner);

        if (reasonHash == bytes32(0)) revert EmptyHash();

        uint256 pending = _pendingClaimOf[productId];
        if (pending != 0) revert ClaimPending(productId, pending);

        if (!productRegistry.isWarrantyActive(productId)) revert WarrantyInactive(productId);

        claimId = nextClaimId++;
        uint64 requestedAt = uint64(block.timestamp);
        _claims[claimId] = Claim({
            id: claimId,
            productId: productId,
            requester: msg.sender,
            resolver: address(0),
            reasonHash: reasonHash,
            noteHash: bytes32(0),
            status: ClaimStatus.Pending,
            requestedAt: requestedAt,
            resolvedAt: 0
        });

        _pendingClaimOf[productId] = claimId;

        productRegistry.lockTransfer(productId);

        emit ClaimRequested(claimId, productId, msg.sender, reasonHash, requestedAt);
    }

    function resolveClaim(uint256 claimId, bool approved, bytes32 noteHash) external onlyLinked {
        IProductRegistry productRegistry = IProductRegistry(registry);

        Claim storage claim = _claims[claimId];
        if (claim.id == 0) revert UnknownClaim(claimId);
        if (claim.status != ClaimStatus.Pending) revert ClaimNotPending(claimId);

        if (!productRegistry.hasRole(Roles.SERVICE_CENTER_ROLE, msg.sender)) {
            revert NotServiceCenter(msg.sender);
        }
        if (msg.sender == claim.requester) revert SelfResolution(msg.sender);

        uint256 productId = claim.productId;

        uint64 resolvedAt = uint64(block.timestamp);
        claim.status = approved ? ClaimStatus.Approved : ClaimStatus.Rejected;
        claim.resolver = msg.sender;
        claim.noteHash = noteHash;
        claim.resolvedAt = resolvedAt;
        _pendingClaimOf[productId] = 0;

        uint32 claimCount;
        if (approved) {
            claimCount = productRegistry.recordClaim(productId);
            productRegistry.unlockTransfer(productId);
        } else {
            productRegistry.unlockTransfer(productId);
            claimCount = productRegistry.getProduct(productId).claimCount;
        }

        emit ClaimResolved(
            claimId,
            productId,
            msg.sender,
            approved,
            noteHash,
            claimCount,
            resolvedAt
        );
    }

    function getClaim(uint256 claimId) external view returns (Claim memory claim) {
        claim = _claims[claimId];
        if (claim.id == 0) revert UnknownClaim(claimId);
    }

    function pendingClaimOf(uint256 productId) external view returns (uint256 claimId) {
        return _pendingClaimOf[productId];
    }
}
