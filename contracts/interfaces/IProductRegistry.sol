// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Product} from "../types/Types.sol";
import {ISharedErrors} from "./ISharedErrors.sol";

/// @title IProductRegistry
/// @notice Frozen product and ownership surface. Implement it in `contracts/ProductRegistry.sol`.
/// @dev The implementation inherits this interface and OpenZeppelin `AccessControl`.
///      Do not add, remove, or reorder functions, parameters, events, or errors.
///      Normative rules live in `接口说明.md`.
interface IProductRegistry is ISharedErrors {
    error UnknownProduct(uint256 productId);
    error SerialAlreadyRegistered(bytes32 serialHash);
    error NotManufacturer(address caller);
    error NotProductOwner(address caller, address owner);
    error NotRetailer(address retailer);
    error InvalidRecipient(address to);
    error InvalidWarrantyTerms();
    error TransferLocked(uint256 productId);
    error TransferAlreadyLocked(uint256 productId);
    error TransferNotLocked(uint256 productId);
    error ClaimLimitReached(uint256 productId);
    error WarrantyManagerAlreadySet(address current);
    error NotWarrantyManager(address caller);
    error WarrantyManagerNotContract(address account);

    /// @notice Emitted when a manufacturer registers a product. Owner is the retailer.
    event Registered(
        uint256 indexed productId,
        bytes32 indexed serialHash,
        address indexed manufacturer,
        address retailer,
        uint256 modelId,
        uint64 warrantyDuration,
        uint32 maxClaims,
        uint64 manufacturedAt
    );

    /// @notice Emitted on every successful ownership change.
    /// @param warrantyStarted True only on the transfer that assigns `warrantyStart` from zero.
    /// @param warrantyStart Value after this transfer. Zero means the warranty has not started.
    event OwnershipTransferred(
        uint256 indexed productId,
        address indexed from,
        address indexed to,
        bool warrantyStarted,
        uint64 warrantyStart,
        uint64 timestamp
    );

    /// @notice Emitted once, when the admin links the warranty contract.
    event WarrantyManagerSet(address indexed warrantyManager);

    /// @notice Register a product and give it to `retailer`. Caller must have `MANUFACTURER_ROLE`.
    /// @dev `serialHash` is `keccak256(utf8(trim(serial)))` from `shared/hash.js`. It must be unique and non-zero.
    ///      `modelId` is `uint256(keccak256(utf8(trim(modelName))))`. The chain does not see the plaintext.
    ///      `retailer` must already have `RETAILER_ROLE`. `warrantyDuration` is seconds and must be at least 1.
    ///      `maxClaims` must be at least 1. Owner becomes `retailer`. `warrantyStart` stays 0.
    ///      `manufacturedAt` is `uint64(block.timestamp)`. Product ids start at 1.
    function registerProduct(
        bytes32 serialHash,
        uint256 modelId,
        uint64 warrantyDuration,
        uint32 maxClaims,
        address retailer
    ) external returns (uint256 productId);

    /// @notice Move ownership. Caller must be the current owner.
    /// @dev Revert when the product is missing, the caller is not the owner, or `transferLocked` is true.
    ///      Revert when `to` is zero, the current owner, this contract, or the warranty manager.
    ///      Start the warranty only when `warrantyStart` is still 0 and `to` has none of
    ///      `DEFAULT_ADMIN_ROLE`, `MANUFACTURER_ROLE`, `RETAILER_ROLE`, or `SERVICE_CENTER_ROLE`.
    ///      Set `warrantyStart` to `uint64(block.timestamp)` in that case. Never reset a non-zero start.
    function transferOwnership(uint256 productId, address to) external;

    /// @notice Link the warranty contract. Callable once, by `DEFAULT_ADMIN_ROLE` only.
    /// @dev `warrantyManager` must be a contract and must not be this registry.
    function setWarrantyManager(address warrantyManager) external;

    /// @notice Block `transferOwnership`. Callable only by the linked warranty manager.
    /// @dev Revert if the product is missing or already locked.
    function lockTransfer(uint256 productId) external;

    /// @notice Allow `transferOwnership` again. Callable only by the linked warranty manager.
    /// @dev Revert if the product is missing or not locked.
    function unlockTransfer(uint256 productId) external;

    /// @notice Increase `claimCount` by exactly 1. Callable only by the linked warranty manager.
    /// @dev Require the product to exist, `transferLocked` to be true, and `claimCount < maxClaims`.
    ///      Do not check the warranty clock here. A claim opened on time may be approved after expiry.
    function recordClaim(uint256 productId) external returns (uint32 newClaimCount);

    /// @notice Current owner. Revert with `UnknownProduct` when the id is missing.
    function ownerOf(uint256 productId) external view returns (address owner);

    /// @notice Full record. Revert with `UnknownProduct` when the id is missing.
    function getProduct(uint256 productId) external view returns (Product memory product);

    /// @notice Public authenticity check. Unknown serials return `(false, 0, address(0), false)` and do not revert.
    function verify(bytes32 serialHash)
        external
        view
        returns (bool authentic, uint256 productId, address owner, bool warrantyActive);

    /// @notice True when the warranty has started, the clock has not passed, and claims remain.
    /// @dev False for unknown ids and for products whose `warrantyStart` is still 0. Do not revert.
    ///      Active means `warrantyStart != 0`, `block.timestamp <= uint256(warrantyStart) + uint256(warrantyDuration)`,
    ///      and `claimCount < maxClaims`. Add the deadline in `uint256`, not `uint64`.
    ///      A transfer lock does not make the warranty inactive.
    function isWarrantyActive(uint256 productId) external view returns (bool active);

    /// @notice Id for a serial hash, or 0 when it is unknown. Do not revert.
    function productIdBySerial(bytes32 serialHash) external view returns (uint256 productId);

    /// @notice OpenZeppelin `AccessControl.hasRole`. `DEFAULT_ADMIN_ROLE` is `bytes32(0)`.
    function hasRole(bytes32 role, address account) external view returns (bool);

    /// @notice OpenZeppelin admin role. The value is `bytes32(0)`, held by the deployer.
    function DEFAULT_ADMIN_ROLE() external view returns (bytes32);

    /// @notice Must equal `Roles.MANUFACTURER_ROLE` and `roleHash("MANUFACTURER_ROLE")`.
    function MANUFACTURER_ROLE() external view returns (bytes32);

    /// @notice Must equal `Roles.RETAILER_ROLE` and `roleHash("RETAILER_ROLE")`.
    function RETAILER_ROLE() external view returns (bytes32);

    /// @notice Must equal `Roles.SERVICE_CENTER_ROLE` and `roleHash("SERVICE_CENTER_ROLE")`.
    function SERVICE_CENTER_ROLE() external view returns (bytes32);

    /// @notice Linked warranty contract, or `address(0)` before `setWarrantyManager`.
    function warrantyManager() external view returns (address manager);

    /// @notice Next product id to assign. Starts at 1. Count of products is this value minus 1.
    function nextProductId() external view returns (uint256 nextId);
}
