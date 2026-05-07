// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OntologyTermRegistry.sol";
import "./IAttributeAuth.sol";

/**
 * @title OntologyAttributeStore
 * @notice Generic typed-attribute store keyed by `bytes32 subject` and
 *         `bytes32 predicate`. Subjects are derived off-chain (agent address,
 *         name node, synthetic id for non-agent classes) and passed in.
 *
 * Eight value families:
 *   1 string, 2 address, 3 bool, 4 uint256,
 *   5 bytes32, 6 string[], 7 address[], 8 bytes32[]
 *
 * Auth: every setter calls AUTH.canWrite(subject, predicate, msg.sender).
 *       Predicate must be active in OntologyTermRegistry (or be the literal
 *       SUBJECT_VERSION marker — reserved internal use).
 *
 * Diff-aware indexing: every write bumps `_subjectVersion[subject]` and emits
 * an event carrying the new version. Off-chain syncs use the version as a
 * watermark to re-emit only changed subjects.
 */
contract OntologyAttributeStore {
    OntologyTermRegistry public immutable ONTOLOGY;
    IAttributeAuth public auth;
    address public governor;

    // ─── Datatype discriminators ────────────────────────────────────
    uint8 public constant DT_STRING       = 1;
    uint8 public constant DT_ADDRESS      = 2;
    uint8 public constant DT_BOOL         = 3;
    uint8 public constant DT_UINT256      = 4;
    uint8 public constant DT_BYTES32      = 5;
    uint8 public constant DT_STRING_ARR   = 6;
    uint8 public constant DT_ADDRESS_ARR  = 7;
    uint8 public constant DT_BYTES32_ARR  = 8;

    // ─── Typed value families (subject => predicate => value) ───────
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
    event AuthChanged(address indexed previousAuth, address indexed newAuth);
    event GovernorTransferred(address indexed previousGovernor, address indexed newGovernor);

    // ─── Errors ─────────────────────────────────────────────────────
    error NotGovernor();
    error NotAuthorized();
    error PredicateNotActive();
    error WrongDatatype(uint8 expected, uint8 actual);
    error AttributeNotSet();
    error AuthNotSet();

    modifier onlyGovernor() {
        if (msg.sender != governor) revert NotGovernor();
        _;
    }

    modifier authed(bytes32 subject, bytes32 predicate) {
        if (address(auth) == address(0)) revert AuthNotSet();
        if (!ONTOLOGY.isActive(predicate)) revert PredicateNotActive();
        if (!auth.canWrite(subject, predicate, msg.sender)) revert NotAuthorized();
        _;
    }

    constructor(address ontologyRegistry, address governor_) {
        ONTOLOGY = OntologyTermRegistry(ontologyRegistry);
        governor = governor_;
    }

    // ─── Governance ─────────────────────────────────────────────────

    function setAuth(address newAuth) external onlyGovernor {
        emit AuthChanged(address(auth), newAuth);
        auth = IAttributeAuth(newAuth);
    }

    function transferGovernor(address newGovernor) external onlyGovernor {
        emit GovernorTransferred(governor, newGovernor);
        governor = newGovernor;
    }

    // ─── Setters: scalars ───────────────────────────────────────────

    function setString(bytes32 subject, bytes32 predicate, string calldata value)
        external authed(subject, predicate)
    {
        _string[subject][predicate] = value;
        _record(subject, predicate, DT_STRING);
    }

    function setAddress(bytes32 subject, bytes32 predicate, address value)
        external authed(subject, predicate)
    {
        _address[subject][predicate] = value;
        _record(subject, predicate, DT_ADDRESS);
    }

    function setBool(bytes32 subject, bytes32 predicate, bool value)
        external authed(subject, predicate)
    {
        _bool[subject][predicate] = value;
        _record(subject, predicate, DT_BOOL);
    }

    function setUint(bytes32 subject, bytes32 predicate, uint256 value)
        external authed(subject, predicate)
    {
        _uint[subject][predicate] = value;
        _record(subject, predicate, DT_UINT256);
    }

    function setBytes32(bytes32 subject, bytes32 predicate, bytes32 value)
        external authed(subject, predicate)
    {
        _bytes32[subject][predicate] = value;
        _record(subject, predicate, DT_BYTES32);
    }

    // ─── Setters: arrays (full replace) ─────────────────────────────

    function setStringArr(bytes32 subject, bytes32 predicate, string[] calldata values)
        external authed(subject, predicate)
    {
        delete _stringArr[subject][predicate];
        for (uint256 i = 0; i < values.length; i++) {
            _stringArr[subject][predicate].push(values[i]);
        }
        _record(subject, predicate, DT_STRING_ARR);
    }

    function setAddressArr(bytes32 subject, bytes32 predicate, address[] calldata values)
        external authed(subject, predicate)
    {
        delete _addressArr[subject][predicate];
        for (uint256 i = 0; i < values.length; i++) {
            _addressArr[subject][predicate].push(values[i]);
        }
        _record(subject, predicate, DT_ADDRESS_ARR);
    }

    function setBytes32Arr(bytes32 subject, bytes32 predicate, bytes32[] calldata values)
        external authed(subject, predicate)
    {
        delete _bytes32Arr[subject][predicate];
        for (uint256 i = 0; i < values.length; i++) {
            _bytes32Arr[subject][predicate].push(values[i]);
        }
        _record(subject, predicate, DT_BYTES32_ARR);
    }

    // ─── Append (single value to existing array) ────────────────────

    function appendString(bytes32 subject, bytes32 predicate, string calldata value)
        external authed(subject, predicate)
    {
        _stringArr[subject][predicate].push(value);
        _recordAppend(subject, predicate, DT_STRING_ARR);
    }

    function appendAddress(bytes32 subject, bytes32 predicate, address value)
        external authed(subject, predicate)
    {
        _addressArr[subject][predicate].push(value);
        _recordAppend(subject, predicate, DT_ADDRESS_ARR);
    }

    function appendBytes32(bytes32 subject, bytes32 predicate, bytes32 value)
        external authed(subject, predicate)
    {
        _bytes32Arr[subject][predicate].push(value);
        _recordAppend(subject, predicate, DT_BYTES32_ARR);
    }

    // ─── Unset ──────────────────────────────────────────────────────

    function unset(bytes32 subject, bytes32 predicate) external authed(subject, predicate) {
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

        // Note: predicate stays in _predicates[subject] enumeration list to
        // preserve historical key ordering. Off-chain consumers should check
        // isSet() before reading.

        uint64 v = _bumpVersion(subject);
        emit AttributeUnset(subject, predicate, v);
    }

    // ─── Getters: scalars ───────────────────────────────────────────

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

    // ─── Getters: arrays ────────────────────────────────────────────

    function getStringArr(bytes32 subject, bytes32 predicate) external view returns (string[] memory) {
        return _stringArr[subject][predicate];
    }

    function getAddressArr(bytes32 subject, bytes32 predicate) external view returns (address[] memory) {
        return _addressArr[subject][predicate];
    }

    function getBytes32Arr(bytes32 subject, bytes32 predicate) external view returns (bytes32[] memory) {
        return _bytes32Arr[subject][predicate];
    }

    // ─── Enumeration / metadata ─────────────────────────────────────

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

    // ─── Internal ───────────────────────────────────────────────────

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
