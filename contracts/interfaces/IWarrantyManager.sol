// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Claim} from "../types/Types.sol";
import {ISharedErrors} from "./ISharedErrors.sol";

/// @title IWarrantyManager
/// @notice Frozen warranty surface. Implement it in `contracts/WarrantyManager.sol`.
/// @dev Constructor is `constructor(address productRegistry)` and is not part of this interface.
///      The implementation does not inherit `AccessControl`. Read roles from the registry.
///      Do not add, remove, or reorder functions, parameters, events, or errors.
///      Normative rules live in `接口说明.md`.
interface IWarrantyManager is ISharedErrors {
    error RegistryNotLinked();
    error NotProductOwner(address caller, address owner);
    error NotServiceCenter(address caller);
    error WarrantyInactive(uint256 productId);
    error ClaimPending(uint256 productId, uint256 claimId);
    error UnknownClaim(uint256 claimId);
    error ClaimNotPending(uint256 claimId);
    error SelfResolution(address caller);

    event ClaimRequested(
        uint256 indexed claimId,
        uint256 indexed productId,
        address indexed requester,
        bytes32 reasonHash,
        uint64 requestedAt
    );

    /// @param claimCount Count after this resolution. Unchanged when `approved` is false.
    event ClaimResolved(
        uint256 indexed claimId,
        uint256 indexed productId,
        address indexed resolver,
        bool approved,
        bytes32 noteHash,
        uint32 claimCount,
        uint64 resolvedAt
    );

    /// @notice Open one claim and lock transfer. Caller must be the current product owner.
    /// @dev Revert with `RegistryNotLinked` unless `registry.warrantyManager() == address(this)`.
    ///      Revert when `reasonHash` is zero, the caller is not the owner, a claim is already pending,
    ///      or `registry.isWarrantyActive(productId)` is false.
    ///      Claim ids start at 1. Store status `Pending`, then call `registry.lockTransfer(productId)`.
    function requestWarranty(uint256 productId, bytes32 reasonHash) external returns (uint256 claimId);

    /// @notice Approve or reject a pending claim, then unlock transfer. Caller must be a service center.
    /// @dev Revert with `RegistryNotLinked` unless this contract is the registry's warranty manager.
    ///      Caller must have `SERVICE_CENTER_ROLE` on the registry and must not be `claim.requester`.
    ///      Revert when the claim is missing or not `Pending`.
    ///      On approval call `registry.recordClaim` before `registry.unlockTransfer`.
    ///      On rejection call only `registry.unlockTransfer`. `noteHash` may be zero.
    ///      Clear the product's pending claim id in the same transaction.
    function resolveClaim(uint256 claimId, bool approved, bytes32 noteHash) external;

    /// @notice One claim. Revert with `UnknownClaim` when the id is missing.
    function getClaim(uint256 claimId) external view returns (Claim memory claim);

    /// @notice Pending claim id for a product, or 0 when none is pending. Do not revert for unknown products.
    function pendingClaimOf(uint256 productId) external view returns (uint256 claimId);

    /// @notice Product registry passed to the constructor.
    function registry() external view returns (address registryAddress);

    /// @notice Next claim id to assign. Starts at 1.
    function nextClaimId() external view returns (uint256 nextId);
}
