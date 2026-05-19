// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccount.sol";
import "../src/AgentAccountFactory.sol";
import "../src/governance/Governance.sol";
import "../src/governance/GovernanceManaged.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

/**
 * @title AgentAccountFactory rotate-signers tests — Phase A.5 (K1-Q1)
 * @notice The factory holds bundlerSigner / sessionIssuer as mutable
 *         storage so a governance proposal can rotate either without
 *         per-account migration. Every existing AgentAccount resolves
 *         the role through `factory().bundlerSigner()` so the rotation
 *         propagates automatically.
 */
contract AgentAccountFactoryRotateSignersTest is Test {
    EntryPoint internal entryPoint;
    Governance internal gov;
    AgentAccountFactory internal factory;
    AgentAccount internal account;

    address internal bundler;
    address internal sessionIssuer;
    address internal owner;

    address internal signer; // single signer for 1-of-1 dev governance
    uint256 internal signerKey;

    function setUp() public {
        entryPoint = new EntryPoint();
        bundler = makeAddr("bundler");
        sessionIssuer = makeAddr("sessionIssuer");
        owner = makeAddr("owner");
        (signer, signerKey) = makeAddrAndKey("gov-signer");

        address[] memory signers = new address[](1);
        signers[0] = signer;
        gov = new Governance(signers, 1, 1, 0, true);

        factory = new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(0),
            bundler,
            sessionIssuer,
            address(gov)
        );

        account = factory.createAccount(owner, 0);
    }

    function _executeGovProposal(address target, bytes memory data) internal {
        vm.prank(signer);
        bytes32 id = gov.propose(Governance.ProposalKind.AdminCall, target, data);
        // 1-of-1, 0 timelock: execute immediately.
        gov.execute(id);
    }

    // ─── Positive ────────────────────────────────────────────────────

    function test_governance_can_rotate_bundlerSigner() public {
        address newBundler = makeAddr("newBundler");
        _executeGovProposal(
            address(factory),
            abi.encodeCall(AgentAccountFactory.setBundlerSigner, (newBundler))
        );
        assertEq(factory.bundlerSigner(), newBundler);
    }

    function test_governance_can_rotate_sessionIssuer() public {
        address newIssuer = makeAddr("newIssuer");
        _executeGovProposal(
            address(factory),
            abi.encodeCall(AgentAccountFactory.setSessionIssuer, (newIssuer))
        );
        assertEq(factory.sessionIssuer(), newIssuer);
    }

    function test_rotation_propagates_to_existing_account_views() public {
        // Pre-rotation: account reads the original bundler.
        assertEq(account.bundlerSigner(), bundler);
        assertEq(account.sessionIssuer(), sessionIssuer);

        address newBundler = makeAddr("newBundler");
        address newIssuer = makeAddr("newIssuer");
        _executeGovProposal(
            address(factory),
            abi.encodeCall(AgentAccountFactory.setBundlerSigner, (newBundler))
        );
        _executeGovProposal(
            address(factory),
            abi.encodeCall(AgentAccountFactory.setSessionIssuer, (newIssuer))
        );

        // Existing account's factory-indirect resolution now returns
        // the rotated addresses — NO PER-ACCOUNT MIGRATION REQUIRED.
        assertEq(account.bundlerSigner(), newBundler);
        assertEq(account.sessionIssuer(), newIssuer);
    }

    function test_rotation_emits_change_events() public {
        address newBundler = makeAddr("newBundler");
        // Propose first; the BundlerSignerChanged event fires during
        // execute(), so expectEmit must be set up immediately before
        // execute (the propose call also emits its own events).
        vm.prank(signer);
        bytes32 id = gov.propose(
            Governance.ProposalKind.AdminCall,
            address(factory),
            abi.encodeCall(AgentAccountFactory.setBundlerSigner, (newBundler))
        );
        vm.expectEmit(true, true, false, false, address(factory));
        emit AgentAccountFactory.BundlerSignerChanged(bundler, newBundler);
        gov.execute(id);
    }

    // ─── Negative paths ──────────────────────────────────────────────

    function test_non_governance_cannot_rotate_bundlerSigner() public {
        address random = makeAddr("random");
        vm.prank(random);
        vm.expectRevert(GovernanceManaged.NotGovernance.selector);
        factory.setBundlerSigner(random);
    }

    function test_non_governance_cannot_rotate_sessionIssuer() public {
        address random = makeAddr("random");
        vm.prank(random);
        vm.expectRevert(GovernanceManaged.NotGovernance.selector);
        factory.setSessionIssuer(random);
    }

    function test_signer_cannot_directly_call_setter() public {
        // Even an active governance signer cannot bypass the proposal flow.
        vm.prank(signer);
        vm.expectRevert(GovernanceManaged.NotGovernance.selector);
        factory.setBundlerSigner(makeAddr("attempt"));
    }

    function test_factory_address_stable_post_rotation() public {
        address before = address(factory);
        address newBundler = makeAddr("newBundler");
        _executeGovProposal(
            address(factory),
            abi.encodeCall(AgentAccountFactory.setBundlerSigner, (newBundler))
        );
        assertEq(address(factory), before);
    }

    function test_zero_governance_at_construction_reverts() public {
        vm.expectRevert(GovernanceManaged.ZeroGovernance.selector);
        new AgentAccountFactory(
            IEntryPoint(address(entryPoint)),
            address(0),
            bundler,
            sessionIssuer,
            address(0)
        );
    }
}
