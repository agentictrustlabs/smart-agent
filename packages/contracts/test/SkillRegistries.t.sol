// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/SkillDefinitionRegistry.sol";
import "../src/AgentSkillRegistry.sol";

/**
 * @notice Tests for the v0 skill registries.
 *
 * Coverage:
 *   • Definition: publish + version pin + steward auth
 *   • Claim direct mint (subject == issuer):
 *       - cap on proficiencyScore
 *       - CERTIFIED_IN forbidden
 *       - rate limit at SELF_MINT_PER_EPOCH
 *   • Claim cross-issued mint:
 *       - valid EIP-712 signature accepted
 *       - signature from wrong key rejected
 *       - tampered fields rejected
 *   • Revocation:
 *       - per-claim revoke
 *       - bumpRevocationEpoch invalidates downstream isFresh()
 *   • claimsByIssuer index (architect-review addition)
 */
contract SkillRegistriesTest is Test {

    SkillDefinitionRegistry skills;
    AgentSkillRegistry      claims;

    // EOAs (no smart-account wrapping in this test — same simplification
    // GeoClaimRegistry uses).
    address steward;     // publishes skill definitions
    address subject;     // an agent claiming a skill
    address issuer;      // a different agent who endorses
    uint256 issuerKey;   // EIP-712 signing key for `issuer`

    bytes32 constant SKILL_ID  = keccak256("skill:test:grant_writing");
    bytes32 constant POLICY_ID = keccak256("smart-agent.skill-overlap.v1");

    function setUp() public {
        steward  = makeAddr("steward");
        subject  = makeAddr("subject");
        (issuer, issuerKey) = makeAddrAndKey("issuer");

        // No `.skill` TLD wired in this unit test; bindName paths are
        // covered separately in SkillNameBinding.t.sol.
        skills = new SkillDefinitionRegistry(address(0));
        claims = new AgentSkillRegistry(skills);

        // Publish v1 of the test skill, by the steward.
        // Use startPrank/stopPrank: the publish() call internally fans
        // out to other functions (KIND_OASF_LEAF()) before the actual
        // publish, and a single-shot vm.prank only applies to the
        // immediate-next external call.
        vm.startPrank(steward);
        skills.publish(
            SKILL_ID,
            skills.KIND_OASF_LEAF(),
            steward,
            keccak256("conceptHash:v1"),
            keccak256("ontologyMerkleRoot:v1"),
            bytes32(0),
            "ipfs://skill-v1",
            0,
            0
        );
        vm.stopPrank();
    }

    // ─── Definition registry ────────────────────────────────────────

    function test_definition_publishStartsAtV1() public view {
        SkillDefinitionRegistry.SkillRecord memory r = skills.getLatest(SKILL_ID);
        assertEq(r.version, 1);
        assertEq(r.stewardAccount, steward);
        assertTrue(r.active);
    }

    function test_definition_secondVersionRequiresSameSteward() public {
        // A different steward cannot bump the version.
        address other = makeAddr("other-steward");
        // Pre-compute the KIND constant so vm.prank applies cleanly to
        // the publish() call (single-shot prank gets consumed by the
        // first external call, including argument evaluation).
        bytes32 kind = skills.KIND_OASF_LEAF();
        vm.prank(other);
        vm.expectRevert(SkillDefinitionRegistry.NotAuthorized.selector);
        skills.publish(
            SKILL_ID, kind, other,
            keccak256("conceptHash:v2"), keccak256("ontologyMerkleRoot:v2"),
            keccak256("ontologyMerkleRoot:v1"),
            "ipfs://skill-v2", 0, 0
        );
    }

    function test_definition_versionPinReadsHistorical() public {
        // Bump to v2 — use startPrank so argument evaluation doesn't
        // consume the prank.
        bytes32 kind = skills.KIND_OASF_LEAF();
        vm.startPrank(steward);
        skills.publish(
            SKILL_ID, kind, steward,
            keccak256("conceptHash:v2"), keccak256("ontologyMerkleRoot:v2"),
            keccak256("ontologyMerkleRoot:v1"),
            "ipfs://skill-v2", 0, 0
        );
        vm.stopPrank();

        SkillDefinitionRegistry.SkillRecord memory v1 = skills.getSkill(SKILL_ID, 1);
        SkillDefinitionRegistry.SkillRecord memory v2 = skills.getSkill(SKILL_ID, 2);
        assertEq(v1.version, 1);
        assertEq(v2.version, 2);
        assertTrue(v1.ontologyMerkleRoot != v2.ontologyMerkleRoot);
    }

    // ─── Direct mint (subject == issuer) ────────────────────────────

    function _selfInput(uint16 score, bytes32 relation, bytes32 nonce)
        internal view returns (AgentSkillRegistry.MintInput memory)
    {
        return AgentSkillRegistry.MintInput({
            subjectAgent: subject,
            issuer: subject,
            skillId: SKILL_ID,
            skillVersion: 1,
            relation: relation,
            visibility: AgentSkillRegistry.Visibility.Public,
            proficiencyScore: score,
            confidence: 80,
            evidenceCommit: bytes32(0),
            edgeId: bytes32(0),
            assertionId: bytes32(0),
            policyId: POLICY_ID,
            validAfter: 0,
            validUntil: 0,
            nonce: nonce
        });
    }

    function test_mintSelf_underCapAccepted() public {
        AgentSkillRegistry.MintInput memory input = _selfInput(
            5000, claims.PRACTICES_SKILL(), keccak256("nonce:1")
        );
        vm.prank(subject);
        bytes32 claimId = claims.mintSelf(input);
        assertTrue(claimId != bytes32(0));

        AgentSkillRegistry.SkillClaim memory c = claims.getClaim(claimId);
        assertEq(c.subjectAgent, subject);
        assertEq(c.issuer, subject);
        assertEq(c.proficiencyScore, 5000);
    }

    function test_mintSelf_overCapRejected() public {
        AgentSkillRegistry.MintInput memory input = _selfInput(
            6500, claims.PRACTICES_SKILL(), keccak256("nonce:cap")
        );
        vm.prank(subject);
        vm.expectRevert(AgentSkillRegistry.InvalidScore.selector);
        claims.mintSelf(input);
    }

    function test_mintSelf_certifiedInForbidden() public {
        AgentSkillRegistry.MintInput memory input = _selfInput(
            5000, claims.CERTIFIED_IN(), keccak256("nonce:cert")
        );
        vm.prank(subject);
        vm.expectRevert(AgentSkillRegistry.SelfCertNotAllowed.selector);
        claims.mintSelf(input);
    }

    function test_mintSelf_rateLimitAt20() public {
        // 20 mints in the same epoch succeed.
        for (uint8 i = 0; i < 20; i++) {
            AgentSkillRegistry.MintInput memory input = _selfInput(
                1000, claims.HAS_SKILL(),
                keccak256(abi.encodePacked("nonce:rl:", i))
            );
            vm.prank(subject);
            claims.mintSelf(input);
        }

        // 21st in the same epoch reverts.
        AgentSkillRegistry.MintInput memory blocked = _selfInput(
            1000, claims.HAS_SKILL(), keccak256("nonce:rl:21")
        );
        vm.prank(subject);
        vm.expectRevert(AgentSkillRegistry.RateLimited.selector);
        claims.mintSelf(blocked);

        // After EPOCH_SECONDS, the 21st succeeds.
        vm.warp(block.timestamp + 1 days);
        vm.prank(subject);
        claims.mintSelf(blocked);
    }

    function test_mintSelf_rejectsCrossIssued() public {
        AgentSkillRegistry.MintInput memory input = _selfInput(
            1000, claims.HAS_SKILL(), keccak256("nonce:cross")
        );
        input.issuer = issuer;  // !=  subject
        vm.prank(subject);
        vm.expectRevert(AgentSkillRegistry.NotAuthorized.selector);
        claims.mintSelf(input);
    }

    function test_selfMintsRemainingDecrements() public {
        assertEq(claims.selfMintsRemaining(subject), 20);
        AgentSkillRegistry.MintInput memory input = _selfInput(
            1000, claims.HAS_SKILL(), keccak256("nonce:dec")
        );
        vm.prank(subject);
        claims.mintSelf(input);
        assertEq(claims.selfMintsRemaining(subject), 19);
    }

    // ─── Cross-issued mint ──────────────────────────────────────────

    function _crossInput(uint16 score, bytes32 relation, bytes32 nonce)
        internal view returns (AgentSkillRegistry.MintInput memory)
    {
        AgentSkillRegistry.MintInput memory input = _selfInput(score, relation, nonce);
        input.issuer = issuer;
        return input;
    }

    function _signEndorsement(AgentSkillRegistry.MintInput memory input)
        internal view returns (bytes memory)
    {
        bytes32 typehash = claims.ENDORSEMENT_TYPEHASH();
        bytes32 structHash = keccak256(abi.encode(
            typehash,
            input.subjectAgent,
            input.skillId,
            input.skillVersion,
            input.relation,
            input.proficiencyScore,
            input.validAfter,
            input.validUntil,
            input.nonce
        ));
        bytes32 domainSep = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes("AgentSkillRegistry")),
            keccak256(bytes("1")),
            block.chainid,
            address(claims)
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(issuerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_mintWithEndorsement_validSigAccepted() public {
        AgentSkillRegistry.MintInput memory input = _crossInput(
            8500, claims.CERTIFIED_IN(), keccak256("nonce:e1")
        );
        bytes memory sig = _signEndorsement(input);

        // Anyone can submit; in practice it's the subject.
        vm.prank(subject);
        bytes32 claimId = claims.mintWithEndorsement(input, sig);

        AgentSkillRegistry.SkillClaim memory c = claims.getClaim(claimId);
        assertEq(c.issuer, issuer);
        assertEq(c.proficiencyScore, 8500);  // cross-issued can exceed 6000
        assertEq(c.relation, claims.CERTIFIED_IN());
    }

    function test_mintWithEndorsement_wrongKeyRejected() public {
        AgentSkillRegistry.MintInput memory input = _crossInput(
            8500, claims.CERTIFIED_IN(), keccak256("nonce:e2")
        );
        bytes memory sig = _signEndorsement(input);
        // Tamper: pretend the signature came from a different issuer.
        input.issuer = makeAddr("not-the-real-issuer");
        vm.prank(subject);
        vm.expectRevert(AgentSkillRegistry.InvalidEndorsement.selector);
        claims.mintWithEndorsement(input, sig);
    }

    function test_mintWithEndorsement_tamperedScoreRejected() public {
        AgentSkillRegistry.MintInput memory input = _crossInput(
            8500, claims.CERTIFIED_IN(), keccak256("nonce:e3")
        );
        bytes memory sig = _signEndorsement(input);
        // Tamper: bump the score after signing.
        input.proficiencyScore = 10000;
        vm.prank(subject);
        vm.expectRevert(AgentSkillRegistry.InvalidEndorsement.selector);
        claims.mintWithEndorsement(input, sig);
    }

    function test_mintWithEndorsement_rejectsSelfIssuance() public {
        AgentSkillRegistry.MintInput memory input = _selfInput(
            5000, claims.PRACTICES_SKILL(), keccak256("nonce:e4")
        );
        bytes memory sig = _signEndorsement(input);
        vm.prank(subject);
        vm.expectRevert(AgentSkillRegistry.NotAuthorized.selector);
        claims.mintWithEndorsement(input, sig);
    }

    // ─── Revocation ─────────────────────────────────────────────────

    function test_revokePerClaim() public {
        AgentSkillRegistry.MintInput memory input = _selfInput(
            5000, claims.PRACTICES_SKILL(), keccak256("nonce:rev1")
        );
        vm.prank(subject);
        bytes32 claimId = claims.mintSelf(input);
        assertTrue(claims.isFresh(claimId));

        vm.prank(subject);
        claims.revoke(claimId);
        assertFalse(claims.isFresh(claimId));
    }

    function test_bumpRevocationEpoch_invalidatesDownstream() public {
        // Cross-issued claim — issuer can later bulk-invalidate.
        AgentSkillRegistry.MintInput memory input = _crossInput(
            7000, claims.CERTIFIED_IN(), keccak256("nonce:rev2")
        );
        bytes memory sig = _signEndorsement(input);
        vm.prank(subject);
        bytes32 claimId = claims.mintWithEndorsement(input, sig);
        assertTrue(claims.isFresh(claimId));

        // Issuer bumps its own epoch for `subject`.
        vm.prank(issuer);
        claims.bumpRevocationEpoch(subject);
        assertFalse(claims.isFresh(claimId));
    }

    // ─── claimsByIssuer index ───────────────────────────────────────

    function test_claimsByIssuer_indexesEveryMint() public {
        // Direct mint: issuer == subject.
        AgentSkillRegistry.MintInput memory direct = _selfInput(
            1000, claims.HAS_SKILL(), keccak256("nonce:idx1")
        );
        vm.prank(subject);
        bytes32 cidDirect = claims.mintSelf(direct);

        // Cross-issued mint.
        AgentSkillRegistry.MintInput memory cross = _crossInput(
            7000, claims.CERTIFIED_IN(), keccak256("nonce:idx2")
        );
        bytes memory sig = _signEndorsement(cross);
        vm.prank(subject);
        bytes32 cidCross = claims.mintWithEndorsement(cross, sig);

        bytes32[] memory bySubject = claims.claimsByIssuer(subject);
        bytes32[] memory byIssuer  = claims.claimsByIssuer(issuer);
        assertEq(bySubject.length, 1);
        assertEq(bySubject[0], cidDirect);
        assertEq(byIssuer.length, 1);
        assertEq(byIssuer[0], cidCross);
    }

    // ─── Skill version pin ──────────────────────────────────────────

    function test_mint_failsForUnknownSkillVersion() public {
        AgentSkillRegistry.MintInput memory input = _selfInput(
            1000, claims.HAS_SKILL(), keccak256("nonce:pin")
        );
        input.skillVersion = 99;  // never published
        vm.prank(subject);
        vm.expectRevert();  // SkillDefinitionRegistry.SkillNotFound
        claims.mintSelf(input);
    }
}
