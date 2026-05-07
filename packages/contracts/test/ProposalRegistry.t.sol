// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccountFactory.sol";
import "../src/OntologyTermRegistry.sol";
import "../src/OntologyAttributeStore.sol";
import "../src/AttributeAuth.sol";
import "../src/ShapeRegistry.sol";
import "../src/ProposalRegistry.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract ProposalRegistryTest is Test {
    EntryPoint entryPoint;
    AgentAccountFactory factory;
    OntologyTermRegistry ontology;
    OntologyAttributeStore store;
    AttributeAuth attrAuth;
    ShapeRegistry shapes;
    ProposalRegistry proposals;

    address fundOwner;
    address otherFundOwner;
    address proposer;
    address recipient;
    address outsider;
    address awardingFund;
    address otherFund;

    bytes32 enumStatus;

    bytes32 constant STATUS_AWARDED   = keccak256("sa:ProposalAwarded");
    bytes32 constant STATUS_DECLINED  = keccak256("sa:ProposalDeclined");
    bytes32 constant STATUS_RESCINDED = keccak256("sa:ProposalRescinded");
    bytes32 constant STATUS_SUBMITTED = keccak256("sa:ProposalSubmitted"); // intentionally NOT in enum

    bytes32 constant KIND_GIVING = keccak256("sa:GivingKind");
    bytes32 constant ROUND_ID    = keccak256(abi.encodePacked("sa:round:", "round-2025-q1"));

    function setUp() public {
        fundOwner = makeAddr("fundOwner");
        otherFundOwner = makeAddr("otherFundOwner");
        proposer = makeAddr("proposer");
        recipient = makeAddr("recipient");
        outsider = makeAddr("outsider");

        entryPoint = new EntryPoint();
        ontology = new OntologyTermRegistry(address(this));
        attrAuth = new AttributeAuth(address(this));
        store = new OntologyAttributeStore(address(ontology), address(this));
        store.setAuth(address(attrAuth));
        shapes = new ShapeRegistry(address(store), address(this));
        proposals = new ProposalRegistry(address(store), address(shapes));
        attrAuth.setTrustedWriter(address(proposals), true);

        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));
        awardingFund = address(factory.createAccount(fundOwner, 1));
        otherFund = address(factory.createAccount(otherFundOwner, 2));

        _registerTerm(proposals.SA_PROPOSAL_KIND(), "sa:proposalKind", "bytes32");
        _registerTerm(proposals.SA_PROPOSAL_STATUS(), "sa:proposalStatus", "bytes32");
        _registerTerm(proposals.SA_PROPOSAL_BASED_ON_INTENT(), "sa:proposalBasedOnIntentId", "bytes32");
        _registerTerm(proposals.SA_PROPOSAL_ROUND(), "sa:proposalRound", "bytes32");
        _registerTerm(proposals.SA_PROPOSAL_PROPOSER(), "sa:proposalProposer", "address");
        _registerTerm(proposals.SA_PROPOSAL_RECIPIENT(), "sa:proposalRecipient", "address");
        _registerTerm(proposals.SA_PROPOSAL_TOTAL_AWARDED(), "sa:proposalTotalAwarded", "uint256");
        _registerTerm(proposals.SA_PROPOSAL_AWARDED_AT(), "sa:proposalAwardedAt", "uint256");
        _registerTerm(proposals.SA_PROPOSAL_BODY_HASH(), "sa:proposalBodyHash", "bytes32");
        _registerTerm(proposals.SA_PROPOSAL_AWARDING_FUND(), "sa:proposalAwardingFund", "address");

        // Status enum — Submitted intentionally absent
        enumStatus = keccak256(abi.encodePacked(
            proposals.CLASS_PROPOSAL_PUBLIC_FACET(),
            proposals.SA_PROPOSAL_STATUS()
        ));
        bytes32[] memory statusValues = new bytes32[](3);
        statusValues[0] = STATUS_AWARDED;
        statusValues[1] = STATUS_DECLINED;
        statusValues[2] = STATUS_RESCINDED;
        shapes.defineEnumSet(enumStatus, statusValues);

        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](7);
        props[0] = _prop(proposals.SA_PROPOSAL_KIND(), 5, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[1] = _prop(proposals.SA_PROPOSAL_STATUS(), 5, ShapeRegistry.Cardinality.REQUIRED_ONE, enumStatus);
        props[2] = _prop(proposals.SA_PROPOSAL_ROUND(), 5, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[3] = _prop(proposals.SA_PROPOSAL_PROPOSER(), 2, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[4] = _prop(proposals.SA_PROPOSAL_RECIPIENT(), 2, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[5] = _prop(proposals.SA_PROPOSAL_TOTAL_AWARDED(), 4, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[6] = _prop(proposals.SA_PROPOSAL_AWARDING_FUND(), 2, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        shapes.defineShape(proposals.CLASS_PROPOSAL_PUBLIC_FACET(), props, "uri", keccak256("v1"));
    }

    function _registerTerm(bytes32 id, string memory curie, string memory dt) internal {
        ontology.registerTerm(id, curie, string.concat("https://example/", curie), curie, dt);
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

    function _validAwardParams(bytes32 ps) internal view returns (ProposalRegistry.AnnounceParams memory) {
        return ProposalRegistry.AnnounceParams({
            proposalSubject: ps,
            kind: KIND_GIVING,
            basedOnIntentId: keccak256("intent-123"),
            round: ROUND_ID,
            proposer: proposer,
            recipient: recipient,
            totalAwarded: 5_000e6,
            bodyHash: keccak256("body-hash"),
            awardingFund: awardingFund,
            status: STATUS_AWARDED
        });
    }

    // ─── Subject derivation ────────────────────────────────────────

    function test_proposalSubject_is_deterministic() public view {
        bytes32 a = proposals.proposalSubject("prop-1");
        bytes32 b = proposals.proposalSubject("prop-1");
        assertEq(a, b);
        bytes32 c = proposals.proposalSubject("prop-2");
        assertTrue(a != c);
        assertEq(a, keccak256(abi.encodePacked("sa:proposal:", "prop-1")));
    }

    // ─── announceAward ─────────────────────────────────────────────

    function test_announceAward_writes_facets() public {
        bytes32 ps = proposals.proposalSubject("award-1");
        ProposalRegistry.AnnounceParams memory p = _validAwardParams(ps);
        vm.prank(fundOwner);
        proposals.announceAward(p);

        assertEq(proposals.getStatus(ps), STATUS_AWARDED);
        assertEq(proposals.getKind(ps), KIND_GIVING);
        assertEq(proposals.getRound(ps), ROUND_ID);
        assertEq(proposals.getProposer(ps), proposer);
        assertEq(proposals.getRecipient(ps), recipient);
        assertEq(proposals.getTotalAwarded(ps), 5_000e6);
        assertEq(proposals.getAwardingFund(ps), awardingFund);
        assertEq(proposals.getBodyHash(ps), keccak256("body-hash"));
        assertGt(proposals.getAwardedAt(ps), 0);
        assertTrue(proposals.isAnnounced(ps));
    }

    function test_announceAward_emits_event() public {
        bytes32 ps = proposals.proposalSubject("emit-test");
        ProposalRegistry.AnnounceParams memory p = _validAwardParams(ps);
        vm.expectEmit(true, false, false, true);
        emit ProposalRegistry.ProposalAwardAnnounced(ps, ROUND_ID, 5_000e6);
        vm.prank(fundOwner);
        proposals.announceAward(p);
    }

    function test_announceAward_reverts_if_not_fund_owner() public {
        bytes32 ps = proposals.proposalSubject("auth-test");
        ProposalRegistry.AnnounceParams memory p = _validAwardParams(ps);
        vm.prank(outsider);
        vm.expectRevert(ProposalRegistry.NotFundOwner.selector);
        proposals.announceAward(p);
    }

    function test_announceAward_reverts_with_submitted_status() public {
        // PRIVACY INVARIANT: a "Submitted" status MUST NOT be acceptable on
        // chain. The body lives in MCP; only post-decision facets anchor.
        bytes32 ps = proposals.proposalSubject("privacy-test");
        ProposalRegistry.AnnounceParams memory p = _validAwardParams(ps);
        p.status = STATUS_SUBMITTED;

        vm.prank(fundOwner);
        vm.expectRevert(abi.encodeWithSelector(
            ShapeRegistry.EnumValueNotAllowed.selector,
            proposals.SA_PROPOSAL_STATUS(),
            STATUS_SUBMITTED
        ));
        proposals.announceAward(p);
    }

    function test_announceAward_reverts_when_already_announced() public {
        bytes32 ps = proposals.proposalSubject("dup-test");
        ProposalRegistry.AnnounceParams memory p = _validAwardParams(ps);
        vm.prank(fundOwner);
        proposals.announceAward(p);

        vm.prank(fundOwner);
        vm.expectRevert(ProposalRegistry.ProposalAlreadyAnnounced.selector);
        proposals.announceAward(p);
    }

    function test_announceAward_skips_optional_intent_when_zero() public {
        bytes32 ps = proposals.proposalSubject("no-intent");
        ProposalRegistry.AnnounceParams memory p = _validAwardParams(ps);
        p.basedOnIntentId = bytes32(0);

        vm.prank(fundOwner);
        proposals.announceAward(p);

        assertEq(proposals.getBasedOnIntentId(ps), bytes32(0));
        assertFalse(store.isSet(ps, proposals.SA_PROPOSAL_BASED_ON_INTENT()));
    }

    function test_announceAward_skips_optional_bodyHash_when_zero() public {
        bytes32 ps = proposals.proposalSubject("no-body");
        ProposalRegistry.AnnounceParams memory p = _validAwardParams(ps);
        p.bodyHash = bytes32(0);

        vm.prank(fundOwner);
        proposals.announceAward(p);

        assertFalse(store.isSet(ps, proposals.SA_PROPOSAL_BODY_HASH()));
    }

    // ─── setStatus ─────────────────────────────────────────────────

    function test_setStatus_to_rescinded() public {
        bytes32 ps = proposals.proposalSubject("rescind-test");
        ProposalRegistry.AnnounceParams memory p = _validAwardParams(ps);
        vm.prank(fundOwner);
        proposals.announceAward(p);

        vm.prank(fundOwner);
        proposals.setStatus(ps, STATUS_RESCINDED);
        assertEq(proposals.getStatus(ps), STATUS_RESCINDED);
    }

    function test_setStatus_emits_event() public {
        bytes32 ps = proposals.proposalSubject("status-emit");
        ProposalRegistry.AnnounceParams memory p = _validAwardParams(ps);
        vm.prank(fundOwner);
        proposals.announceAward(p);

        vm.expectEmit(true, false, false, true);
        emit ProposalRegistry.ProposalStatusChanged(ps, STATUS_DECLINED);
        vm.prank(fundOwner);
        proposals.setStatus(ps, STATUS_DECLINED);
    }

    function test_setStatus_reverts_with_submitted() public {
        bytes32 ps = proposals.proposalSubject("status-privacy");
        ProposalRegistry.AnnounceParams memory p = _validAwardParams(ps);
        vm.prank(fundOwner);
        proposals.announceAward(p);

        vm.prank(fundOwner);
        vm.expectRevert(abi.encodeWithSelector(
            ShapeRegistry.EnumValueNotAllowed.selector,
            proposals.SA_PROPOSAL_STATUS(),
            STATUS_SUBMITTED
        ));
        proposals.setStatus(ps, STATUS_SUBMITTED);
    }

    function test_setStatus_reverts_for_uninitialized_proposal() public {
        bytes32 ps = proposals.proposalSubject("ghost");
        vm.prank(fundOwner);
        vm.expectRevert(ProposalRegistry.ProposalNotInitialized.selector);
        proposals.setStatus(ps, STATUS_RESCINDED);
    }

    function test_setStatus_reverts_if_not_awarding_fund_owner() public {
        bytes32 ps = proposals.proposalSubject("cross-fund");
        ProposalRegistry.AnnounceParams memory p = _validAwardParams(ps);
        vm.prank(fundOwner);
        proposals.announceAward(p);

        // otherFundOwner owns a different fund — not the awarding fund here
        vm.prank(otherFundOwner);
        vm.expectRevert(ProposalRegistry.NotFundOwner.selector);
        proposals.setStatus(ps, STATUS_RESCINDED);
    }
}
