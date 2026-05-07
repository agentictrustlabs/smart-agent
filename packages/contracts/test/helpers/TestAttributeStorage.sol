// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../../src/AttributeStorage.sol";

/// @notice Concrete subclass of AttributeStorage exposing internal setters
///         publicly. ONLY for unit testing the abstract base + ShapeRegistry.
contract TestAttributeStorage is AttributeStorage {
    constructor(address ontologyRegistry) AttributeStorage(ontologyRegistry) {}

    function pubSetString(bytes32 subject, bytes32 predicate, string memory value) external {
        _setString(subject, predicate, value);
    }
    function pubSetAddress(bytes32 subject, bytes32 predicate, address value) external {
        _setAddress(subject, predicate, value);
    }
    function pubSetBool(bytes32 subject, bytes32 predicate, bool value) external {
        _setBool(subject, predicate, value);
    }
    function pubSetUint(bytes32 subject, bytes32 predicate, uint256 value) external {
        _setUint(subject, predicate, value);
    }
    function pubSetBytes32(bytes32 subject, bytes32 predicate, bytes32 value) external {
        _setBytes32(subject, predicate, value);
    }
    function pubSetStringArr(bytes32 subject, bytes32 predicate, string[] memory values) external {
        _setStringArr(subject, predicate, values);
    }
    function pubSetAddressArr(bytes32 subject, bytes32 predicate, address[] memory values) external {
        _setAddressArr(subject, predicate, values);
    }
    function pubSetBytes32Arr(bytes32 subject, bytes32 predicate, bytes32[] memory values) external {
        _setBytes32Arr(subject, predicate, values);
    }
    function pubAppendString(bytes32 subject, bytes32 predicate, string memory value) external {
        _appendString(subject, predicate, value);
    }
    function pubAppendAddress(bytes32 subject, bytes32 predicate, address value) external {
        _appendAddress(subject, predicate, value);
    }
    function pubAppendBytes32(bytes32 subject, bytes32 predicate, bytes32 value) external {
        _appendBytes32(subject, predicate, value);
    }
    function pubUnset(bytes32 subject, bytes32 predicate) external {
        _unset(subject, predicate);
    }
}
