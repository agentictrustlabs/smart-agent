// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/SkillIssuerRegistry.sol";

/**
 * @notice Tests for the v1 SkillIssuerRegistry.
 *
 * Coverage:
 *   • Curator-only registration / deactivation / slashing.
 *   • Wildcard ANY_SKILL authority vs explicit skillId list.
 *   • canIssue() composes registration, active flag, and authority.
 *   • Issuer self-update path (updateIssuer).
 *   • DID lookup round-trip.
 *   • Slash bookkeeping (no ETH custody yet).
 *   • Curator handoff.
 */
contract SkillIssuerRegistryTest is Test {

    SkillIssuerRegistry reg;

    address curator;
    address issuerA;
    address issuerB;

    bytes32 constant SKILL_GRANT_WRITING        = keccak256("skill:custom:grant-writing");
    bytes32 constant SKILL_COMMUNITY_ORGANIZING = keccak256("skill:custom:community-organizing");

    function setUp() public {
        curator = makeAddr("curator");
        issuerA = makeAddr("issuerA");
        issuerB = makeAddr("issuerB");

        vm.prank(curator);
        reg = new SkillIssuerRegistry(curator);
    }

    // ─── Registration ─────────────────────────────────────────────

    function testRegisterIssuerWithExplicitSkills() public {
        bytes32[] memory skills = new bytes32[](2);
        skills[0] = SKILL_GRANT_WRITING;
        skills[1] = SKILL_COMMUNITY_ORGANIZING;

        vm.prank(curator);
        reg.registerIssuer(
            issuerA, "did:smart-agent:catalyst-noco", 8000, 1 ether,
            "ipfs://catalyst-issuer-profile.json", skills
        );

        SkillIssuerRegistry.Issuer memory iss = reg.getIssuer(issuerA);
        assertEq(iss.account, issuerA);
        assertEq(iss.trustWeight, 8000);
        assertEq(iss.stakeWei, 1 ether);
        assertTrue(iss.active);

        assertTrue(reg.isRegistered(issuerA));
        assertTrue(reg.isActive(issuerA));
        assertTrue(reg.canIssue(issuerA, SKILL_GRANT_WRITING));
        assertTrue(reg.canIssue(issuerA, SKILL_COMMUNITY_ORGANIZING));
        assertFalse(reg.canIssue(issuerA, keccak256("skill:custom:other")));
        assertEq(reg.trustWeight(issuerA), 8000);
        assertEq(reg.issuerByDid("did:smart-agent:catalyst-noco"), issuerA);
    }

    function testRegisterIssuerWithWildcard() public {
        bytes32[] memory skills = new bytes32[](1);
        skills[0] = reg.ANY_SKILL();

        vm.prank(curator);
        reg.registerIssuer(issuerA, "did:web:wycliffe.org", 9000, 0, "", skills);

        // Wildcard authority covers any skillId.
        assertTrue(reg.canIssue(issuerA, SKILL_GRANT_WRITING));
        assertTrue(reg.canIssue(issuerA, keccak256("skill:any:thing")));
    }

    function testNonCuratorCannotRegister() public {
        bytes32[] memory skills = new bytes32[](0);
        vm.prank(issuerA);
        vm.expectRevert(SkillIssuerRegistry.NotCurator.selector);
        reg.registerIssuer(issuerA, "did:web:fake", 5000, 0, "", skills);
    }

    function testCannotRegisterTwice() public {
        bytes32[] memory skills = new bytes32[](0);
        vm.prank(curator);
        reg.registerIssuer(issuerA, "did:foo", 1000, 0, "", skills);

        vm.prank(curator);
        vm.expectRevert(SkillIssuerRegistry.AlreadyRegistered.selector);
        reg.registerIssuer(issuerA, "did:foo", 5000, 0, "", skills);
    }

    function testInvalidTrustWeightReverts() public {
        bytes32[] memory skills = new bytes32[](0);
        vm.prank(curator);
        vm.expectRevert(SkillIssuerRegistry.InvalidTrust.selector);
        reg.registerIssuer(issuerA, "did:foo", 10001, 0, "", skills);
    }

    // ─── Update / activate / deactivate ───────────────────────────

    function testIssuerCanSelfUpdate() public {
        bytes32[] memory skills = new bytes32[](0);
        vm.prank(curator);
        reg.registerIssuer(issuerA, "did:x", 5000, 0, "old", skills);

        vm.prank(issuerA);
        reg.updateIssuer(issuerA, 7500, "ipfs://new");

        SkillIssuerRegistry.Issuer memory iss = reg.getIssuer(issuerA);
        assertEq(iss.trustWeight, 7500);
        assertEq(keccak256(bytes(iss.metadataURI)), keccak256(bytes("ipfs://new")));
    }

    function testCuratorCanUpdateIssuer() public {
        bytes32[] memory skills = new bytes32[](0);
        vm.prank(curator);
        reg.registerIssuer(issuerA, "did:x", 5000, 0, "", skills);

        vm.prank(curator);
        reg.updateIssuer(issuerA, 9999, "");
        assertEq(reg.trustWeight(issuerA), 9999);
    }

    function testStrangerCannotUpdateIssuer() public {
        bytes32[] memory skills = new bytes32[](0);
        vm.prank(curator);
        reg.registerIssuer(issuerA, "did:x", 5000, 0, "", skills);

        vm.prank(issuerB);
        vm.expectRevert(SkillIssuerRegistry.NotAuthorized.selector);
        reg.updateIssuer(issuerA, 9999, "");
    }

    function testDeactivateIssuerHidesAuthority() public {
        bytes32[] memory skills = new bytes32[](1);
        skills[0] = SKILL_GRANT_WRITING;
        vm.prank(curator);
        reg.registerIssuer(issuerA, "did:x", 5000, 0, "", skills);

        vm.prank(curator);
        reg.deactivateIssuer(issuerA);

        assertTrue(reg.isRegistered(issuerA));
        assertFalse(reg.isActive(issuerA));
        // Inactive issuers cannot issue regardless of explicit authority.
        assertFalse(reg.canIssue(issuerA, SKILL_GRANT_WRITING));
        assertEq(reg.trustWeight(issuerA), 0);

        vm.prank(curator);
        reg.activateIssuer(issuerA);
        assertTrue(reg.canIssue(issuerA, SKILL_GRANT_WRITING));
    }

    // ─── Slashing (bookkeeping) ───────────────────────────────────

    function testSlashDecrementsStake() public {
        bytes32[] memory skills = new bytes32[](0);
        vm.prank(curator);
        reg.registerIssuer(issuerA, "did:x", 5000, 10 ether, "", skills);

        vm.prank(curator);
        reg.slash(issuerA, 3 ether, "audit failure");

        assertEq(reg.getIssuer(issuerA).stakeWei, 7 ether);
    }

    function testCannotSlashMoreThanStaked() public {
        bytes32[] memory skills = new bytes32[](0);
        vm.prank(curator);
        reg.registerIssuer(issuerA, "did:x", 5000, 1 ether, "", skills);

        vm.prank(curator);
        vm.expectRevert(SkillIssuerRegistry.InvalidStake.selector);
        reg.slash(issuerA, 2 ether, "too much");
    }

    function testNonCuratorCannotSlash() public {
        bytes32[] memory skills = new bytes32[](0);
        vm.prank(curator);
        reg.registerIssuer(issuerA, "did:x", 5000, 5 ether, "", skills);

        vm.prank(issuerA);
        vm.expectRevert(SkillIssuerRegistry.NotCurator.selector);
        reg.slash(issuerA, 1 ether, "self-slash");
    }

    // ─── Skill authority management ───────────────────────────────

    function testAuthoriseAndRevokeSkill() public {
        bytes32[] memory skills = new bytes32[](0);
        vm.prank(curator);
        reg.registerIssuer(issuerA, "did:x", 5000, 0, "", skills);

        assertFalse(reg.canIssue(issuerA, SKILL_GRANT_WRITING));

        vm.prank(curator);
        reg.authoriseSkill(issuerA, SKILL_GRANT_WRITING);
        assertTrue(reg.canIssue(issuerA, SKILL_GRANT_WRITING));

        vm.prank(curator);
        reg.revokeSkill(issuerA, SKILL_GRANT_WRITING);
        assertFalse(reg.canIssue(issuerA, SKILL_GRANT_WRITING));
    }

    // ─── Curator handoff ──────────────────────────────────────────

    function testCuratorHandoff() public {
        address nextCurator = makeAddr("nextCurator");
        vm.prank(curator);
        reg.setCurator(nextCurator);
        assertEq(reg.curator(), nextCurator);

        // Old curator can no longer register.
        bytes32[] memory skills = new bytes32[](0);
        vm.prank(curator);
        vm.expectRevert(SkillIssuerRegistry.NotCurator.selector);
        reg.registerIssuer(issuerA, "did:x", 5000, 0, "", skills);

        // New curator can.
        vm.prank(nextCurator);
        reg.registerIssuer(issuerA, "did:x", 5000, 0, "", skills);
    }
}
