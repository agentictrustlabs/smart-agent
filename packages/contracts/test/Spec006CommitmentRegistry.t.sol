// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";

import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "../src/OntologyTermRegistry.sol";
import "../src/ShapeRegistry.sol";
import "../src/CommitmentRegistry.sol";
import "../src/mocks/MockUSDC.sol";

import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";
import "./helpers/MockGovernance.sol";

/// @notice Spec 006 unit suite — covers the CommitmentRegistry surface:
///   - U-CR-C-* : commit happy paths, validation, ReleasesBlocked.
///   - U-CR-R-* : recordRelease + status transitions.
///   - U-CR-O-* : recordOutcome.
///   - U-CR-X-* : cancelCommitment + setRecipient + setDonor.
contract Spec006CommitmentRegistryTest is Test {
    EntryPoint           entryPoint;
    AgentAccountFactory  factory;
    OntologyTermRegistry ontology;
    ShapeRegistry        shapes;
    CommitmentRegistry   commitReg;
    MockUSDC             usdc;

    // Donor's AgentAccount — test contract is the owner.
    address              donor;
    // Recipient's AgentAccount — also test contract owned (irrelevant for
    // recipient auth, but lets us read balances cleanly).
    address              recipient;
    // Non-owner stranger for negative tests.
    address constant     stranger = address(0xBEEF);

    // Commitment fixture.
    bytes32              commitmentSubj;
    bytes32 constant     SOURCE_SUBJ = keccak256("test:source:proposal:1");
    bytes32 constant     ROUND_SUBJ  = keccak256("test:round:1");
    uint256 constant     TOTAL       = 30_000 * 1e6; // 30k USDC

    // Test-only event signature for vm.expectEmit.
    event Completed(bytes32 indexed commitmentSubject, uint256 totalReleased);
    event Released(
        bytes32 indexed commitmentSubject,
        bytes32 indexed milestoneId,
        address indexed recipient,
        uint256 amount,
        uint256 totalReleased
    );

    function setUp() public {
        entryPoint = new EntryPoint();
        ontology   = new OntologyTermRegistry(address(this));
        shapes     = new ShapeRegistry(address(this));
        commitReg  = new CommitmentRegistry(address(ontology), address(shapes));

        factory   = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this), address(this), address(new MockGovernance(address(this))));
        donor     = address(factory.createAccount(address(this), 1));
        recipient = address(factory.createAccount(address(this), 2));

        usdc = new MockUSDC();

        _registerPredicates();

        // Empty SHACL shape so validateSubject is a no-op (mirrors the
        // pattern used by Spec005PledgeHonor.t.sol). Real shapes land via
        // the runtime seed-spec004-ontology.ts equivalent.
        ShapeRegistry.PropertyConstraint[] memory empty;
        shapes.defineShape(
            commitReg.CLASS_COMMITMENT(),
            empty,
            "uri",
            keccak256("Commitment.test")
        );

        // Seed a baseline commitment (grant lane, recipient resolved).
        CommitmentRegistry.CommitParams memory p = _grantLaneParams(recipient);
        commitReg.commit(p);
        commitmentSubj = commitReg.commitmentSubject(commitReg.SOURCE_AWARD(), SOURCE_SUBJ, donor);
    }

    // ════════════════════════════════════════════════════════════════
    // U-CR-C-* — commit
    // ════════════════════════════════════════════════════════════════

    /// U-CR-C-1 — Happy path: commit emits, status = Pending, fields stored.
    function test_UCRC1_commit_storesAllFields() public view {
        (
            bytes32 sk, bytes32 ss, address d, address r, address t,
            uint256 total, uint256 released, bytes32 status
        ) = commitReg.getCommitment(commitmentSubj);
        assertEq(sk, commitReg.SOURCE_AWARD());
        assertEq(ss, SOURCE_SUBJ);
        assertEq(d, donor);
        assertEq(r, recipient);
        assertEq(t, address(usdc));
        assertEq(total, TOTAL);
        assertEq(released, 0);
        assertEq(status, commitReg.STATUS_PENDING());
    }

    /// U-CR-C-2 — Zero recipient lands as ReleasesBlocked, donor still set.
    function test_UCRC2_commit_zeroRecipient_blocksReleases() public {
        // Use a fresh source subject so subject key is unique vs setUp.
        CommitmentRegistry.CommitParams memory p = _grantLaneParams(address(0));
        p.sourceSubject = keccak256("test:source:proposal:2");
        commitReg.commit(p);
        bytes32 subj = commitReg.commitmentSubject(commitReg.SOURCE_AWARD(), p.sourceSubject, donor);
        (, , , address r, , , , bytes32 status) = commitReg.getCommitment(subj);
        assertEq(r, address(0));
        assertEq(status, commitReg.STATUS_RELEASES_BLOCKED());
    }

    /// U-CR-C-3 — Unknown source kind reverts.
    function test_UCRC3_commit_unknownSourceKind_reverts() public {
        CommitmentRegistry.CommitParams memory p = _grantLaneParams(recipient);
        p.sourceKind = keccak256("sa:CommitmentSourceMystery");
        p.sourceSubject = keccak256("test:source:other");
        vm.expectRevert(CommitmentRegistry.InvalidSourceKind.selector);
        commitReg.commit(p);
    }

    /// U-CR-C-4 — Zero amount reverts.
    function test_UCRC4_commit_zeroAmount_reverts() public {
        CommitmentRegistry.CommitParams memory p = _grantLaneParams(recipient);
        p.sourceSubject = keccak256("test:source:zero");
        p.totalAmount = 0;
        vm.expectRevert(CommitmentRegistry.ZeroAmount.selector);
        commitReg.commit(p);
    }

    /// U-CR-C-5 — Empty needIntentId reverts (every lane must preserve the link).
    function test_UCRC5_commit_emptyNeedIntent_reverts() public {
        CommitmentRegistry.CommitParams memory p = _grantLaneParams(recipient);
        p.sourceSubject = keccak256("test:source:nointent");
        p.needIntentId = "";
        vm.expectRevert(CommitmentRegistry.MissingNeedIntent.selector);
        commitReg.commit(p);
    }

    /// U-CR-C-6 — Caller not owning donor reverts NotDonorOwner.
    function test_UCRC6_commit_notDonorOwner_reverts() public {
        CommitmentRegistry.CommitParams memory p = _grantLaneParams(recipient);
        p.sourceSubject = keccak256("test:source:stranger");
        vm.prank(stranger);
        vm.expectRevert(CommitmentRegistry.NotDonorOwner.selector);
        commitReg.commit(p);
    }

    /// U-CR-C-7 — Direct-lane source kind also accepted.
    function test_UCRC7_commit_directLane_succeeds() public {
        CommitmentRegistry.CommitParams memory p = _grantLaneParams(recipient);
        p.sourceKind = commitReg.SOURCE_DIRECT();
        p.sourceSubject = keccak256("test:source:matchInitiation:1");
        p.round = bytes32(0);
        commitReg.commit(p);
        bytes32 subj = commitReg.commitmentSubject(p.sourceKind, p.sourceSubject, donor);
        (bytes32 sk, , , , , , , bytes32 status) = commitReg.getCommitment(subj);
        assertEq(sk, commitReg.SOURCE_DIRECT());
        assertEq(status, commitReg.STATUS_PENDING());
    }

    // ════════════════════════════════════════════════════════════════
    // U-CR-R-* — recordRelease
    // ════════════════════════════════════════════════════════════════

    /// U-CR-R-1 — recordRelease from donor increments releasedAmount + flips
    ///            status from Pending → InFlight when partial.
    function test_UCRR1_recordRelease_partial_setsInFlight() public {
        vm.prank(donor);
        commitReg.recordRelease(commitmentSubj, keccak256("milestone:1"), 12_000 * 1e6);
        (, , , , , , uint256 released, bytes32 status) = commitReg.getCommitment(commitmentSubj);
        assertEq(released, 12_000 * 1e6);
        assertEq(status, commitReg.STATUS_IN_FLIGHT());
    }

    /// U-CR-R-2 — Two releases summing to total flip status → Completed.
    function test_UCRR2_recordRelease_fullDisbursal_completes() public {
        vm.prank(donor);
        commitReg.recordRelease(commitmentSubj, keccak256("milestone:1"), 12_000 * 1e6);
        vm.prank(donor);
        vm.expectEmit(true, false, false, true, address(commitReg));
        emit Completed(commitmentSubj, TOTAL);
        commitReg.recordRelease(commitmentSubj, keccak256("milestone:2"), 18_000 * 1e6);
        (, , , , , , uint256 released, bytes32 status) = commitReg.getCommitment(commitmentSubj);
        assertEq(released, TOTAL);
        assertEq(status, commitReg.STATUS_COMPLETED());
    }

    /// U-CR-R-3 — Same milestone released twice reverts.
    function test_UCRR3_recordRelease_doubleMilestone_reverts() public {
        bytes32 m1 = keccak256("milestone:1");
        vm.prank(donor);
        commitReg.recordRelease(commitmentSubj, m1, 5_000 * 1e6);
        vm.prank(donor);
        vm.expectRevert(CommitmentRegistry.MilestoneAlreadyReleased.selector);
        commitReg.recordRelease(commitmentSubj, m1, 1_000 * 1e6);
    }

    /// U-CR-R-4 — Non-donor caller reverts NotDonor.
    function test_UCRR4_recordRelease_nonDonor_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(CommitmentRegistry.NotDonor.selector);
        commitReg.recordRelease(commitmentSubj, keccak256("milestone:1"), 1_000 * 1e6);
    }

    /// U-CR-R-5 — Release > remaining capacity reverts.
    function test_UCRR5_recordRelease_exceedsTotal_reverts() public {
        vm.prank(donor);
        vm.expectRevert(CommitmentRegistry.ReleaseExceedsTotal.selector);
        commitReg.recordRelease(commitmentSubj, keccak256("milestone:1"), TOTAL + 1);
    }

    /// U-CR-R-6 — recordRelease emits per-milestone Released event.
    function test_UCRR6_recordRelease_emitsReleased() public {
        bytes32 m1 = keccak256("milestone:1");
        vm.prank(donor);
        vm.expectEmit(true, true, true, true, address(commitReg));
        emit Released(commitmentSubj, m1, recipient, 7_500 * 1e6, 7_500 * 1e6);
        commitReg.recordRelease(commitmentSubj, m1, 7_500 * 1e6);
    }

    /// U-CR-R-7 — recordRelease on a canceled commitment reverts.
    function test_UCRR7_recordRelease_afterCancel_reverts() public {
        commitReg.cancelCommitment(commitmentSubj, keccak256("reason:test"));
        vm.prank(donor);
        vm.expectRevert(CommitmentRegistry.CommitmentNotActive.selector);
        commitReg.recordRelease(commitmentSubj, keccak256("milestone:1"), 100);
    }

    /// U-CR-R-8 — Milestone view helper returns the release record.
    function test_UCRR8_milestoneView_returnsRecord() public {
        bytes32 m1 = keccak256("milestone:1");
        vm.prank(donor);
        commitReg.recordRelease(commitmentSubj, m1, 4_000 * 1e6);
        (uint256 amt, uint256 ts) = commitReg.getMilestoneRelease(commitmentSubj, m1);
        assertEq(amt, 4_000 * 1e6);
        assertGt(ts, 0);
    }

    // ════════════════════════════════════════════════════════════════
    // U-CR-O-* — recordOutcome
    // ════════════════════════════════════════════════════════════════

    /// U-CR-O-1 — recordOutcome from any caller stores attestation.
    function test_UCRO1_recordOutcome_permissionless() public {
        bytes32 outcome = keccak256("outcome:trauma-sessions-delivered");
        bytes32 evidence = keccak256("evidence:doc-v1");
        vm.prank(stranger); // permissionless on chain — cred check off-chain.
        commitReg.recordOutcome(commitmentSubj, outcome, evidence);
        (bytes32 h, uint256 ts, address by) = commitReg.getOutcome(commitmentSubj, outcome);
        assertEq(h, evidence);
        assertGt(ts, 0);
        assertEq(by, stranger);
    }

    /// U-CR-O-2 — recordOutcome on unknown commitment reverts.
    function test_UCRO2_recordOutcome_unknownCommitment_reverts() public {
        vm.expectRevert(CommitmentRegistry.CommitmentNotFound.selector);
        commitReg.recordOutcome(
            keccak256("does:not:exist"),
            keccak256("outcome:x"),
            keccak256("evidence:x")
        );
    }

    // ════════════════════════════════════════════════════════════════
    // U-CR-X-* — cancelCommitment / setRecipient / setDonor
    // ════════════════════════════════════════════════════════════════

    /// U-CR-X-1 — Cancel by donor owner flips status, sets reason.
    function test_UCRX1_cancel_byDonorOwner_succeeds() public {
        bytes32 reason = keccak256("reason:proposer-withdrew");
        commitReg.cancelCommitment(commitmentSubj, reason);
        (, , , , , , , bytes32 status) = commitReg.getCommitment(commitmentSubj);
        assertEq(status, commitReg.STATUS_CANCELED());
        assertEq(commitReg.getBytes32(commitmentSubj, commitReg.SA_COMMITMENT_CANCEL_REASON()), reason);
    }

    /// U-CR-X-2 — Cancel by stranger reverts NotDonorOwner.
    function test_UCRX2_cancel_byStranger_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(CommitmentRegistry.NotDonorOwner.selector);
        commitReg.cancelCommitment(commitmentSubj, keccak256("reason:x"));
    }

    /// U-CR-X-3 — Cancel after Completed reverts.
    function test_UCRX3_cancel_afterCompleted_reverts() public {
        vm.prank(donor);
        commitReg.recordRelease(commitmentSubj, keccak256("milestone:1"), TOTAL);
        vm.expectRevert(CommitmentRegistry.CommitmentNotActive.selector);
        commitReg.cancelCommitment(commitmentSubj, keccak256("reason:x"));
    }

    /// U-CR-X-4 — setRecipient unblocks a ReleasesBlocked commitment.
    function test_UCRX4_setRecipient_unblocks() public {
        CommitmentRegistry.CommitParams memory p = _grantLaneParams(address(0));
        p.sourceSubject = keccak256("test:source:blockable");
        commitReg.commit(p);
        bytes32 subj = commitReg.commitmentSubject(p.sourceKind, p.sourceSubject, donor);
        commitReg.setRecipient(subj, recipient);
        (, , , address r, , , , bytes32 status) = commitReg.getCommitment(subj);
        assertEq(r, recipient);
        assertEq(status, commitReg.STATUS_PENDING());
    }

    /// U-CR-X-5 — setRecipient by stranger reverts NotDonorOwner.
    function test_UCRX5_setRecipient_byStranger_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(CommitmentRegistry.NotDonorOwner.selector);
        commitReg.setRecipient(commitmentSubj, address(0xDEAD));
    }

    /// U-CR-X-6 — setDonor reassigns donor address.
    function test_UCRX6_setDonor_reassigns() public {
        address newDonor = address(factory.createAccount(address(this), 9));
        commitReg.setDonor(commitmentSubj, newDonor);
        assertEq(commitReg.getAddress(commitmentSubj, commitReg.SA_COMMITMENT_DONOR()), newDonor);
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    function _grantLaneParams(address rcpt)
        internal
        view
        returns (CommitmentRegistry.CommitParams memory p)
    {
        p = CommitmentRegistry.CommitParams({
            sourceKind:     commitReg.SOURCE_AWARD(),
            sourceSubject:  SOURCE_SUBJ,
            round:          ROUND_SUBJ,
            donor:          donor,
            recipient:      rcpt,
            token:          address(usdc),
            totalAmount:    TOTAL,
            needIntentId:   "urn:smart-agent:need-intent:trauma-care-q3",
            offerIntentId:  "urn:smart-agent:offer-intent:pool-trauma-care",
            milestonesJson: "[{\"id\":\"m1\",\"trancheBps\":4000},{\"id\":\"m2\",\"trancheBps\":6000}]"
        });
    }

    function _registerPredicate(bytes32 id, string memory curie, string memory dt) internal {
        ontology.registerTerm(id, curie, string.concat("https://example/", curie), curie, dt);
    }

    function _registerPredicates() internal {
        _registerPredicate(commitReg.SA_COMMITMENT_SOURCE_KIND(),    "sa:commitmentSourceKind",    "bytes32");
        _registerPredicate(commitReg.SA_COMMITMENT_SOURCE_SUBJECT(), "sa:commitmentSourceSubject", "bytes32");
        _registerPredicate(commitReg.SA_COMMITMENT_ROUND(),          "sa:commitmentRound",         "bytes32");
        _registerPredicate(commitReg.SA_COMMITMENT_NEED_INTENT(),    "sa:commitmentNeedIntent",    "string");
        _registerPredicate(commitReg.SA_COMMITMENT_OFFER_INTENT(),   "sa:commitmentOfferIntent",   "string");
        _registerPredicate(commitReg.SA_COMMITMENT_DONOR(),          "sa:commitmentDonor",         "address");
        _registerPredicate(commitReg.SA_COMMITMENT_RECIPIENT(),      "sa:commitmentRecipient",     "address");
        _registerPredicate(commitReg.SA_COMMITMENT_TOKEN(),          "sa:commitmentToken",         "address");
        _registerPredicate(commitReg.SA_COMMITMENT_TOTAL_AMOUNT(),   "sa:commitmentTotalAmount",   "uint256");
        _registerPredicate(commitReg.SA_COMMITMENT_MILESTONES_JSON(), "sa:commitmentMilestonesJson", "string");
        _registerPredicate(commitReg.SA_COMMITMENT_RELEASED_AMOUNT(), "sa:commitmentReleasedAmount", "uint256");
        _registerPredicate(commitReg.SA_COMMITMENT_STATUS(),         "sa:commitmentStatus",        "bytes32");
        _registerPredicate(commitReg.SA_COMMITMENT_COMMITTED_AT(),   "sa:commitmentCommittedAt",   "uint256");
        _registerPredicate(commitReg.SA_COMMITMENT_UPDATED_AT(),     "sa:commitmentUpdatedAt",     "uint256");
        _registerPredicate(commitReg.SA_COMMITMENT_CANCEL_REASON(),  "sa:commitmentCancelReason",  "bytes32");
        _registerPredicate(commitReg.SA_MILESTONE_RELEASED(),        "sa:milestoneReleased",       "uint256");
        _registerPredicate(commitReg.SA_MILESTONE_RELEASED_AT(),     "sa:milestoneReleasedAt",     "uint256");
        _registerPredicate(commitReg.SA_OUTCOME_EVIDENCE_HASH(),     "sa:outcomeEvidenceHash",     "bytes32");
        _registerPredicate(commitReg.SA_OUTCOME_RECORDED_AT(),       "sa:outcomeRecordedAt",       "uint256");
        _registerPredicate(commitReg.SA_OUTCOME_RECORDED_BY(),       "sa:outcomeRecordedBy",       "address");
    }
}
