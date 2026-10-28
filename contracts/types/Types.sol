// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Claim lifecycle stored by WarrantyManager. `None` is never stored.
enum ClaimStatus {
    None,
    Pending,
    Approved,
    Rejected
}

/// @notice On-chain product record. Plaintext serial numbers and model names stay off-chain.
struct Product {
    uint256 id;
    bytes32 serialHash;
    uint256 modelId;
    address manufacturer;
    address retailer;
    address owner;
    uint64 manufacturedAt;
    uint64 warrantyStart;
    uint64 warrantyDuration;
    uint32 maxClaims;
    uint32 claimCount;
    bool transferLocked;
}

/// @notice One warranty claim. `resolver`, `noteHash`, and `resolvedAt` stay zero until resolved.
struct Claim {
    uint256 id;
    uint256 productId;
    address requester;
    address resolver;
    bytes32 reasonHash;
    bytes32 noteHash;
    ClaimStatus status;
    uint64 requestedAt;
    uint64 resolvedAt;
}
