// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/ShapeRegistry.sol";
import "../src/OntologyTermRegistry.sol";
import "./helpers/TestAttributeStorage.sol";

contract ShapeRegistryTest is Test {
    OntologyTermRegistry ontology;
    TestAttributeStorage store;
    ShapeRegistry shapes;

    bytes32 subjectAlice = bytes32(uint256(0xAA));

    bytes32 constant PRED_DISPLAY_NAME    = keccak256("atl:displayName");
    bytes32 constant PRED_AGENT_TYPE      = keccak256("atl:agentType");
    bytes32 constant PRED_COMPANY_TYPE    = keccak256("sa:companyType");
    bytes32 constant PRED_DESCRIPTION     = keccak256("atl:description");
    bytes32 constant PRED_ACCEPTED_KINDS  = keccak256("sa:poolAcceptedKinds");

    bytes32 constant CLASS_ORG_AGENT      = keccak256("sa:OrganizationAgent");

    bytes32 constant ENUM_COMPANY_TYPE    = keccak256("companyType");
    bytes32 constant ENUM_POOL_KINDS      = keccak256("poolKinds");

    bytes32 constant CT_NONPROFIT      = keccak256("sa:Nonprofit");
    bytes32 constant CT_FAITH_NETWORK  = keccak256("sa:FaithNetwork");
    bytes32 constant CT_CHURCH         = keccak256("sa:Church");
    bytes32 constant CT_FOUNDATION     = keccak256("sa:Foundation");
    bytes32 constant CT_DAO            = keccak256("sa:DAO");
    bytes32 constant CT_LLC            = keccak256("sa:LLC");

    bytes32 constant TYPE_ORG = keccak256("atl:OrganizationAgent");

    address alice = makeAddr("alice");

    function setUp() public {
        ontology = new OntologyTermRegistry(address(this));
        store = new TestAttributeStorage(address(ontology));
        shapes = new ShapeRegistry(address(this));

        ontology.registerTerm(PRED_DISPLAY_NAME, "atl:displayName", "uri", "Display Name", "string");
        ontology.registerTerm(PRED_AGENT_TYPE, "atl:agentType", "uri", "Agent Type", "bytes32");
        ontology.registerTerm(PRED_COMPANY_TYPE, "sa:companyType", "uri", "Company Type", "bytes32");
        ontology.registerTerm(PRED_DESCRIPTION, "atl:description", "uri", "Description", "string");
        ontology.registerTerm(PRED_ACCEPTED_KINDS, "sa:poolAcceptedKinds", "uri", "Pool Accepted Kinds", "bytes32[]");

        bytes32[] memory companyTypes = new bytes32[](6);
        companyTypes[0] = CT_NONPROFIT;
        companyTypes[1] = CT_FAITH_NETWORK;
        companyTypes[2] = CT_CHURCH;
        companyTypes[3] = CT_FOUNDATION;
        companyTypes[4] = CT_DAO;
        companyTypes[5] = CT_LLC;
        shapes.defineEnumSet(ENUM_COMPANY_TYPE, companyTypes);

        bytes32[] memory poolKinds = new bytes32[](2);
        poolKinds[0] = keccak256("sa:GivingFund");
        poolKinds[1] = keccak256("sa:CoachingNetwork");
        shapes.defineEnumSet(ENUM_POOL_KINDS, poolKinds);
    }

    function _orgShapeProps() internal view returns (ShapeRegistry.PropertyConstraint[] memory) {
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](4);
        props[0] = _prop(PRED_DISPLAY_NAME, 1, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[1] = _prop(PRED_AGENT_TYPE, 5, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[2] = _prop(PRED_COMPANY_TYPE, 5, ShapeRegistry.Cardinality.OPTIONAL, ENUM_COMPANY_TYPE);
        props[3] = _prop(PRED_DESCRIPTION, 1, ShapeRegistry.Cardinality.OPTIONAL, bytes32(0));
        return props;
    }

    function _prop(bytes32 predicate, uint8 dt, ShapeRegistry.Cardinality card, bytes32 enumId)
        internal pure returns (ShapeRegistry.PropertyConstraint memory)
    {
        return ShapeRegistry.PropertyConstraint({
            predicate: predicate,
            expectedDatatype: dt,
            cardinality: card,
            enumSetId: enumId,
            expectedClass: bytes32(0)
        });
    }

    function _defineOrgShape() internal {
        shapes.defineShape(CLASS_ORG_AGENT, _orgShapeProps(), "https://example/OrgShape", keccak256("v1"));
    }

    function test_define_shape() public {
        _defineOrgShape();
        ShapeRegistry.Shape memory s = shapes.getShape(CLASS_ORG_AGENT);
        assertEq(s.classId, CLASS_ORG_AGENT);
        assertEq(s.version, 1);
        assertTrue(s.active);
    }

    function test_define_shape_reverts_if_already_defined() public {
        _defineOrgShape();
        ShapeRegistry.PropertyConstraint[] memory props = _orgShapeProps();
        vm.expectRevert(ShapeRegistry.ShapeAlreadyDefined.selector);
        shapes.defineShape(CLASS_ORG_AGENT, props, "https://example/OrgShape", keccak256("v1"));
    }

    function test_update_shape_bumps_version() public {
        _defineOrgShape();
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](1);
        props[0] = _prop(PRED_DISPLAY_NAME, 1, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        shapes.updateShape(CLASS_ORG_AGENT, props, "v2", keccak256("v2"));
        assertEq(shapes.getShape(CLASS_ORG_AGENT).version, 2);
    }

    function test_only_governor_can_define() public {
        ShapeRegistry.PropertyConstraint[] memory props = _orgShapeProps();
        vm.prank(alice);
        vm.expectRevert(ShapeRegistry.NotGovernor.selector);
        shapes.defineShape(CLASS_ORG_AGENT, props, "x", bytes32(0));
    }

    function test_enum_set_membership() public view {
        assertTrue(shapes.isInEnumSet(ENUM_COMPANY_TYPE, CT_FAITH_NETWORK));
        assertFalse(shapes.isInEnumSet(ENUM_COMPANY_TYPE, keccak256("sa:Random")));
    }

    function test_enum_set_empty_reverts() public {
        bytes32[] memory empty = new bytes32[](0);
        vm.expectRevert(ShapeRegistry.EnumSetEmpty.selector);
        shapes.defineEnumSet(keccak256("empty"), empty);
    }

    // ─── Validation against an arbitrary store ─────────────────────

    function test_validate_passes_with_required_set() public {
        _defineOrgShape();
        store.pubSetString(subjectAlice, PRED_DISPLAY_NAME, "Front Range");
        store.pubSetBytes32(subjectAlice, PRED_AGENT_TYPE, TYPE_ORG);
        shapes.validateSubject(CLASS_ORG_AGENT, subjectAlice, address(store));
        assertTrue(shapes.isValid(CLASS_ORG_AGENT, subjectAlice, address(store)));
    }

    function test_validate_reverts_when_required_missing() public {
        _defineOrgShape();
        store.pubSetString(subjectAlice, PRED_DISPLAY_NAME, "x");
        vm.expectRevert(abi.encodeWithSelector(
            ShapeRegistry.MissingRequiredProperty.selector, PRED_AGENT_TYPE
        ));
        shapes.validateSubject(CLASS_ORG_AGENT, subjectAlice, address(store));
    }

    function test_validate_reverts_on_wrong_datatype() public {
        _defineOrgShape();
        store.pubSetString(subjectAlice, PRED_DISPLAY_NAME, "Front Range");
        store.pubSetString(subjectAlice, PRED_AGENT_TYPE, "wrong-string");
        vm.expectRevert(abi.encodeWithSelector(
            ShapeRegistry.WrongDatatype.selector, PRED_AGENT_TYPE, uint8(1), uint8(5)
        ));
        shapes.validateSubject(CLASS_ORG_AGENT, subjectAlice, address(store));
    }

    function test_validate_reverts_on_invalid_enum_value() public {
        _defineOrgShape();
        bytes32 fake = keccak256("sa:NotARealCompanyType");
        store.pubSetString(subjectAlice, PRED_DISPLAY_NAME, "Front Range");
        store.pubSetBytes32(subjectAlice, PRED_AGENT_TYPE, TYPE_ORG);
        store.pubSetBytes32(subjectAlice, PRED_COMPANY_TYPE, fake);
        vm.expectRevert(abi.encodeWithSelector(
            ShapeRegistry.EnumValueNotAllowed.selector, PRED_COMPANY_TYPE, fake
        ));
        shapes.validateSubject(CLASS_ORG_AGENT, subjectAlice, address(store));
    }

    function test_validate_reverts_if_shape_not_defined() public {
        bytes32 unknownClass = keccak256("sa:NotDefined");
        vm.expectRevert(ShapeRegistry.ShapeNotDefined.selector);
        shapes.validateSubject(unknownClass, subjectAlice, address(store));
    }

    function test_isValid_returns_false_on_failure() public {
        _defineOrgShape();
        assertFalse(shapes.isValid(CLASS_ORG_AGENT, subjectAlice, address(store)));
    }
}
