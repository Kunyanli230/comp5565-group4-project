// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Roles} from "./types/Roles.sol";
import {Product} from "./types/Types.sol";

/// @title ProductRegistry
/// @notice Stores product provenance, ownership and warranty counters.
// IProductRegistry cannot be inherited together with OpenZeppelin AccessControl:
// both expose DEFAULT_ADMIN_ROLE(), and AccessControl implements it with a public
// constant that Solidity does not allow a derived contract to override. This
// contract therefore implements the frozen interface ABI without inheriting it.
contract ProductRegistry is AccessControl {
    error EmptyHash();
    error ZeroAddress();
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
    event OwnershipTransferred(
        uint256 indexed productId,
        address indexed from,
        address indexed to,
        bool warrantyStarted,
        uint64 warrantyStart,
        uint64 timestamp
    );
    event WarrantyManagerSet(address indexed warrantyManager);

    bytes32 public constant MANUFACTURER_ROLE = Roles.MANUFACTURER_ROLE;
    bytes32 public constant RETAILER_ROLE = Roles.RETAILER_ROLE;
    bytes32 public constant SERVICE_CENTER_ROLE = Roles.SERVICE_CENTER_ROLE;

    address public warrantyManager;
    uint256 public nextProductId = 1;

    mapping(uint256 => Product) private _products;
    mapping(bytes32 => uint256) private _productIdsBySerial;

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    modifier onlyWarrantyManager() {
        if (msg.sender != warrantyManager) revert NotWarrantyManager(msg.sender);
        _;
    }

    function registerProduct(
        bytes32 serialHash,
        uint256 modelId,
        uint64 warrantyDuration,
        uint32 maxClaims,
        address retailer
    ) external returns (uint256 productId) {
        if (!hasRole(MANUFACTURER_ROLE, msg.sender)) revert NotManufacturer(msg.sender);
        if (serialHash == bytes32(0)) revert EmptyHash();
        if (_productIdsBySerial[serialHash] != 0) revert SerialAlreadyRegistered(serialHash);
        if (!hasRole(RETAILER_ROLE, retailer)) revert NotRetailer(retailer);
        if (warrantyDuration == 0 || maxClaims == 0) revert InvalidWarrantyTerms();

        productId = nextProductId++;
        uint64 manufacturedAt = uint64(block.timestamp);
        _products[productId] = Product({
            id: productId,
            serialHash: serialHash,
            modelId: modelId,
            manufacturer: msg.sender,
            retailer: retailer,
            owner: retailer,
            manufacturedAt: manufacturedAt,
            warrantyStart: 0,
            warrantyDuration: warrantyDuration,
            maxClaims: maxClaims,
            claimCount: 0,
            transferLocked: false
        });
        _productIdsBySerial[serialHash] = productId;

        emit Registered(
            productId,
            serialHash,
            msg.sender,
            retailer,
            modelId,
            warrantyDuration,
            maxClaims,
            manufacturedAt
        );
    }

    function transferOwnership(uint256 productId, address to) external {
        Product storage product = _requireProduct(productId);
        address from = product.owner;
        if (msg.sender != from) revert NotProductOwner(msg.sender, from);
        if (product.transferLocked) revert TransferLocked(productId);
        if (
            to == address(0) || to == from || to == address(this)
                || (warrantyManager != address(0) && to == warrantyManager)
        ) revert InvalidRecipient(to);

        bool warrantyStarted;
        if (product.warrantyStart == 0 && !_hasStakeholderRole(to)) {
            product.warrantyStart = uint64(block.timestamp);
            warrantyStarted = true;
        }
        product.owner = to;

        emit OwnershipTransferred(
            productId,
            from,
            to,
            warrantyStarted,
            product.warrantyStart,
            uint64(block.timestamp)
        );
    }

    function setWarrantyManager(address manager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (warrantyManager != address(0)) revert WarrantyManagerAlreadySet(warrantyManager);
        if (manager == address(this) || manager.code.length == 0) revert WarrantyManagerNotContract(manager);
        warrantyManager = manager;
        emit WarrantyManagerSet(manager);
    }

    function lockTransfer(uint256 productId) external onlyWarrantyManager {
        Product storage product = _requireProduct(productId);
        if (product.transferLocked) revert TransferAlreadyLocked(productId);
        product.transferLocked = true;
    }

    function unlockTransfer(uint256 productId) external onlyWarrantyManager {
        Product storage product = _requireProduct(productId);
        if (!product.transferLocked) revert TransferNotLocked(productId);
        product.transferLocked = false;
    }

    function recordClaim(uint256 productId)
        external
        onlyWarrantyManager
        returns (uint32 newClaimCount)
    {
        Product storage product = _requireProduct(productId);
        if (!product.transferLocked) revert TransferNotLocked(productId);
        if (product.claimCount >= product.maxClaims) revert ClaimLimitReached(productId);
        unchecked { product.claimCount += 1; }
        return product.claimCount;
    }

    function ownerOf(uint256 productId) external view returns (address owner) {
        return _requireProductView(productId).owner;
    }

    function getProduct(uint256 productId) external view returns (Product memory product) {
        return _requireProductView(productId);
    }

    function verify(bytes32 serialHash)
        external
        view
        returns (bool authentic, uint256 productId, address owner, bool warrantyActive)
    {
        productId = _productIdsBySerial[serialHash];
        if (productId == 0) return (false, 0, address(0), false);
        Product storage product = _products[productId];
        return (true, productId, product.owner, _isWarrantyActive(product));
    }

    function isWarrantyActive(uint256 productId) external view returns (bool active) {
        Product storage product = _products[productId];
        if (product.id == 0) return false;
        return _isWarrantyActive(product);
    }

    function productIdBySerial(bytes32 serialHash) external view returns (uint256 productId) {
        return _productIdsBySerial[serialHash];
    }

    function _requireProduct(uint256 productId) private view returns (Product storage product) {
        product = _products[productId];
        if (product.id == 0) revert UnknownProduct(productId);
    }

    function _requireProductView(uint256 productId) private view returns (Product storage product) {
        product = _products[productId];
        if (product.id == 0) revert UnknownProduct(productId);
    }

    function _hasStakeholderRole(address account) private view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, account) || hasRole(MANUFACTURER_ROLE, account)
            || hasRole(RETAILER_ROLE, account) || hasRole(SERVICE_CENTER_ROLE, account);
    }

    function _isWarrantyActive(Product storage product) private view returns (bool) {
        if (product.warrantyStart == 0 || product.claimCount >= product.maxClaims) return false;
        uint256 deadline = uint256(product.warrantyStart) + uint256(product.warrantyDuration);
        return block.timestamp <= deadline;
    }
}
