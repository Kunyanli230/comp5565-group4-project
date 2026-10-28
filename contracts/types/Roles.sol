// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Role ids shared by the registry and the warranty contract.
/// @dev These must stay equal to `roleHash()` in `shared/hash.js`.
library Roles {
    bytes32 internal constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");
    bytes32 internal constant RETAILER_ROLE = keccak256("RETAILER_ROLE");
    bytes32 internal constant SERVICE_CENTER_ROLE = keccak256("SERVICE_CENTER_ROLE");
}
