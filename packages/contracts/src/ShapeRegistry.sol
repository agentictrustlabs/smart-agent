// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AttributeStorage.sol";

/**
 * @title ShapeRegistry
 * @notice SHACL-inspired class shape constraints. Decoupled from any
 *         specific store — every validation call takes the reader address,
 *         so one registry holds shapes that can be validated against any
 *         AttributeStorage subclass.
 *
 * Supported subset:
 *   sh:path        → predicate id
 *   sh:datatype    → AttributeStorage datatype family discriminator (DT_*)
 *   sh:minCount /  → cardinality enum
 *   sh:maxCount
 *   sh:in          → enumSetId referencing _enumValues[id]
 *   sh:class       → expectedClass id (off-chain class IRI hash); informational
 */
contract ShapeRegistry {
    address public governor;

    enum Cardinality {
        OPTIONAL,        // 0..1
        REQUIRED_ONE,    // 1..1
        REQUIRED_MANY,   // 1..*
        OPTIONAL_MANY    // 0..*
    }

    struct PropertyConstraint {
        bytes32 predicate;
        uint8 expectedDatatype;
        Cardinality cardinality;
        bytes32 enumSetId;
        bytes32 expectedClass;
    }

    struct Shape {
        bytes32 classId;
        string shapeURI;
        bytes32 shapeHash;
        uint16 version;
        bool active;
        bool exists;
    }

    mapping(bytes32 => Shape)              private _shapes;
    mapping(bytes32 => PropertyConstraint[]) private _props;
    mapping(bytes32 => bytes32[])          private _enumValues;
    mapping(bytes32 => mapping(bytes32 => bool)) private _enumContains;
    bytes32[] private _classIds;

    event ShapeDefined(bytes32 indexed classId, uint16 version, string shapeURI, bytes32 shapeHash);
    event ShapeUpdated(bytes32 indexed classId, uint16 version, bytes32 shapeHash);
    event ShapeDeactivated(bytes32 indexed classId);
    event ShapeActivated(bytes32 indexed classId);
    event EnumSetDefined(bytes32 indexed enumSetId, uint256 valueCount);
    event GovernorTransferred(address indexed previousGovernor, address indexed newGovernor);

    error NotGovernor();
    error ShapeAlreadyDefined();
    error ShapeNotDefined();
    error ShapeNotActive();
    error MissingRequiredProperty(bytes32 predicate);
    error WrongDatatype(bytes32 predicate, uint8 actual, uint8 expected);
    error EnumValueNotAllowed(bytes32 predicate, bytes32 actualValue);
    error EnumSetEmpty();

    modifier onlyGovernor() {
        if (msg.sender != governor) revert NotGovernor();
        _;
    }

    constructor(address governor_) {
        governor = governor_;
    }

    function transferGovernor(address newGovernor) external onlyGovernor {
        emit GovernorTransferred(governor, newGovernor);
        governor = newGovernor;
    }

    // ─── Shape definition ───────────────────────────────────────────

    function defineShape(
        bytes32 classId,
        PropertyConstraint[] calldata props,
        string calldata shapeURI,
        bytes32 shapeHash
    ) external onlyGovernor returns (uint16) {
        if (_shapes[classId].exists) revert ShapeAlreadyDefined();
        _shapes[classId] = Shape({
            classId: classId,
            shapeURI: shapeURI,
            shapeHash: shapeHash,
            version: 1,
            active: true,
            exists: true
        });
        _classIds.push(classId);
        for (uint256 i = 0; i < props.length; i++) {
            _props[classId].push(props[i]);
        }
        emit ShapeDefined(classId, 1, shapeURI, shapeHash);
        return 1;
    }

    function updateShape(
        bytes32 classId,
        PropertyConstraint[] calldata props,
        string calldata shapeURI,
        bytes32 shapeHash
    ) external onlyGovernor returns (uint16) {
        Shape storage s = _shapes[classId];
        if (!s.exists) revert ShapeNotDefined();
        s.version += 1;
        s.shapeURI = shapeURI;
        s.shapeHash = shapeHash;
        delete _props[classId];
        for (uint256 i = 0; i < props.length; i++) {
            _props[classId].push(props[i]);
        }
        emit ShapeUpdated(classId, s.version, shapeHash);
        return s.version;
    }

    function deactivateShape(bytes32 classId) external onlyGovernor {
        Shape storage s = _shapes[classId];
        if (!s.exists) revert ShapeNotDefined();
        s.active = false;
        emit ShapeDeactivated(classId);
    }

    function activateShape(bytes32 classId) external onlyGovernor {
        Shape storage s = _shapes[classId];
        if (!s.exists) revert ShapeNotDefined();
        s.active = true;
        emit ShapeActivated(classId);
    }

    function defineEnumSet(bytes32 enumSetId, bytes32[] calldata allowedValues) external onlyGovernor {
        if (allowedValues.length == 0) revert EnumSetEmpty();
        bytes32[] storage existing = _enumValues[enumSetId];
        for (uint256 i = 0; i < existing.length; i++) {
            _enumContains[enumSetId][existing[i]] = false;
        }
        delete _enumValues[enumSetId];
        for (uint256 i = 0; i < allowedValues.length; i++) {
            _enumValues[enumSetId].push(allowedValues[i]);
            _enumContains[enumSetId][allowedValues[i]] = true;
        }
        emit EnumSetDefined(enumSetId, allowedValues.length);
    }

    // ─── Validation ─────────────────────────────────────────────────

    /// @notice Validate `subject` in `store` against the shape `classId`.
    function validateSubject(bytes32 classId, bytes32 subject, address store) external view {
        _validate(classId, subject, IAttributeReader(store));
    }

    function isValid(bytes32 classId, bytes32 subject, address store) external view returns (bool) {
        try this.validateSubject(classId, subject, store) {
            return true;
        } catch {
            return false;
        }
    }

    function _validate(bytes32 classId, bytes32 subject, IAttributeReader store) internal view {
        Shape storage s = _shapes[classId];
        if (!s.exists) revert ShapeNotDefined();
        if (!s.active) revert ShapeNotActive();

        PropertyConstraint[] storage props = _props[classId];
        for (uint256 i = 0; i < props.length; i++) {
            PropertyConstraint storage p = props[i];
            bool present = store.isSet(subject, p.predicate);
            bool required = p.cardinality == Cardinality.REQUIRED_ONE
                || p.cardinality == Cardinality.REQUIRED_MANY;

            if (!present) {
                if (required) revert MissingRequiredProperty(p.predicate);
                continue;
            }

            uint8 actualDt = store.datatypeOf(subject, p.predicate);
            if (actualDt != p.expectedDatatype) {
                revert WrongDatatype(p.predicate, actualDt, p.expectedDatatype);
            }

            if (p.enumSetId != bytes32(0)) {
                if (p.expectedDatatype == 5) { // DT_BYTES32
                    bytes32 v = store.getBytes32(subject, p.predicate);
                    if (!_enumContains[p.enumSetId][v]) {
                        revert EnumValueNotAllowed(p.predicate, v);
                    }
                } else if (p.expectedDatatype == 8) { // DT_BYTES32_ARR
                    bytes32[] memory arr = store.getBytes32Arr(subject, p.predicate);
                    for (uint256 j = 0; j < arr.length; j++) {
                        if (!_enumContains[p.enumSetId][arr[j]]) {
                            revert EnumValueNotAllowed(p.predicate, arr[j]);
                        }
                    }
                }
            }
        }
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getShape(bytes32 classId) external view returns (Shape memory) {
        return _shapes[classId];
    }
    function getProperties(bytes32 classId) external view returns (PropertyConstraint[] memory) {
        return _props[classId];
    }
    function getEnumValues(bytes32 enumSetId) external view returns (bytes32[] memory) {
        return _enumValues[enumSetId];
    }
    function isInEnumSet(bytes32 enumSetId, bytes32 value) external view returns (bool) {
        return _enumContains[enumSetId][value];
    }
    function shapeCount() external view returns (uint256) {
        return _classIds.length;
    }
    function getClassIdAt(uint256 index) external view returns (bytes32) {
        return _classIds[index];
    }
}
