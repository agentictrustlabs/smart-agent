// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/OntologyTermRegistry.sol";
import "./helpers/TestAttributeStorage.sol";

contract AttributeStorageTest is Test {
    OntologyTermRegistry ontology;
    TestAttributeStorage store;

    bytes32 subjectAlice = bytes32(uint256(0xAA));
    bytes32 subjectBob   = bytes32(uint256(0xBB));

    bytes32 constant PRED_DISPLAY_NAME   = keccak256("atl:displayName");
    bytes32 constant PRED_AGENT_TYPE     = keccak256("atl:agentType");
    bytes32 constant PRED_OPERATOR       = keccak256("atl:operatedBy");
    bytes32 constant PRED_IS_ACTIVE      = keccak256("atl:isActive");
    bytes32 constant PRED_REGISTERED     = keccak256("atl:registeredAt");
    bytes32 constant PRED_CAPABILITIES   = keccak256("atl:hasCapability");
    bytes32 constant PRED_CONTROLLERS    = keccak256("atl:hasController");
    bytes32 constant PRED_ACCEPTED_KINDS = keccak256("sa:poolAcceptedKinds");

    function setUp() public {
        ontology = new OntologyTermRegistry(address(this));
        store = new TestAttributeStorage(address(ontology));

        _registerTerm(PRED_DISPLAY_NAME, "atl:displayName", "string");
        _registerTerm(PRED_AGENT_TYPE, "atl:agentType", "bytes32");
        _registerTerm(PRED_OPERATOR, "atl:operatedBy", "address");
        _registerTerm(PRED_IS_ACTIVE, "atl:isActive", "bool");
        _registerTerm(PRED_REGISTERED, "atl:registeredAt", "uint256");
        _registerTerm(PRED_CAPABILITIES, "atl:hasCapability", "string[]");
        _registerTerm(PRED_CONTROLLERS, "atl:hasController", "address[]");
        _registerTerm(PRED_ACCEPTED_KINDS, "sa:poolAcceptedKinds", "bytes32[]");
    }

    function _registerTerm(bytes32 id, string memory curie, string memory dt) internal {
        ontology.registerTerm(id, curie, string.concat("https://example/", curie), curie, dt);
    }

    // ─── Round-trip per family ──────────────────────────────────────

    function test_string_roundtrip() public {
        store.pubSetString(subjectAlice, PRED_DISPLAY_NAME, "Alice Agent");
        assertEq(store.getString(subjectAlice, PRED_DISPLAY_NAME), "Alice Agent");
        assertTrue(store.isSet(subjectAlice, PRED_DISPLAY_NAME));
    }

    function test_address_roundtrip() public {
        store.pubSetAddress(subjectAlice, PRED_OPERATOR, address(0xCAFE));
        assertEq(store.getAddress(subjectAlice, PRED_OPERATOR), address(0xCAFE));
    }

    function test_bool_roundtrip() public {
        store.pubSetBool(subjectAlice, PRED_IS_ACTIVE, true);
        assertTrue(store.getBool(subjectAlice, PRED_IS_ACTIVE));
    }

    function test_uint_roundtrip() public {
        store.pubSetUint(subjectAlice, PRED_REGISTERED, 1234567890);
        assertEq(store.getUint(subjectAlice, PRED_REGISTERED), 1234567890);
    }

    function test_bytes32_roundtrip() public {
        bytes32 v = keccak256("atl:OrganizationAgent");
        store.pubSetBytes32(subjectAlice, PRED_AGENT_TYPE, v);
        assertEq(store.getBytes32(subjectAlice, PRED_AGENT_TYPE), v);
    }

    function test_string_array_set_and_replace() public {
        string[] memory caps = new string[](2);
        caps[0] = "evaluate-trust";
        caps[1] = "discover-agents";
        store.pubSetStringArr(subjectAlice, PRED_CAPABILITIES, caps);
        string[] memory got = store.getStringArr(subjectAlice, PRED_CAPABILITIES);
        assertEq(got.length, 2);
        assertEq(got[0], "evaluate-trust");

        string[] memory caps2 = new string[](1);
        caps2[0] = "submit-review";
        store.pubSetStringArr(subjectAlice, PRED_CAPABILITIES, caps2);
        string[] memory got2 = store.getStringArr(subjectAlice, PRED_CAPABILITIES);
        assertEq(got2.length, 1);
    }

    function test_address_array_roundtrip() public {
        address[] memory ctrls = new address[](2);
        ctrls[0] = address(0xAA);
        ctrls[1] = address(0xBB);
        store.pubSetAddressArr(subjectAlice, PRED_CONTROLLERS, ctrls);
        assertEq(store.getAddressArr(subjectAlice, PRED_CONTROLLERS).length, 2);
    }

    function test_bytes32_array_roundtrip() public {
        bytes32[] memory kinds = new bytes32[](3);
        kinds[0] = keccak256("sa:GivingFund");
        kinds[1] = keccak256("sa:CoachingNetwork");
        kinds[2] = keccak256("sa:PrayerChain");
        store.pubSetBytes32Arr(subjectAlice, PRED_ACCEPTED_KINDS, kinds);
        bytes32[] memory got = store.getBytes32Arr(subjectAlice, PRED_ACCEPTED_KINDS);
        assertEq(got.length, 3);
    }

    // ─── Append ─────────────────────────────────────────────────────

    function test_append_string() public {
        store.pubAppendString(subjectAlice, PRED_CAPABILITIES, "cap1");
        store.pubAppendString(subjectAlice, PRED_CAPABILITIES, "cap2");
        string[] memory got = store.getStringArr(subjectAlice, PRED_CAPABILITIES);
        assertEq(got.length, 2);
        assertEq(got[1], "cap2");
    }

    // ─── Enumeration ────────────────────────────────────────────────

    function test_predicates_of_no_duplicates() public {
        store.pubSetString(subjectAlice, PRED_DISPLAY_NAME, "v1");
        store.pubSetString(subjectAlice, PRED_DISPLAY_NAME, "v2");
        store.pubSetBool(subjectAlice, PRED_IS_ACTIVE, true);
        bytes32[] memory preds = store.predicatesOf(subjectAlice);
        assertEq(preds.length, 2);
    }

    function test_subjects_tracked() public {
        store.pubSetString(subjectAlice, PRED_DISPLAY_NAME, "Alice");
        store.pubSetString(subjectBob, PRED_DISPLAY_NAME, "Bob");
        bytes32[] memory subs = store.allSubjects();
        assertEq(subs.length, 2);
    }

    function test_subject_isolation() public {
        store.pubSetString(subjectAlice, PRED_DISPLAY_NAME, "Alice");
        store.pubSetString(subjectBob, PRED_DISPLAY_NAME, "Bob");
        assertEq(store.getString(subjectAlice, PRED_DISPLAY_NAME), "Alice");
        assertEq(store.getString(subjectBob, PRED_DISPLAY_NAME), "Bob");
    }

    // ─── Version monotonicity ───────────────────────────────────────

    function test_subject_version_increments() public {
        assertEq(store.subjectVersion(subjectAlice), 0);
        store.pubSetString(subjectAlice, PRED_DISPLAY_NAME, "v1");
        assertEq(store.subjectVersion(subjectAlice), 1);
        store.pubSetBool(subjectAlice, PRED_IS_ACTIVE, true);
        assertEq(store.subjectVersion(subjectAlice), 2);
        store.pubUnset(subjectAlice, PRED_IS_ACTIVE);
        assertEq(store.subjectVersion(subjectAlice), 3);
    }

    function test_updated_at_matches_version() public {
        store.pubSetString(subjectAlice, PRED_DISPLAY_NAME, "v1");
        assertEq(store.updatedAt(subjectAlice, PRED_DISPLAY_NAME), 1);
        store.pubSetBool(subjectAlice, PRED_IS_ACTIVE, true);
        assertEq(store.updatedAt(subjectAlice, PRED_DISPLAY_NAME), 1);
        assertEq(store.updatedAt(subjectAlice, PRED_IS_ACTIVE), 2);
    }

    // ─── Predicate validation ───────────────────────────────────────

    function test_unregistered_predicate_reverts() public {
        bytes32 fake = keccak256("not:registered");
        vm.expectRevert(AttributeStorage.PredicateNotActive.selector);
        store.pubSetString(subjectAlice, fake, "x");
    }

    function test_deactivated_predicate_reverts() public {
        ontology.deactivateTerm(PRED_DISPLAY_NAME);
        vm.expectRevert(AttributeStorage.PredicateNotActive.selector);
        store.pubSetString(subjectAlice, PRED_DISPLAY_NAME, "x");
    }

    // ─── Unset ──────────────────────────────────────────────────────

    function test_unset_clears_value() public {
        store.pubSetString(subjectAlice, PRED_DISPLAY_NAME, "v1");
        assertTrue(store.isSet(subjectAlice, PRED_DISPLAY_NAME));
        store.pubUnset(subjectAlice, PRED_DISPLAY_NAME);
        assertFalse(store.isSet(subjectAlice, PRED_DISPLAY_NAME));
        assertEq(bytes(store.getString(subjectAlice, PRED_DISPLAY_NAME)).length, 0);
    }

    function test_unset_reverts_if_not_set() public {
        vm.expectRevert(AttributeStorage.AttributeNotSet.selector);
        store.pubUnset(subjectAlice, PRED_DISPLAY_NAME);
    }
}
