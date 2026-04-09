// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentRelationship.sol";
import "../src/AgentAssertion.sol";
import "../src/AgentRelationshipResolver.sol";
import "../src/AgentAccountFactory.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract AgentRelationshipProtocolTest is Test {
    AgentRelationship public rel;
    AgentAssertion public assertion;
    AgentRelationshipResolver public resolver;

    AgentAccountFactory public factory;
    address public personAgent;
    address public orgAgent;

    address public alice;
    address public bob;

    bytes32 ORG_MEMBERSHIP;
    bytes32 ROLE_OWNER;
    bytes32 ROLE_MEMBER;
    bytes32 ROLE_ADMIN;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        EntryPoint ep = new EntryPoint();
        factory = new AgentAccountFactory(IEntryPoint(address(ep)), address(0), address(this));
        personAgent = address(factory.createAccount(alice, 1));
        orgAgent = address(factory.createAccount(alice, 2));

        rel = new AgentRelationship();
        assertion = new AgentAssertion(address(rel));
        resolver = new AgentRelationshipResolver(address(rel), address(assertion));

        ORG_MEMBERSHIP = rel.ORGANIZATION_MEMBERSHIP();
        ROLE_OWNER = rel.ROLE_OWNER();
        ROLE_MEMBER = rel.ROLE_MEMBER();
        ROLE_ADMIN = rel.ROLE_ADMIN();
    }

    // ═══════════════════════════════════════════════════════════════
    // Edge Layer — one edge per (subject, object, relationshipType)
    // ═══════════════════════════════════════════════════════════════

    function test_createEdge_with_roles() public {
        bytes32[] memory roles = new bytes32[](2);
        roles[0] = ROLE_OWNER;
        roles[1] = ROLE_MEMBER;

        vm.prank(alice);
        bytes32 edgeId = rel.createEdge(
            personAgent, orgAgent, ORG_MEMBERSHIP, roles, ""
        );

        assertTrue(rel.edgeExists(edgeId));

        AgentRelationship.Edge memory e = rel.getEdge(edgeId);
        assertEq(e.subject, personAgent);
        assertEq(e.object_, orgAgent);
        assertEq(e.relationshipType, ORG_MEMBERSHIP);
        assertEq(uint8(e.status), uint8(AgentRelationship.EdgeStatus.PROPOSED));

        // Both roles exist
        assertTrue(rel.hasRole(edgeId, ROLE_OWNER));
        assertTrue(rel.hasRole(edgeId, ROLE_MEMBER));
        assertFalse(rel.hasRole(edgeId, ROLE_ADMIN));

        bytes32[] memory storedRoles = rel.getRoles(edgeId);
        assertEq(storedRoles.length, 2);
    }

    function test_createEdge_no_initial_roles() public {
        bytes32[] memory empty = new bytes32[](0);

        vm.prank(alice);
        bytes32 edgeId = rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, empty, "");

        bytes32[] memory roles = rel.getRoles(edgeId);
        assertEq(roles.length, 0);
    }

    function test_edgeId_is_triple_only() public view {
        // edgeId does NOT include role — one edge per triple
        bytes32 id = rel.computeEdgeId(personAgent, orgAgent, ORG_MEMBERSHIP);
        bytes32 id2 = rel.computeEdgeId(personAgent, orgAgent, ORG_MEMBERSHIP);
        assertEq(id, id2);
    }

    function test_createEdge_reverts_duplicate() public {
        bytes32[] memory roles = new bytes32[](1);
        roles[0] = ROLE_MEMBER;

        vm.prank(alice);
        rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, roles, "");

        vm.prank(alice);
        vm.expectRevert(AgentRelationship.EdgeAlreadyExists.selector);
        rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, roles, "");
    }

    function test_addRole() public {
        bytes32[] memory roles = new bytes32[](1);
        roles[0] = ROLE_MEMBER;

        vm.startPrank(alice);
        bytes32 edgeId = rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, roles, "");

        // Add another role to same edge
        rel.addRole(edgeId, ROLE_ADMIN);
        vm.stopPrank();

        assertTrue(rel.hasRole(edgeId, ROLE_MEMBER));
        assertTrue(rel.hasRole(edgeId, ROLE_ADMIN));
        assertEq(rel.getRoles(edgeId).length, 2);
    }

    function test_addRole_reverts_duplicate() public {
        bytes32[] memory roles = new bytes32[](1);
        roles[0] = ROLE_MEMBER;

        vm.startPrank(alice);
        bytes32 edgeId = rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, roles, "");

        vm.expectRevert(AgentRelationship.RoleAlreadyExists.selector);
        rel.addRole(edgeId, ROLE_MEMBER);
        vm.stopPrank();
    }

    function test_removeRole() public {
        bytes32[] memory roles = new bytes32[](2);
        roles[0] = ROLE_OWNER;
        roles[1] = ROLE_MEMBER;

        vm.startPrank(alice);
        bytes32 edgeId = rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, roles, "");
        rel.removeRole(edgeId, ROLE_OWNER);
        vm.stopPrank();

        assertFalse(rel.hasRole(edgeId, ROLE_OWNER));
        assertTrue(rel.hasRole(edgeId, ROLE_MEMBER));
        assertEq(rel.getRoles(edgeId).length, 1);
    }

    function test_removeRole_reverts_not_found() public {
        bytes32[] memory roles = new bytes32[](1);
        roles[0] = ROLE_MEMBER;

        vm.startPrank(alice);
        bytes32 edgeId = rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, roles, "");

        vm.expectRevert(AgentRelationship.RoleNotFound.selector);
        rel.removeRole(edgeId, ROLE_ADMIN);
        vm.stopPrank();
    }

    function test_addRole_reverts_unauthorized() public {
        bytes32[] memory roles = new bytes32[](1);
        roles[0] = ROLE_MEMBER;

        vm.prank(alice);
        bytes32 edgeId = rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, roles, "");

        vm.prank(bob);
        vm.expectRevert(AgentRelationship.NotAuthorized.selector);
        rel.addRole(edgeId, ROLE_ADMIN);
    }

    function test_setEdgeStatus() public {
        bytes32[] memory roles = new bytes32[](1);
        roles[0] = ROLE_MEMBER;

        vm.startPrank(alice);
        bytes32 edgeId = rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, roles, "");
        rel.setEdgeStatus(edgeId, AgentRelationship.EdgeStatus.ACTIVE);
        vm.stopPrank();

        assertEq(uint8(rel.getEdge(edgeId).status), uint8(AgentRelationship.EdgeStatus.ACTIVE));
    }

    function test_getEdgeByTriple() public {
        bytes32[] memory roles = new bytes32[](1);
        roles[0] = ROLE_MEMBER;

        vm.prank(alice);
        bytes32 edgeId = rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, roles, "");

        bytes32 found = rel.getEdgeByTriple(personAgent, orgAgent, ORG_MEMBERSHIP);
        assertEq(found, edgeId);
    }

    // ═══════════════════════════════════════════════════════════════
    // Assertion Layer
    // ═══════════════════════════════════════════════════════════════

    function test_makeAssertion() public {
        bytes32[] memory roles = new bytes32[](1);
        roles[0] = ROLE_MEMBER;

        vm.prank(alice);
        bytes32 edgeId = rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, roles, "");

        vm.prank(orgAgent);
        uint256 aId = assertion.makeAssertion(
            edgeId, AgentAssertion.AssertionType.OBJECT_ASSERTED, 0, 0, "ipfs://evidence"
        );

        AgentAssertion.AssertionRecord memory a = assertion.getAssertion(aId);
        assertEq(a.edgeId, edgeId);
        assertEq(a.asserter, orgAgent);
        assertFalse(a.revoked);
    }

    function test_revokeAssertion() public {
        bytes32[] memory roles = new bytes32[](1);
        roles[0] = ROLE_MEMBER;

        vm.prank(alice);
        bytes32 edgeId = rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, roles, "");

        vm.prank(orgAgent);
        uint256 aId = assertion.makeAssertion(
            edgeId, AgentAssertion.AssertionType.OBJECT_ASSERTED, 0, 0, ""
        );

        assertTrue(assertion.isAssertionCurrentlyValid(aId));

        vm.prank(orgAgent);
        assertion.revokeAssertion(aId);
        assertFalse(assertion.isAssertionCurrentlyValid(aId));
    }

    // ═══════════════════════════════════════════════════════════════
    // Resolver — multi-role queries
    // ═══════════════════════════════════════════════════════════════

    function _createActiveEdge(bytes32[] memory roles) internal returns (bytes32 edgeId) {
        vm.startPrank(alice);
        edgeId = rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, roles, "");
        rel.setEdgeStatus(edgeId, AgentRelationship.EdgeStatus.ACTIVE);
        vm.stopPrank();
    }

    function test_resolver_holdsRole_with_multi_roles() public {
        bytes32[] memory roles = new bytes32[](2);
        roles[0] = ROLE_OWNER;
        roles[1] = ROLE_MEMBER;

        bytes32 edgeId = _createActiveEdge(roles);

        // Object asserts
        vm.prank(orgAgent);
        assertion.makeAssertion(edgeId, AgentAssertion.AssertionType.OBJECT_ASSERTED, 0, 0, "");

        // Both roles resolve
        assertTrue(resolver.holdsRole(
            personAgent, orgAgent, ROLE_OWNER, ORG_MEMBERSHIP,
            AgentRelationshipResolver.ResolutionMode.REQUIRE_OBJECT_ASSERTION
        ));
        assertTrue(resolver.holdsRole(
            personAgent, orgAgent, ROLE_MEMBER, ORG_MEMBERSHIP,
            AgentRelationshipResolver.ResolutionMode.REQUIRE_OBJECT_ASSERTION
        ));

        // Non-existent role does not resolve
        assertFalse(resolver.holdsRole(
            personAgent, orgAgent, ROLE_ADMIN, ORG_MEMBERSHIP,
            AgentRelationshipResolver.ResolutionMode.REQUIRE_OBJECT_ASSERTION
        ));
    }

    function test_resolver_getActiveRoles() public {
        bytes32[] memory roles = new bytes32[](3);
        roles[0] = ROLE_OWNER;
        roles[1] = ROLE_ADMIN;
        roles[2] = ROLE_MEMBER;

        bytes32 edgeId = _createActiveEdge(roles);

        vm.prank(orgAgent);
        assertion.makeAssertion(edgeId, AgentAssertion.AssertionType.OBJECT_ASSERTED, 0, 0, "");

        bytes32[] memory active = resolver.getActiveRoles(
            personAgent, orgAgent, ORG_MEMBERSHIP,
            AgentRelationshipResolver.ResolutionMode.REQUIRE_ANY_VALID_ASSERTION
        );

        assertEq(active.length, 3);
    }

    function test_resolver_edge_active_only() public {
        bytes32[] memory roles = new bytes32[](1);
        roles[0] = ROLE_MEMBER;

        bytes32 edgeId = _createActiveEdge(roles);

        // No assertion needed in EDGE_ACTIVE_ONLY mode
        assertTrue(resolver.holdsRole(
            personAgent, orgAgent, ROLE_MEMBER, ORG_MEMBERSHIP,
            AgentRelationshipResolver.ResolutionMode.EDGE_ACTIVE_ONLY
        ));
    }

    function test_resolver_proposed_not_active() public {
        bytes32[] memory roles = new bytes32[](1);
        roles[0] = ROLE_MEMBER;

        vm.prank(alice);
        rel.createEdge(personAgent, orgAgent, ORG_MEMBERSHIP, roles, "");

        // PROPOSED status — not active
        assertFalse(resolver.holdsRole(
            personAgent, orgAgent, ROLE_MEMBER, ORG_MEMBERSHIP,
            AgentRelationshipResolver.ResolutionMode.EDGE_ACTIVE_ONLY
        ));
    }

    function test_resolver_mutual_assertion() public {
        bytes32[] memory roles = new bytes32[](1);
        roles[0] = ROLE_MEMBER;

        bytes32 edgeId = _createActiveEdge(roles);

        // Only object asserts — mutual fails
        vm.prank(orgAgent);
        assertion.makeAssertion(edgeId, AgentAssertion.AssertionType.OBJECT_ASSERTED, 0, 0, "");

        assertFalse(resolver.holdsRole(
            personAgent, orgAgent, ROLE_MEMBER, ORG_MEMBERSHIP,
            AgentRelationshipResolver.ResolutionMode.REQUIRE_MUTUAL_ASSERTION
        ));

        // Subject also asserts — mutual succeeds
        vm.prank(personAgent);
        assertion.makeAssertion(edgeId, AgentAssertion.AssertionType.SELF_ASSERTED, 0, 0, "");

        assertTrue(resolver.holdsRole(
            personAgent, orgAgent, ROLE_MEMBER, ORG_MEMBERSHIP,
            AgentRelationshipResolver.ResolutionMode.REQUIRE_MUTUAL_ASSERTION
        ));
    }

    function test_resolver_role_removed_no_longer_holds() public {
        bytes32[] memory roles = new bytes32[](2);
        roles[0] = ROLE_OWNER;
        roles[1] = ROLE_MEMBER;

        bytes32 edgeId = _createActiveEdge(roles);

        assertTrue(resolver.holdsRole(
            personAgent, orgAgent, ROLE_OWNER, ORG_MEMBERSHIP,
            AgentRelationshipResolver.ResolutionMode.EDGE_ACTIVE_ONLY
        ));

        // Remove owner role
        vm.prank(alice);
        rel.removeRole(edgeId, ROLE_OWNER);

        assertFalse(resolver.holdsRole(
            personAgent, orgAgent, ROLE_OWNER, ORG_MEMBERSHIP,
            AgentRelationshipResolver.ResolutionMode.EDGE_ACTIVE_ONLY
        ));

        // Member still holds
        assertTrue(resolver.holdsRole(
            personAgent, orgAgent, ROLE_MEMBER, ORG_MEMBERSHIP,
            AgentRelationshipResolver.ResolutionMode.EDGE_ACTIVE_ONLY
        ));
    }
}
