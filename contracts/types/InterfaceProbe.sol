// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Roles} from "./Roles.sol";

/// @title InterfaceProbe
/// @notice Frozen self-check used by `test/interface-vectors.ts`.
///         Business contracts and the frontend must not call this contract.
contract InterfaceProbe {
    function hashUtf8(string memory value) external pure returns (bytes32) {
        return keccak256(bytes(value));
    }

    function manufacturerRole() external pure returns (bytes32) {
        return Roles.MANUFACTURER_ROLE;
    }

    function retailerRole() external pure returns (bytes32) {
        return Roles.RETAILER_ROLE;
    }

    function serviceCenterRole() external pure returns (bytes32) {
        return Roles.SERVICE_CENTER_ROLE;
    }
}
