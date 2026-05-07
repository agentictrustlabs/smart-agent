// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OntologyTermRegistry.sol";

/**
 * @title AttributeStorage
 * @notice Abstract base for typed attribute storage. Each contract that
 *         inherits gets its OWN copy of the mappings — there is no shared
 *         backend. Subclasses are free to choose their auth model; the
 *         setters are `internal` so the subclass enforces preconditions.
 *
 * Eight typed value families, identified by uint8 datatype discriminators:
 *   1 string, 2 address, 3 bool, 4 uint256,
 *   5 bytes32, 6 string[], 7 address[], 8 bytes32[]
 *
 * Predicate enumeration: `predicatesOf(subject)` returns the list of
 * predicates ever set on a subject (insertion order, no duplicates).
 * `subjectVersion(subject)` is bumped on every write — off-chain syncs
 * use it as a watermark for diff-aware emission.
 *
 * Predicate validation: every internal setter checks the predicate is
 * active in `ONTOLOGY` (an OntologyTermRegistry the subclass passes in).
 * This catches typos and unregistered terms at write time.
 */
abstract contract AttributeStorage {
    OntologyTermRegistry public immutable ONTOLOGY;

    // ─── Datatype discriminators ────────────────────────────────────
    uint8 internal constant DT_STRING       = 1;
    uint8 internal constant DT_ADDRESS      = 2;
    uint8 internal constant DT_BOOL         = 3;
    uint8 internal constant DT_UINT256      = 4;
    uint8 internal constant DT_BYTES32      = 5;
    uint8 internal constant DT_STRING_ARR   = 6;
    uint8 internal constant DT_ADDRESS_ARR  = 7;
    uint8 internal constant DT_BYTES32_ARR  = 8;

    // ─── Typed value families ───────────────────────────────────────
    mapping(bytes32 => mapping(bytes32 => string))    private _string;
    mapping(bytes32 => mapping(bytes32 => address))   private _address;
    mapping(bytes32 => mapping(bytes32 => bool))      private _bool;
    mapping(bytes32 => mapping(bytes32 => uint256))   private _uint;
    mapping(bytes32 => mapping(bytes32 => bytes32))   private _bytes32;
    mapping(bytes32 => mapping(bytes32 => string[]))  private _stringArr;
    mapping(bytes32 => mapping(bytes32 => address[])) private _addressArr;
    mapping(bytes32 => mapping(bytes32 => bytes32[])) private _bytes32Arr;

    // ─── Indexing / metadata ────────────────────────────────────────
    mapping(bytes32 => bytes32[])                      private _predicates;
    mapping(bytes32 => mapping(bytes32 => bool))       private _isSet;
    mapping(bytes32 => mapping(bytes32 => uint8))      private _datatype;
    mapping(bytes32 => mapping(bytes32 => uint64))     private _updatedAt;
    mapping(bytes32 => uint64)                         private _subjectVersion;
    bytes32[]                                          private _allSubjects;
    mapping(bytes32 => bool)                           private _subjectKnown;

    // ─── Events ─────────────────────────────────────────────────────
    event AttributeSet(bytes32 indexed subject, bytes32 indexed predicate, uint8 datatype, uint64 version);
    event AttributeUnset(bytes32 indexed subject, bytes32 indexed predicate, uint64 version);
    event AttributeAppended(bytes32 indexed subject, bytes32 indexed predicate, uint8 datatype, uint64 version);
    event SubjectFirstSeen(bytes32 indexed subject);

    // ─── Errors ─────────────────────────────────────────────────────
    error PredicateNotActive();
    error AttributeNotSet();

    constructor(address ontologyRegistry) {
        ONTOLOGY = OntologyTermRegistry(ontologyRegistry);
    }

    // ─── Public datatype discriminator readers (for ShapeRegistry) ──

    function DT_STRING_PUB() external pure returns (uint8) { return DT_STRING; }
    function DT_ADDRESS_PUB() external pure returns (uint8) { return DT_ADDRESS; }
    function DT_BOOL_PUB() external pure returns (uint8) { return DT_BOOL; }
    function DT_UINT256_PUB() external pure returns (uint8) { return DT_UINT256; }
    function DT_BYTES32_PUB() external pure returns (uint8) { return DT_BYTES32; }
    function DT_STRING_ARR_PUB() external pure returns (uint8) { return DT_STRING_ARR; }
    function DT_ADDRESS_ARR_PUB() external pure returns (uint8) { return DT_ADDRESS_ARR; }
    function DT_BYTES32_ARR_PUB() external pure returns (uint8) { return DT_BYTES32_ARR; }

    // ─── Internal setters (subclass-only) ───────────────────────────

    function _setString(bytes32 subject, bytes32 predicate, string memory value) internal {
        _requirePredicate(predicate);
        _string[subject][predicate] = value;
        _record(subject, predicate, DT_STRING);
    }

    function _setAddress(bytes32 subject, bytes32 predicate, address value) internal {
        _requirePredicate(predicate);
        _address[subject][predicate] = value;
        _record(subject, predicate, DT_ADDRESS);
    }

    function _setBool(bytes32 subject, bytes32 predicate, bool value) internal {
        _requirePredicate(predicate);
        _bool[subject][predicate] = value;
        _record(subject, predicate, DT_BOOL);
    }

    function _setUint(bytes32 subject, bytes32 predicate, uint256 value) internal {
        _requirePredicate(predicate);
        _uint[subject][predicate] = value;
        _record(subject, predicate, DT_UINT256);
    }

    function _setBytes32(bytes32 subject, bytes32 predicate, bytes32 value) internal {
        _requirePredicate(predicate);
        _bytes32[subject][predicate] = value;
        _record(subject, predicate, DT_BYTES32);
    }

    function _setStringArr(bytes32 subject, bytes32 predicate, string[] memory values) internal {
        _requirePredicate(predicate);
        delete _stringArr[subject][predicate];
        for (uint256 i = 0; i < values.length; i++) {
            _stringArr[subject][predicate].push(values[i]);
        }
        _record(subject, predicate, DT_STRING_ARR);
    }

    function _setAddressArr(bytes32 subject, bytes32 predicate, address[] memory values) internal {
        _requirePredicate(predicate);
        delete _addressArr[subject][predicate];
        for (uint256 i = 0; i < values.length; i++) {
            _addressArr[subject][predicate].push(values[i]);
        }
        _record(subject, predicate, DT_ADDRESS_ARR);
    }

    function _setBytes32Arr(bytes32 subject, bytes32 predicate, bytes32[] memory values) internal {
        _requirePredicate(predicate);
        delete _bytes32Arr[subject][predicate];
        for (uint256 i = 0; i < values.length; i++) {
            _bytes32Arr[subject][predicate].push(values[i]);
        }
        _record(subject, predicate, DT_BYTES32_ARR);
    }

    function _appendString(bytes32 subject, bytes32 predicate, string memory value) internal {
        _requirePredicate(predicate);
        _stringArr[subject][predicate].push(value);
        _recordAppend(subject, predicate, DT_STRING_ARR);
    }

    function _appendAddress(bytes32 subject, bytes32 predicate, address value) internal {
        _requirePredicate(predicate);
        _addressArr[subject][predicate].push(value);
        _recordAppend(subject, predicate, DT_ADDRESS_ARR);
    }

    function _appendBytes32(bytes32 subject, bytes32 predicate, bytes32 value) internal {
        _requirePredicate(predicate);
        _bytes32Arr[subject][predicate].push(value);
        _recordAppend(subject, predicate, DT_BYTES32_ARR);
    }

    function _unset(bytes32 subject, bytes32 predicate) internal {
        if (!_isSet[subject][predicate]) revert AttributeNotSet();
        uint8 dt = _datatype[subject][predicate];
        if (dt == DT_STRING)            delete _string[subject][predicate];
        else if (dt == DT_ADDRESS)      delete _address[subject][predicate];
        else if (dt == DT_BOOL)         delete _bool[subject][predicate];
        else if (dt == DT_UINT256)      delete _uint[subject][predicate];
        else if (dt == DT_BYTES32)      delete _bytes32[subject][predicate];
        else if (dt == DT_STRING_ARR)   delete _stringArr[subject][predicate];
        else if (dt == DT_ADDRESS_ARR)  delete _addressArr[subject][predicate];
        else if (dt == DT_BYTES32_ARR)  delete _bytes32Arr[subject][predicate];
        _isSet[subject][predicate] = false;
        delete _datatype[subject][predicate];
        delete _updatedAt[subject][predicate];
        uint64 v = _bumpVersion(subject);
        emit AttributeUnset(subject, predicate, v);
    }

    // ─── Public getters ─────────────────────────────────────────────

    function getString(bytes32 subject, bytes32 predicate) external view returns (string memory) {
        return _string[subject][predicate];
    }
    function getAddress(bytes32 subject, bytes32 predicate) external view returns (address) {
        return _address[subject][predicate];
    }
    function getBool(bytes32 subject, bytes32 predicate) external view returns (bool) {
        return _bool[subject][predicate];
    }
    function getUint(bytes32 subject, bytes32 predicate) external view returns (uint256) {
        return _uint[subject][predicate];
    }
    function getBytes32(bytes32 subject, bytes32 predicate) external view returns (bytes32) {
        return _bytes32[subject][predicate];
    }
    function getStringArr(bytes32 subject, bytes32 predicate) external view returns (string[] memory) {
        return _stringArr[subject][predicate];
    }
    function getAddressArr(bytes32 subject, bytes32 predicate) external view returns (address[] memory) {
        return _addressArr[subject][predicate];
    }
    function getBytes32Arr(bytes32 subject, bytes32 predicate) external view returns (bytes32[] memory) {
        return _bytes32Arr[subject][predicate];
    }

    function predicatesOf(bytes32 subject) external view returns (bytes32[] memory) {
        return _predicates[subject];
    }
    function datatypeOf(bytes32 subject, bytes32 predicate) external view returns (uint8) {
        return _datatype[subject][predicate];
    }
    function updatedAt(bytes32 subject, bytes32 predicate) external view returns (uint64) {
        return _updatedAt[subject][predicate];
    }
    function isSet(bytes32 subject, bytes32 predicate) external view returns (bool) {
        return _isSet[subject][predicate];
    }
    function subjectVersion(bytes32 subject) external view returns (uint64) {
        return _subjectVersion[subject];
    }
    function allSubjects() external view returns (bytes32[] memory) {
        return _allSubjects;
    }
    function subjectCount() external view returns (uint256) {
        return _allSubjects.length;
    }

    // ─── Internal helpers ───────────────────────────────────────────

    function _requirePredicate(bytes32 predicate) internal view {
        if (!ONTOLOGY.isActive(predicate)) revert PredicateNotActive();
    }

    function _record(bytes32 subject, bytes32 predicate, uint8 dt) internal {
        _trackSubject(subject);
        if (!_isSet[subject][predicate]) {
            _predicates[subject].push(predicate);
            _isSet[subject][predicate] = true;
        }
        _datatype[subject][predicate] = dt;
        uint64 v = _bumpVersion(subject);
        _updatedAt[subject][predicate] = v;
        emit AttributeSet(subject, predicate, dt, v);
    }

    function _recordAppend(bytes32 subject, bytes32 predicate, uint8 dt) internal {
        _trackSubject(subject);
        if (!_isSet[subject][predicate]) {
            _predicates[subject].push(predicate);
            _isSet[subject][predicate] = true;
        }
        _datatype[subject][predicate] = dt;
        uint64 v = _bumpVersion(subject);
        _updatedAt[subject][predicate] = v;
        emit AttributeAppended(subject, predicate, dt, v);
    }

    function _trackSubject(bytes32 subject) internal {
        if (!_subjectKnown[subject]) {
            _subjectKnown[subject] = true;
            _allSubjects.push(subject);
            emit SubjectFirstSeen(subject);
        }
    }

    function _bumpVersion(bytes32 subject) internal returns (uint64) {
        uint64 next = _subjectVersion[subject] + 1;
        _subjectVersion[subject] = next;
        return next;
    }
}

/**
 * @title IAttributeReader
 * @notice Read-only interface every AttributeStorage subclass exposes.
 *         ShapeRegistry takes this so a single shape definition can
 *         validate any registry's subject.
 */
interface IAttributeReader {
    function isSet(bytes32 subject, bytes32 predicate) external view returns (bool);
    function datatypeOf(bytes32 subject, bytes32 predicate) external view returns (uint8);
    function getBytes32(bytes32 subject, bytes32 predicate) external view returns (bytes32);
    function getBytes32Arr(bytes32 subject, bytes32 predicate) external view returns (bytes32[] memory);
}
