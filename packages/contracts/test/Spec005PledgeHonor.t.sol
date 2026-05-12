// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";

import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "account-abstraction/core/BaseAccount.sol";
import "../src/OntologyTermRegistry.sol";
import "../src/ShapeRegistry.sol";
import "../src/PledgeRegistry.sol";
import "../src/mocks/MockUSDC.sol";

import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

/// @notice Spec 005 unit suite — covers test-plan.md § 1:
///   - U-AA-1..5: AgentAccount.executeBatch
///   - U-PR-H-1..8: PledgeRegistry.recordHonor
///   - U-PR-M-1..6: PledgeRegistry.markPaid
///
/// Mock-USDC-only coverage lives in MockUSDC.t.sol.
contract Spec005PledgeHonorTest is Test {
    // ─── Fixtures ────────────────────────────────────────────────────
    EntryPoint           entryPoint;
    AgentAccountFactory  factory;
    OntologyTermRegistry ontology;
    ShapeRegistry        shapes;
    PledgeRegistry       pledgeReg;
    MockUSDC             usdc;

    // Pool admin = the test contract (initial owner of the pool's AgentAccount).
    address              poolAgent;     // the pool's AgentAccount (fundAgent)
    // Donor's treasury — same AgentAccount pattern. Test contract is owner.
    address              donorTreasury;
    // Non-admin party for negative tests.
    address constant     stranger = address(0xBEEF);

    // Pledge fixture state.
    bytes32              pledgeSubj;
    bytes32 constant     NULLIFIER = keccak256("test:donor:1");
    uint256 constant     SALT      = 7;
    uint256 constant     COMMITTED = 1_000 * 1e6;   // $1,000 USDC (6 decimals)

    // Concept hashes (must match contract constants).
    bytes32 constant CADENCE_ONE_TIME   = keccak256("sa:CadenceOneTime");
    bytes32 constant UNIT_USD           = keccak256("USD");
    bytes32 constant STATUS_ACTIVE      = keccak256("sa:PledgeActive");
    bytes32 constant STATUS_FULLY       = keccak256("sa:PledgeFullyHonored");
    bytes32 constant RAIL_BANK          = keccak256("sa:PaymentRailBank");
    bytes32 constant RAIL_CRYPTO        = keccak256("sa:PaymentRailCrypto");
    bytes32 constant EVIDENCE_HASH      = keccak256("evidence:v1");

    // Pledge predicate curies — keep in sync with PledgeRegistry constants.
    string[] private CURIES;

    function setUp() public {
        // ─── Deploy chain primitives ──────────────────────────────────
        entryPoint = new EntryPoint();
        ontology   = new OntologyTermRegistry(address(this));
        shapes     = new ShapeRegistry(address(this));
        pledgeReg  = new PledgeRegistry(address(ontology), address(shapes));

        // Pool admin agent: owned by this test contract (only matters for
        // markPaid, which remains admin-gated). Donor treasury also owned
        // by this test contract for executeBatch tests.
        factory    = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));
        poolAgent     = address(factory.createAccount(address(this), 1));
        donorTreasury = address(factory.createAccount(address(this), 2));

        usdc = new MockUSDC();

        // ─── Register every predicate the contract writes to ─────────
        _registerCore();
        _registerSpec005();

        // ─── Define an empty sa:Pledge shape (no required props) ─────
        // Mirrors the seed-spec004-ontology.ts pattern: validateSubject
        // becomes a no-op so submit() can land without strict SHACL.
        ShapeRegistry.PropertyConstraint[] memory empty;
        shapes.defineShape(
            pledgeReg.CLASS_PLEDGE(),
            empty,
            "uri",
            keccak256("Pledge.test")
        );

        // ─── Seed a pledge for honor/mark-paid tests ─────────────────
        pledgeSubj = pledgeReg.pledgeSubject(poolAgent, NULLIFIER, SALT);
        PledgeRegistry.SubmitParams memory p = PledgeRegistry.SubmitParams({
            poolAgent:            poolAgent,
            nullifier:            NULLIFIER,
            salt:                 SALT,
            amount:               COMMITTED,
            unit:                 UNIT_USD,
            cadence:              CADENCE_ONE_TIME,
            duration:             0,
            restrictionsJson:     "",
            storyPermissionsJson: ""
        });
        // msg.sender (this test contract) is an owner of poolAgent.
        pledgeReg.submit(p);

        // Pre-fund donor treasury with USDC + ETH so executeBatch tests work.
        usdc.mint(donorTreasury, COMMITTED * 10);
        vm.deal(donorTreasury, 1 ether);
    }

    // ════════════════════════════════════════════════════════════════
    // U-AA-* — AgentAccount.executeBatch
    // ════════════════════════════════════════════════════════════════

    /// U-AA-1 — DelegationManager → executeBatch with 2 calls succeeds.
    function test_UAA1_executeBatch_twoCalls_succeed() public {
        BaseAccount.Call[] memory calls = new BaseAccount.Call[](2);
        // Two USDC transfers from the treasury.
        calls[0] = BaseAccount.Call({
            target: address(usdc),
            value: 0,
            data: abi.encodeWithSelector(IERC20.transfer.selector, address(0xAAAA), 100)
        });
        calls[1] = BaseAccount.Call({
            target: address(usdc),
            value: 0,
            data: abi.encodeWithSelector(IERC20.transfer.selector, address(0xBBBB), 200)
        });
        // Auth: prank as EntryPoint so _requireForExecute() passes.
        vm.prank(address(entryPoint));
        AgentAccount(payable(donorTreasury)).executeBatch(calls);
        assertEq(usdc.balanceOf(address(0xAAAA)), 100);
        assertEq(usdc.balanceOf(address(0xBBBB)), 200);
    }

    /// U-AA-2 — One inner call reverts → entire batch reverts, no partial state.
    function test_UAA2_executeBatch_innerRevert_revertsAll() public {
        BaseAccount.Call[] memory calls = new BaseAccount.Call[](2);
        calls[0] = BaseAccount.Call({
            target: address(usdc),
            value: 0,
            data: abi.encodeWithSelector(IERC20.transfer.selector, address(0xAAAA), 100)
        });
        // Bad call: transfer more than treasury has.
        calls[1] = BaseAccount.Call({
            target: address(usdc),
            value: 0,
            data: abi.encodeWithSelector(IERC20.transfer.selector, address(0xBBBB), type(uint256).max)
        });
        uint256 balBefore = usdc.balanceOf(donorTreasury);
        vm.prank(address(entryPoint));
        vm.expectRevert();
        AgentAccount(payable(donorTreasury)).executeBatch(calls);
        // No partial state: balance unchanged.
        assertEq(usdc.balanceOf(donorTreasury), balBefore);
        assertEq(usdc.balanceOf(address(0xAAAA)), 0);
    }

    /// U-AA-3 — Direct caller (not EntryPoint / self / DM) is blocked.
    function test_UAA3_executeBatch_unauthorized_reverts() public {
        BaseAccount.Call[] memory calls = new BaseAccount.Call[](1);
        calls[0] = BaseAccount.Call({ target: address(usdc), value: 0, data: "" });
        vm.prank(stranger);
        vm.expectRevert();
        AgentAccount(payable(donorTreasury)).executeBatch(calls);
    }

    /// U-AA-4 — Empty batch is a no-op.
    function test_UAA4_executeBatch_empty_isNoop() public {
        BaseAccount.Call[] memory calls = new BaseAccount.Call[](0);
        uint256 balBefore = usdc.balanceOf(donorTreasury);
        vm.prank(address(entryPoint));
        AgentAccount(payable(donorTreasury)).executeBatch(calls);
        assertEq(usdc.balanceOf(donorTreasury), balBefore);
    }

    /// U-AA-5 — 10-element batch with mixed targets all fire.
    function test_UAA5_executeBatch_tenCalls_allFire() public {
        BaseAccount.Call[] memory calls = new BaseAccount.Call[](10);
        for (uint256 i = 0; i < 10; i++) {
            calls[i] = BaseAccount.Call({
                target: address(usdc),
                value: 0,
                data: abi.encodeWithSelector(
                    IERC20.transfer.selector,
                    address(uint160(0x1000 + i)),
                    10 * (i + 1)
                )
            });
        }
        vm.prank(address(entryPoint));
        AgentAccount(payable(donorTreasury)).executeBatch(calls);
        for (uint256 i = 0; i < 10; i++) {
            assertEq(usdc.balanceOf(address(uint160(0x1000 + i))), 10 * (i + 1));
        }
    }

    // ════════════════════════════════════════════════════════════════
    // U-PR-H-* — PledgeRegistry.recordHonor
    // ════════════════════════════════════════════════════════════════

    /// U-PR-H-1 — recordHonor from treasury increments honored.
    function test_UPRH1_recordHonor_fromTreasury_increments() public {
        vm.prank(donorTreasury);
        pledgeReg.recordHonor(pledgeSubj, donorTreasury, address(usdc), 100);
        (uint256 honored, uint256 ext) = pledgeReg.getSettlement(pledgeSubj, address(usdc));
        assertEq(honored, 100);
        assertEq(ext, 0);
    }

    /// U-PR-H-2 — Second call accumulates.
    function test_UPRH2_recordHonor_accumulates() public {
        vm.prank(donorTreasury);
        pledgeReg.recordHonor(pledgeSubj, donorTreasury, address(usdc), 100);
        vm.prank(donorTreasury);
        pledgeReg.recordHonor(pledgeSubj, donorTreasury, address(usdc), 50);
        (uint256 honored,) = pledgeReg.getSettlement(pledgeSubj, address(usdc));
        assertEq(honored, 150);
    }

    /// U-PR-H-3 — recordHonor from non-treasury caller reverts.
    function test_UPRH3_recordHonor_nonTreasury_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(PledgeRegistry.NotDonorTreasury.selector);
        pledgeReg.recordHonor(pledgeSubj, donorTreasury, address(usdc), 100);
    }

    /// U-PR-H-4 — token=0x0 reverts.
    function test_UPRH4_recordHonor_zeroToken_reverts() public {
        vm.prank(donorTreasury);
        vm.expectRevert(PledgeRegistry.InvalidToken.selector);
        pledgeReg.recordHonor(pledgeSubj, donorTreasury, address(0), 100);
    }

    /// U-PR-H-5 — exceeds committed → reverts.
    function test_UPRH5_recordHonor_exceedsCommitted_reverts() public {
        vm.prank(donorTreasury);
        vm.expectRevert(PledgeRegistry.PledgeAmountExceedsCommitted.selector);
        pledgeReg.recordHonor(pledgeSubj, donorTreasury, address(usdc), COMMITTED + 1);
    }

    /// U-PR-H-6 — Exact-committed honor flips status to fully-honored + event.
    function test_UPRH6_recordHonor_fullyHonored_setsStatusAndEmits() public {
        vm.prank(donorTreasury);
        vm.expectEmit(true, true, false, true, address(pledgeReg));
        emit PledgeFullyHonored(pledgeSubj, address(usdc), COMMITTED);
        pledgeReg.recordHonor(pledgeSubj, donorTreasury, address(usdc), COMMITTED);
        bytes32 status = pledgeReg.getBytes32(pledgeSubj, pledgeReg.SA_PLEDGE_STATUS());
        assertEq(status, STATUS_FULLY);
    }

    /// U-PR-H-7 — Honoring a new token appends to the token list.
    function test_UPRH7_recordHonor_newToken_appendsToList() public {
        vm.prank(donorTreasury);
        pledgeReg.recordHonor(pledgeSubj, donorTreasury, address(usdc), 50);
        bytes32[] memory list = pledgeReg.getBytes32Arr(
            pledgeSubj,
            pledgeReg.SA_PLEDGE_HONOR_TOKEN_LIST()
        );
        assertEq(list.length, 1);
        assertEq(list[0], bytes32(uint256(uint160(address(usdc)))));
    }

    /// U-PR-H-8 — Multi-token: each token tracked separately.
    function test_UPRH8_recordHonor_multiToken_independent() public {
        MockUSDC tokenB = new MockUSDC();
        vm.prank(donorTreasury);
        pledgeReg.recordHonor(pledgeSubj, donorTreasury, address(usdc), 100);
        vm.prank(donorTreasury);
        pledgeReg.recordHonor(pledgeSubj, donorTreasury, address(tokenB), 200);
        (uint256 honoredA,) = pledgeReg.getSettlement(pledgeSubj, address(usdc));
        (uint256 honoredB,) = pledgeReg.getSettlement(pledgeSubj, address(tokenB));
        assertEq(honoredA, 100);
        assertEq(honoredB, 200);
        bytes32[] memory list = pledgeReg.getBytes32Arr(
            pledgeSubj,
            pledgeReg.SA_PLEDGE_HONOR_TOKEN_LIST()
        );
        assertEq(list.length, 2);
    }

    // ════════════════════════════════════════════════════════════════
    // U-PR-M-* — PledgeRegistry.markPaid
    // ════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════
    // U-PR-AUTH-* — Permissionless submit / donor-gated amend & stop
    // (replaces the legacy onlyPoolOperator gates on submit/amend/stop)
    // ════════════════════════════════════════════════════════════════

    /// U-PR-AUTH-1 — Any caller can submit a pledge.
    function test_UPRAUTH1_submit_permissionless() public {
        bytes32 nullifier = keccak256("test:donor:stranger");
        PledgeRegistry.SubmitParams memory p = PledgeRegistry.SubmitParams({
            poolAgent:            poolAgent,
            nullifier:            nullifier,
            salt:                 99,
            amount:               100,
            unit:                 UNIT_USD,
            cadence:              CADENCE_ONE_TIME,
            duration:             0,
            restrictionsJson:     "",
            storyPermissionsJson: ""
        });
        vm.prank(stranger);
        pledgeReg.submit(p);
        bytes32 subj = pledgeReg.pledgeSubject(poolAgent, nullifier, 99);
        // Donor identity is captured as msg.sender at submit time.
        assertEq(pledgeReg.getAddress(subj, pledgeReg.SA_PLEDGE_DONOR()), stranger);
    }

    /// U-PR-AUTH-2 — Donor (msg.sender at submit) may amend their pledge.
    function test_UPRAUTH2_amend_byDonor_succeeds() public {
        // Test contract was msg.sender during setUp's submit; it's the donor.
        pledgeReg.amend(pledgeSubj, COMMITTED + 1, 0);
        assertEq(pledgeReg.getUint(pledgeSubj, pledgeReg.SA_PLEDGE_AMOUNT()), COMMITTED + 1);
    }

    /// U-PR-AUTH-3 — Non-donor amend reverts with NotPledgeDonor.
    function test_UPRAUTH3_amend_byStranger_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(PledgeRegistry.NotPledgeDonor.selector);
        pledgeReg.amend(pledgeSubj, COMMITTED + 1, 0);
    }

    /// U-PR-AUTH-4 — Donor may stop their pledge.
    function test_UPRAUTH4_stop_byDonor_succeeds() public {
        pledgeReg.stop(pledgeSubj);
        assertEq(
            pledgeReg.getBytes32(pledgeSubj, pledgeReg.SA_PLEDGE_STATUS()),
            keccak256("sa:PledgeStopped")
        );
    }

    /// U-PR-AUTH-5 — Non-donor stop reverts with NotPledgeDonor.
    function test_UPRAUTH5_stop_byStranger_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(PledgeRegistry.NotPledgeDonor.selector);
        pledgeReg.stop(pledgeSubj);
    }

    /// U-PR-M-1 — Pool admin marks paid with valid evidence hash.
    function test_UPRM1_markPaid_byAdmin_success() public {
        // Test contract is owner of poolAgent → can mark.
        pledgeReg.markPaid(pledgeSubj, address(usdc), 300, RAIL_BANK, EVIDENCE_HASH);
        (uint256 honored, uint256 ext) = pledgeReg.getSettlement(pledgeSubj, address(usdc));
        assertEq(honored, 0);
        assertEq(ext, 300);
    }

    /// U-PR-M-2 — Non-admin caller reverts with NotPoolOperator.
    function test_UPRM2_markPaid_nonAdmin_reverts() public {
        vm.prank(stranger);
        vm.expectRevert(PledgeRegistry.NotPoolOperator.selector);
        pledgeReg.markPaid(pledgeSubj, address(usdc), 300, RAIL_BANK, EVIDENCE_HASH);
    }

    /// U-PR-M-3 — Zero evidence hash reverts.
    function test_UPRM3_markPaid_zeroEvidence_reverts() public {
        vm.expectRevert(PledgeRegistry.EvidenceHashRequired.selector);
        pledgeReg.markPaid(pledgeSubj, address(usdc), 300, RAIL_BANK, bytes32(0));
    }

    /// U-PR-M-4 — Total > committed reverts.
    function test_UPRM4_markPaid_exceedsCommitted_reverts() public {
        vm.expectRevert(PledgeRegistry.PledgeAmountExceedsCommitted.selector);
        pledgeReg.markPaid(pledgeSubj, address(usdc), COMMITTED + 1, RAIL_BANK, EVIDENCE_HASH);
    }

    /// U-PR-M-5 — Sets payment rail / evidence / markedBy / markedAt.
    function test_UPRM5_markPaid_storesAttestationMetadata() public {
        uint256 tNow = block.timestamp;
        pledgeReg.markPaid(pledgeSubj, address(usdc), 100, RAIL_BANK, EVIDENCE_HASH);
        assertEq(pledgeReg.getBytes32(pledgeSubj, pledgeReg.SA_PLEDGE_PAYMENT_RAIL()),  RAIL_BANK);
        assertEq(pledgeReg.getBytes32(pledgeSubj, pledgeReg.SA_PLEDGE_EVIDENCE_HASH()), EVIDENCE_HASH);
        assertEq(pledgeReg.getAddress(pledgeSubj, pledgeReg.SA_PLEDGE_MARKED_BY_AGENT()), address(this));
        assertEq(pledgeReg.getUint(pledgeSubj,   pledgeReg.SA_PLEDGE_LAST_MARKED_AT()),  tNow);
    }

    /// U-PR-M-6 — markPaid + recordHonor both contribute to settled total.
    function test_UPRM6_markPaid_plusRecordHonor_summed() public {
        pledgeReg.markPaid(pledgeSubj, address(usdc), 300, RAIL_BANK, EVIDENCE_HASH);
        vm.prank(donorTreasury);
        pledgeReg.recordHonor(pledgeSubj, donorTreasury, address(usdc), 400);
        (uint256 honored, uint256 ext) = pledgeReg.getSettlement(pledgeSubj, address(usdc));
        assertEq(honored, 400);
        assertEq(ext,     300);
        // Bringing the total to committed should flip the status.
        vm.prank(donorTreasury);
        pledgeReg.recordHonor(pledgeSubj, donorTreasury, address(usdc), COMMITTED - 700);
        bytes32 status = pledgeReg.getBytes32(pledgeSubj, pledgeReg.SA_PLEDGE_STATUS());
        assertEq(status, STATUS_FULLY);
    }

    // ─── Internal helpers ────────────────────────────────────────────

    function _registerTerm(bytes32 id, string memory curie, string memory dt) internal {
        ontology.registerTerm(id, curie, string.concat("https://example/", curie), curie, dt);
    }

    function _registerCore() internal {
        _registerTerm(pledgeReg.SA_PLEDGE_POOL(),               "sa:pledgePool", "address");
        _registerTerm(pledgeReg.SA_PLEDGE_NULLIFIER(),          "sa:pledgeNullifier", "bytes32");
        _registerTerm(pledgeReg.SA_PLEDGE_AMOUNT(),             "sa:pledgeAmount", "uint256");
        _registerTerm(pledgeReg.SA_PLEDGE_UNIT(),               "sa:pledgeUnit", "bytes32");
        _registerTerm(pledgeReg.SA_PLEDGE_CADENCE(),            "sa:pledgeCadence", "bytes32");
        _registerTerm(pledgeReg.SA_PLEDGE_DURATION(),           "sa:pledgeDuration", "uint256");
        _registerTerm(pledgeReg.SA_PLEDGE_RESTRICTIONS(),       "sa:pledgeRestrictions", "string");
        _registerTerm(pledgeReg.SA_PLEDGE_STORY_PERMISSIONS(),  "sa:pledgeStoryPermissions", "string");
        _registerTerm(pledgeReg.SA_PLEDGE_PLEDGED_AT(),         "sa:pledgePledgedAt", "uint256");
        _registerTerm(pledgeReg.SA_PLEDGE_STOPPED_AT(),         "sa:pledgeStoppedAt", "uint256");
        _registerTerm(pledgeReg.SA_PLEDGE_STATUS(),             "sa:pledgeStatus", "bytes32");
        _registerTerm(pledgeReg.SA_PLEDGE_DONOR(),              "sa:pledgeDonor", "address");
    }

    function _registerSpec005() internal {
        _registerTerm(pledgeReg.SA_PLEDGE_HONORED_AMOUNT(),          "sa:pledgeHonoredAmount", "uint256");
        _registerTerm(pledgeReg.SA_PLEDGE_EXTERNALLY_PAID_AMOUNT(),  "sa:pledgeExternallyPaidAmount", "uint256");
        _registerTerm(pledgeReg.SA_PLEDGE_HONOR_TOKEN_LIST(),        "sa:pledgeHonorTokenList", "bytes32-array");
        _registerTerm(pledgeReg.SA_PLEDGE_LAST_HONORED_AT(),         "sa:pledgeLastHonoredAt", "uint256");
        _registerTerm(pledgeReg.SA_PLEDGE_LAST_MARKED_AT(),          "sa:pledgeLastMarkedAt", "uint256");
        _registerTerm(pledgeReg.SA_PLEDGE_PAYMENT_RAIL(),            "sa:pledgePaymentRail", "bytes32");
        _registerTerm(pledgeReg.SA_PLEDGE_EVIDENCE_HASH(),           "sa:pledgeEvidenceHash", "bytes32");
        _registerTerm(pledgeReg.SA_PLEDGE_MARKED_BY_AGENT(),         "sa:pledgeMarkedByAgent", "address");
    }

    // Event signature mirrors for expectEmit.
    event PledgeFullyHonored(bytes32 indexed pledgeSubject, address indexed token, uint256 totalSettled);
}

// IERC20 already declared transitively via MockUSDC's OpenZeppelin import.
