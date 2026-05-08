// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccountFactory.sol";
import "../src/OntologyTermRegistry.sol";
import "../src/ShapeRegistry.sol";
import "../src/FundRegistry.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract FundRegistryTest is Test {
    EntryPoint entryPoint;
    AgentAccountFactory factory;
    OntologyTermRegistry ontology;
    ShapeRegistry shapes;
    FundRegistry funds;

    address fundOwner;
    address otherOwner;
    address outsider;
    address fundAgent;
    address otherFundAgent;

    bytes32 enumStatus;
    bytes32 enumVis;

    bytes32 constant STATUS_OPEN     = keccak256("sa:RoundOpen");
    bytes32 constant STATUS_REVIEW   = keccak256("sa:RoundReview");
    bytes32 constant STATUS_DECIDED  = keccak256("sa:RoundDecided");
    bytes32 constant STATUS_CANCELED = keccak256("sa:RoundCanceled");
    bytes32 constant VIS_PUBLIC      = keccak256("sa:VisibilityPublic");
    bytes32 constant VIS_PRIVATE     = keccak256("sa:VisibilityPrivate");
    bytes32 constant CADENCE_QUARTERLY = keccak256("sa:CadenceQuarterly");
    bytes32 constant KIND_GIVING     = keccak256("sa:GivingKind");

    function setUp() public {
        fundOwner = makeAddr("fundOwner");
        otherOwner = makeAddr("otherOwner");
        outsider = makeAddr("outsider");

        entryPoint = new EntryPoint();
        ontology = new OntologyTermRegistry(address(this));
        shapes = new ShapeRegistry(address(this));
        funds = new FundRegistry(address(ontology), address(shapes));

        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));
        fundAgent = address(factory.createAccount(fundOwner, 1));
        otherFundAgent = address(factory.createAccount(otherOwner, 2));

        _registerTerm(funds.SA_FUND_ACCEPTED_KINDS(), "sa:fundAcceptedKinds", "bytes32[]");
        _registerTerm(funds.SA_FUND_OPEN_FOR_CALLS(), "sa:fundOpenForCalls", "bool");
        _registerTerm(funds.SA_ROUND_FUND_AGENT(), "sa:roundFundAgent", "address");
        _registerTerm(funds.SA_ROUND_DEADLINE(), "sa:roundDeadline", "uint256");
        _registerTerm(funds.SA_ROUND_DECISION_DATE(), "sa:roundDecisionDate", "uint256");
        _registerTerm(funds.SA_ROUND_REPORTING_CADENCE(), "sa:roundReportingCadence", "bytes32");
        _registerTerm(funds.SA_ROUND_REQUIRED_CREDENTIALS(), "sa:roundRequiredCredentials", "bytes32[]");
        _registerTerm(funds.SA_ROUND_STATUS(), "sa:roundStatus", "bytes32");
        _registerTerm(funds.SA_ROUND_VISIBILITY(), "sa:roundVisibility", "bytes32");
        _registerTerm(funds.SA_ROUND_AWARDS_ROOT(), "sa:roundAwardsRoot", "bytes32");
        _registerTerm(funds.SA_ROUND_DISPUTE_UNTIL(), "sa:roundDisputeUntil", "uint256");
        _registerTerm(funds.SA_ROUND_OPENED_AT(), "sa:roundOpenedAt", "uint256");
        _registerTerm(funds.SA_ROUND_MANDATE(), "sa:roundMandate", "string");
        _registerTerm(funds.SA_ROUND_MILESTONE_TEMPLATE(), "sa:roundMilestoneTemplate", "string");
        _registerTerm(funds.SA_ROUND_VALIDATOR_REQUIREMENTS(), "sa:roundValidatorRequirements", "string");
        _registerTerm(funds.SA_ROUND_SLUG(), "sa:roundSlug", "string");

        enumStatus = keccak256(abi.encodePacked(funds.CLASS_ROUND(), funds.SA_ROUND_STATUS()));
        bytes32[] memory statusValues = new bytes32[](4);
        statusValues[0] = STATUS_OPEN;
        statusValues[1] = STATUS_REVIEW;
        statusValues[2] = STATUS_DECIDED;
        statusValues[3] = STATUS_CANCELED;
        shapes.defineEnumSet(enumStatus, statusValues);

        enumVis = keccak256(abi.encodePacked(funds.CLASS_ROUND(), funds.SA_ROUND_VISIBILITY()));
        bytes32[] memory visValues = new bytes32[](2);
        visValues[0] = VIS_PUBLIC;
        visValues[1] = VIS_PRIVATE;
        shapes.defineEnumSet(enumVis, visValues);

        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](7);
        props[0] = _prop(funds.SA_ROUND_FUND_AGENT(), 2, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[1] = _prop(funds.SA_ROUND_DEADLINE(), 4, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[2] = _prop(funds.SA_ROUND_DECISION_DATE(), 4, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[3] = _prop(funds.SA_ROUND_REPORTING_CADENCE(), 5, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[4] = _prop(funds.SA_ROUND_STATUS(), 5, ShapeRegistry.Cardinality.REQUIRED_ONE, enumStatus);
        props[5] = _prop(funds.SA_ROUND_VISIBILITY(), 5, ShapeRegistry.Cardinality.REQUIRED_ONE, enumVis);
        props[6] = _prop(funds.SA_ROUND_OPENED_AT(), 4, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        shapes.defineShape(funds.CLASS_ROUND(), props, "uri", keccak256("v1"));
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

    function _validRoundParams(bytes32 roundSubject, address fa) internal view returns (FundRegistry.OpenRoundParams memory) {
        bytes32[] memory creds;
        return FundRegistry.OpenRoundParams({
            roundSubject: roundSubject,
            fundAgent: fa,
            deadline: block.timestamp + 30 days,
            decisionDate: block.timestamp + 45 days,
            reportingCadence: CADENCE_QUARTERLY,
            requiredCredentials: creds,
            visibility: VIS_PUBLIC,
            initialStatus: STATUS_OPEN,
            mandate: "",
            milestoneTemplate: "",
            validatorRequirements: "",
            slug: ""
        });
    }

    function test_registerFund_writes_attributes() public {
        bytes32[] memory kinds = new bytes32[](1);
        kinds[0] = KIND_GIVING;
        vm.prank(fundOwner);
        funds.registerFund(fundAgent, kinds, true);
        assertTrue(funds.isFundOpenForCalls(fundAgent));
        bytes32[] memory got = funds.getFundAcceptedKinds(fundAgent);
        assertEq(got.length, 1);
    }

    function test_registerFund_reverts_if_not_owner() public {
        bytes32[] memory kinds;
        vm.prank(outsider);
        vm.expectRevert(FundRegistry.NotFundOwner.selector);
        funds.registerFund(fundAgent, kinds, true);
    }

    function test_setFundOpenForCalls_toggles() public {
        bytes32[] memory kinds;
        vm.prank(fundOwner);
        funds.registerFund(fundAgent, kinds, true);
        vm.prank(fundOwner);
        funds.setFundOpenForCalls(fundAgent, false);
        assertFalse(funds.isFundOpenForCalls(fundAgent));
    }

    function test_roundSubject_derivation_is_deterministic() public view {
        bytes32 a = funds.roundSubject("round-2025-q1");
        bytes32 b = funds.roundSubject("round-2025-q1");
        assertEq(a, b);
        bytes32 c = funds.roundSubject("round-2025-q2");
        assertTrue(a != c);
    }

    function test_openRound_writes_attributes_and_validates() public {
        bytes32 round = funds.roundSubject("round-1");
        FundRegistry.OpenRoundParams memory p = _validRoundParams(round, fundAgent);
        vm.prank(fundOwner);
        funds.openRound(p);
        assertEq(funds.getRoundFundAgent(round), fundAgent);
        assertEq(funds.getRoundStatus(round), STATUS_OPEN);
        assertGt(funds.getRoundOpenedAt(round), 0);
    }

    function test_openRound_reverts_if_not_fund_owner() public {
        bytes32 round = funds.roundSubject("round-x");
        FundRegistry.OpenRoundParams memory p = _validRoundParams(round, fundAgent);
        vm.prank(outsider);
        vm.expectRevert(FundRegistry.NotFundOwner.selector);
        funds.openRound(p);
    }

    function test_openRound_reverts_with_invalid_status_enum() public {
        bytes32 round = funds.roundSubject("bad-status");
        FundRegistry.OpenRoundParams memory p = _validRoundParams(round, fundAgent);
        bytes32 fakeStatus = keccak256("sa:NotARealStatus");
        p.initialStatus = fakeStatus;
        vm.prank(fundOwner);
        vm.expectRevert(abi.encodeWithSelector(
            ShapeRegistry.EnumValueNotAllowed.selector, funds.SA_ROUND_STATUS(), fakeStatus
        ));
        funds.openRound(p);
    }

    function test_setRoundStatus_changes_status() public {
        bytes32 round = funds.roundSubject("status-test");
        FundRegistry.OpenRoundParams memory p = _validRoundParams(round, fundAgent);
        vm.prank(fundOwner);
        funds.openRound(p);
        vm.prank(fundOwner);
        funds.setRoundStatus(round, STATUS_REVIEW);
        assertEq(funds.getRoundStatus(round), STATUS_REVIEW);
    }

    function test_setRoundStatus_reverts_with_invalid_enum() public {
        bytes32 round = funds.roundSubject("status-test-2");
        FundRegistry.OpenRoundParams memory p = _validRoundParams(round, fundAgent);
        vm.prank(fundOwner);
        funds.openRound(p);
        bytes32 fake = keccak256("sa:Bogus");
        vm.prank(fundOwner);
        vm.expectRevert(abi.encodeWithSelector(
            ShapeRegistry.EnumValueNotAllowed.selector, funds.SA_ROUND_STATUS(), fake
        ));
        funds.setRoundStatus(round, fake);
    }

    function test_setRoundStatus_reverts_for_uninitialized_round() public {
        bytes32 round = funds.roundSubject("never-opened");
        vm.prank(fundOwner);
        vm.expectRevert(FundRegistry.RoundNotInitialized.selector);
        funds.setRoundStatus(round, STATUS_REVIEW);
    }

    function test_setRoundStatus_reverts_if_not_round_fund_owner() public {
        bytes32 round = funds.roundSubject("auth-test");
        FundRegistry.OpenRoundParams memory p = _validRoundParams(round, fundAgent);
        vm.prank(fundOwner);
        funds.openRound(p);
        vm.prank(otherOwner);
        vm.expectRevert(FundRegistry.NotFundOwner.selector);
        funds.setRoundStatus(round, STATUS_REVIEW);
    }

    function test_setRoundAwardsRoot_writes_root_and_dispute_window() public {
        bytes32 round = funds.roundSubject("awards-test");
        FundRegistry.OpenRoundParams memory p = _validRoundParams(round, fundAgent);
        vm.prank(fundOwner);
        funds.openRound(p);
        bytes32 awardsRoot = keccak256("merkle-root-v1");
        uint256 disputeUntil = block.timestamp + 72 hours;
        vm.prank(fundOwner);
        funds.setRoundAwardsRoot(round, awardsRoot, disputeUntil);
        assertEq(funds.getRoundAwardsRoot(round), awardsRoot);
        assertEq(funds.getRoundDisputeUntil(round), disputeUntil);
    }

    function test_setRoundAwardsRoot_reverts_if_not_owner() public {
        bytes32 round = funds.roundSubject("awards-auth");
        FundRegistry.OpenRoundParams memory p = _validRoundParams(round, fundAgent);
        vm.prank(fundOwner);
        funds.openRound(p);
        vm.prank(outsider);
        vm.expectRevert(FundRegistry.NotFundOwner.selector);
        funds.setRoundAwardsRoot(round, bytes32("x"), 0);
    }

    function test_other_fund_owner_cannot_mutate_this_round() public {
        bytes32 round = funds.roundSubject("isolation-test");
        FundRegistry.OpenRoundParams memory p = _validRoundParams(round, fundAgent);
        vm.prank(fundOwner);
        funds.openRound(p);
        vm.prank(otherOwner);
        vm.expectRevert(FundRegistry.NotFundOwner.selector);
        funds.setRoundStatus(round, STATUS_CANCELED);
    }

    function test_openRound_with_body_strings_writes_them() public {
        bytes32 round = funds.roundSubject("body-test");
        FundRegistry.OpenRoundParams memory p = _validRoundParams(round, fundAgent);
        p.mandate = "{\"acceptedKinds\":[\"trauma-care\"]}";
        p.milestoneTemplate = "[{\"label\":\"M1\",\"pct\":50}]";
        p.validatorRequirements = "{\"min\":2}";
        vm.prank(fundOwner);
        funds.openRound(p);
        assertEq(funds.getRoundMandate(round), p.mandate);
        assertEq(funds.getRoundMilestoneTemplate(round), p.milestoneTemplate);
        assertEq(funds.getRoundValidatorRequirements(round), p.validatorRequirements);
    }

    function test_openRound_with_empty_body_strings_skips_storage() public {
        bytes32 round = funds.roundSubject("empty-body-test");
        FundRegistry.OpenRoundParams memory p = _validRoundParams(round, fundAgent);
        vm.prank(fundOwner);
        funds.openRound(p);
        assertEq(funds.getRoundMandate(round), "");
        assertEq(funds.getRoundMilestoneTemplate(round), "");
        assertEq(funds.getRoundValidatorRequirements(round), "");
    }

    function test_setRoundMandate_updates_after_open() public {
        bytes32 round = funds.roundSubject("mandate-update");
        FundRegistry.OpenRoundParams memory p = _validRoundParams(round, fundAgent);
        vm.prank(fundOwner);
        funds.openRound(p);
        vm.prank(fundOwner);
        funds.setRoundMandate(round, "{\"updated\":true}");
        assertEq(funds.getRoundMandate(round), "{\"updated\":true}");
    }

    function test_setRoundMandate_reverts_if_not_owner() public {
        bytes32 round = funds.roundSubject("mandate-auth");
        FundRegistry.OpenRoundParams memory p = _validRoundParams(round, fundAgent);
        vm.prank(fundOwner);
        funds.openRound(p);
        vm.prank(outsider);
        vm.expectRevert(FundRegistry.NotFundOwner.selector);
        funds.setRoundMandate(round, "{}");
    }
}
