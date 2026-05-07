// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/OntologyAttributeStore.sol";
import "../src/AttributeAuth.sol";
import "../src/ShapeRegistry.sol";
import "../src/OntologyTermRegistry.sol";
import "../src/AgentAccountFactory.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract ShapeRegistryTest is Test {
    EntryPoint entryPoint;
    AgentAccountFactory factory;
    OntologyTermRegistry ontology;
    OntologyAttributeStore store;
    AttributeAuth attrAuth;
    ShapeRegistry shapes;

    address alice;
    address agentAlice;
    bytes32 subjectAlice;

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

    bytes32 constant TYPE_ORG          = keccak256("atl:OrganizationAgent");
    bytes32 constant TYPE_HUB          = keccak256("atl:HubAgent");

    function setUp() public {
        alice = makeAddr("alice");
        entryPoint = new EntryPoint();
        ontology = new OntologyTermRegistry(address(this));
        attrAuth = new AttributeAuth(address(this));
        store = new OntologyAttributeStore(address(ontology), address(this));
        store.setAuth(address(attrAuth));
        shapes = new ShapeRegistry(address(store), address(this));

        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));
        agentAlice = address(factory.createAccount(alice, 1));
        subjectAlice = bytes32(uint256(uint160(agentAlice)));

        ontology.registerTerm(PRED_DISPLAY_NAME, "atl:displayName", "uri", "Display Name", "string");
        ontology.registerTerm(PRED_AGENT_TYPE, "atl:agentType", "uri", "Agent Type", "bytes32");
        ontology.registerTerm(PRED_COMPANY_TYPE, "sa:companyType", "uri", "Company Type", "bytes32");
        ontology.registerTerm(PRED_DESCRIPTION, "atl:description", "uri", "Description", "string");
        ontology.registerTerm(PRED_ACCEPTED_KINDS, "sa:poolAcceptedKinds", "uri", "Pool Accepted Kinds", "bytes32[]");

        // Define enum sets
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
        props[0] = ShapeRegistry.PropertyConstraint({
            predicate: PRED_DISPLAY_NAME,
            expectedDatatype: store.DT_STRING(),
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[1] = ShapeRegistry.PropertyConstraint({
            predicate: PRED_AGENT_TYPE,
            expectedDatatype: store.DT_BYTES32(),
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[2] = ShapeRegistry.PropertyConstraint({
            predicate: PRED_COMPANY_TYPE,
            expectedDatatype: store.DT_BYTES32(),
            cardinality: ShapeRegistry.Cardinality.OPTIONAL,
            enumSetId: ENUM_COMPANY_TYPE,
            expectedClass: bytes32(0)
        });
        props[3] = ShapeRegistry.PropertyConstraint({
            predicate: PRED_DESCRIPTION,
            expectedDatatype: store.DT_STRING(),
            cardinality: ShapeRegistry.Cardinality.OPTIONAL,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        return props;
    }

    function _defineOrgShape() internal {
        shapes.defineShape(CLASS_ORG_AGENT, _orgShapeProps(), "https://example/OrgShape", keccak256("v1"));
    }

    // ─── Definition / lifecycle ─────────────────────────────────────

    function test_define_shape() public {
        _defineOrgShape();
        ShapeRegistry.Shape memory s = shapes.getShape(CLASS_ORG_AGENT);
        assertEq(s.classId, CLASS_ORG_AGENT);
        assertEq(s.version, 1);
        assertTrue(s.active);
        assertTrue(s.exists);
        assertEq(shapes.shapeCount(), 1);
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
        props[0] = ShapeRegistry.PropertyConstraint({
            predicate: PRED_DISPLAY_NAME,
            expectedDatatype: store.DT_STRING(),
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        shapes.updateShape(CLASS_ORG_AGENT, props, "https://example/OrgShape/v2", keccak256("v2"));
        assertEq(shapes.getShape(CLASS_ORG_AGENT).version, 2);
        assertEq(shapes.getProperties(CLASS_ORG_AGENT).length, 1);
    }

    function test_deactivate_and_activate_shape() public {
        _defineOrgShape();
        shapes.deactivateShape(CLASS_ORG_AGENT);
        assertFalse(shapes.getShape(CLASS_ORG_AGENT).active);
        shapes.activateShape(CLASS_ORG_AGENT);
        assertTrue(shapes.getShape(CLASS_ORG_AGENT).active);
    }

    function test_only_governor_can_define() public {
        ShapeRegistry.PropertyConstraint[] memory props = _orgShapeProps();
        vm.prank(alice);
        vm.expectRevert(ShapeRegistry.NotGovernor.selector);
        shapes.defineShape(CLASS_ORG_AGENT, props, "x", bytes32(0));
    }

    // ─── Enum set ───────────────────────────────────────────────────

    function test_enum_set_membership() public view {
        assertTrue(shapes.isInEnumSet(ENUM_COMPANY_TYPE, CT_FAITH_NETWORK));
        assertFalse(shapes.isInEnumSet(ENUM_COMPANY_TYPE, keccak256("sa:Random")));
    }

    function test_enum_set_redefinition_clears_old_values() public {
        bytes32[] memory smaller = new bytes32[](1);
        smaller[0] = CT_NONPROFIT;
        shapes.defineEnumSet(ENUM_COMPANY_TYPE, smaller);
        assertTrue(shapes.isInEnumSet(ENUM_COMPANY_TYPE, CT_NONPROFIT));
        assertFalse(shapes.isInEnumSet(ENUM_COMPANY_TYPE, CT_FAITH_NETWORK));
    }

    function test_enum_set_empty_reverts() public {
        bytes32[] memory empty = new bytes32[](0);
        vm.expectRevert(ShapeRegistry.EnumSetEmpty.selector);
        shapes.defineEnumSet(keccak256("empty"), empty);
    }

    // ─── Validation: required ──────────────────────────────────────

    function test_validate_passes_with_required_set() public {
        _defineOrgShape();
        vm.startPrank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "Front Range");
        store.setBytes32(subjectAlice, PRED_AGENT_TYPE, TYPE_ORG);
        vm.stopPrank();

        shapes.validateSubject(CLASS_ORG_AGENT, subjectAlice);
        assertTrue(shapes.isValid(CLASS_ORG_AGENT, subjectAlice));
    }

    function test_validate_reverts_when_required_missing() public {
        _defineOrgShape();
        vm.prank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "Front Range");
        // PRED_AGENT_TYPE is required but not set

        vm.expectRevert(abi.encodeWithSelector(
            ShapeRegistry.MissingRequiredProperty.selector, PRED_AGENT_TYPE
        ));
        shapes.validateSubject(CLASS_ORG_AGENT, subjectAlice);
        assertFalse(shapes.isValid(CLASS_ORG_AGENT, subjectAlice));
    }

    function test_validate_optional_skipped_when_missing() public {
        _defineOrgShape();
        vm.startPrank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "Front Range");
        store.setBytes32(subjectAlice, PRED_AGENT_TYPE, TYPE_ORG);
        // PRED_COMPANY_TYPE optional, not set
        // PRED_DESCRIPTION optional, not set
        vm.stopPrank();

        shapes.validateSubject(CLASS_ORG_AGENT, subjectAlice);
    }

    // ─── Validation: datatype ──────────────────────────────────────

    function test_validate_reverts_on_wrong_datatype() public {
        _defineOrgShape();
        vm.startPrank(alice);
        // Set displayName as a bytes32 instead of string — datatype mismatch
        // (Use the AGENT_TYPE predicate but write a string for it)
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "Front Range");
        store.setString(subjectAlice, PRED_AGENT_TYPE, "OrganizationAgent"); // wrong: expected bytes32
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(
            ShapeRegistry.WrongDatatype.selector, PRED_AGENT_TYPE,
            store.DT_STRING(), store.DT_BYTES32()
        ));
        shapes.validateSubject(CLASS_ORG_AGENT, subjectAlice);
    }

    // ─── Validation: enum ──────────────────────────────────────────

    function test_validate_passes_with_valid_enum_value() public {
        _defineOrgShape();
        vm.startPrank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "Front Range");
        store.setBytes32(subjectAlice, PRED_AGENT_TYPE, TYPE_ORG);
        store.setBytes32(subjectAlice, PRED_COMPANY_TYPE, CT_FAITH_NETWORK);
        vm.stopPrank();

        shapes.validateSubject(CLASS_ORG_AGENT, subjectAlice);
    }

    function test_validate_reverts_on_invalid_enum_value() public {
        _defineOrgShape();
        bytes32 fake = keccak256("sa:NotARealCompanyType");
        vm.startPrank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "Front Range");
        store.setBytes32(subjectAlice, PRED_AGENT_TYPE, TYPE_ORG);
        store.setBytes32(subjectAlice, PRED_COMPANY_TYPE, fake);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(
            ShapeRegistry.EnumValueNotAllowed.selector, PRED_COMPANY_TYPE, fake
        ));
        shapes.validateSubject(CLASS_ORG_AGENT, subjectAlice);
    }

    function test_validate_array_enum_all_values_must_be_in_set() public {
        // Define a Pool-like shape with required acceptedKinds (bytes32[]) constrained to enum
        bytes32 classPool = keccak256("sa:Pool");
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](1);
        props[0] = ShapeRegistry.PropertyConstraint({
            predicate: PRED_ACCEPTED_KINDS,
            expectedDatatype: store.DT_BYTES32_ARR(),
            cardinality: ShapeRegistry.Cardinality.REQUIRED_MANY,
            enumSetId: ENUM_POOL_KINDS,
            expectedClass: bytes32(0)
        });
        shapes.defineShape(classPool, props, "uri", bytes32(0));

        // Set with one valid + one invalid
        bytes32[] memory kinds = new bytes32[](2);
        kinds[0] = keccak256("sa:GivingFund");      // valid
        kinds[1] = keccak256("sa:NotInTheEnum");    // invalid
        vm.prank(alice);
        store.setBytes32Arr(subjectAlice, PRED_ACCEPTED_KINDS, kinds);

        vm.expectRevert(abi.encodeWithSelector(
            ShapeRegistry.EnumValueNotAllowed.selector, PRED_ACCEPTED_KINDS, kinds[1]
        ));
        shapes.validateSubject(classPool, subjectAlice);
    }

    // ─── Validation: shape lifecycle ───────────────────────────────

    function test_validate_reverts_if_shape_not_defined() public {
        bytes32 unknownClass = keccak256("sa:NotDefined");
        vm.expectRevert(ShapeRegistry.ShapeNotDefined.selector);
        shapes.validateSubject(unknownClass, subjectAlice);
    }

    function test_validate_reverts_if_shape_inactive() public {
        _defineOrgShape();
        shapes.deactivateShape(CLASS_ORG_AGENT);

        vm.startPrank(alice);
        store.setString(subjectAlice, PRED_DISPLAY_NAME, "Front Range");
        store.setBytes32(subjectAlice, PRED_AGENT_TYPE, TYPE_ORG);
        vm.stopPrank();

        vm.expectRevert(ShapeRegistry.ShapeNotActive.selector);
        shapes.validateSubject(CLASS_ORG_AGENT, subjectAlice);
    }

    // ─── isValid wrapper ───────────────────────────────────────────

    function test_isValid_returns_false_on_failure_no_revert() public {
        _defineOrgShape();
        // No properties set — required fields missing
        assertFalse(shapes.isValid(CLASS_ORG_AGENT, subjectAlice));
    }
}
