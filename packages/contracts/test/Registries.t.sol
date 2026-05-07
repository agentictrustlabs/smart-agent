// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/MandateRegistry.sol";
import "../src/StewardEligibilityRegistry.sol";
import "../src/ApprovedHashRegistry.sol";

contract MandateRegistryTest is Test {
    MandateRegistry internal reg;
    address internal pool = address(0xCAFE);
    address internal random = address(0xBEEF);

    function setUp() public {
        reg = new MandateRegistry();
    }

    function test_pool_can_set_its_own_mandate() public {
        bytes32 k = keccak256("kinds-root");
        bytes32 g = keccak256("geo-root");
        vm.prank(pool);
        reg.setMandate(pool, k, g);
        assertEq(reg.kindsRoot(pool), k);
        assertEq(reg.geoRoot(pool), g);
    }

    function test_random_caller_cannot_set_pool_mandate() public {
        vm.prank(random);
        vm.expectRevert(MandateRegistry.NotPool.selector);
        reg.setMandate(pool, bytes32("x"), bytes32("y"));
    }

    function test_emits_event_on_update() public {
        bytes32 k = keccak256("k");
        bytes32 g = keccak256("g");
        vm.prank(pool);
        vm.expectEmit(true, false, false, true);
        emit MandateRegistry.MandateUpdated(pool, k, g);
        reg.setMandate(pool, k, g);
    }
}

contract StewardEligibilityRegistryTest is Test {
    StewardEligibilityRegistry internal reg;
    address internal pool = address(0xCAFE);
    address internal alice = address(0x1111);
    address internal bob = address(0x2222);
    address internal carol = address(0x3333);
    address internal random = address(0xBEEF);

    function setUp() public {
        reg = new StewardEligibilityRegistry();
    }

    function _addThree() internal {
        vm.startPrank(pool);
        reg.setSteward(pool, alice, true);
        reg.setSteward(pool, bob, true);
        reg.setSteward(pool, carol, true);
        reg.setThreshold(pool, 2);
        vm.stopPrank();
    }

    function test_pool_can_add_stewards() public {
        _addThree();
        assertTrue(reg.isEligible(pool, alice));
        assertTrue(reg.isEligible(pool, bob));
        assertTrue(reg.isEligible(pool, carol));
        assertEq(reg.threshold(pool), 2);
    }

    function test_random_cannot_mutate() public {
        vm.prank(random);
        vm.expectRevert(StewardEligibilityRegistry.NotPool.selector);
        reg.setSteward(pool, alice, true);

        vm.prank(random);
        vm.expectRevert(StewardEligibilityRegistry.NotPool.selector);
        reg.setThreshold(pool, 5);
    }

    function test_remove_steward_flips_eligibility_without_purging() public {
        _addThree();
        vm.prank(pool);
        reg.setSteward(pool, bob, false);
        assertFalse(reg.isEligible(pool, bob));
        (address[] memory active, uint8 t) = reg.getEligibleStewards(pool);
        assertEq(active.length, 2);
        assertEq(t, 2);
        // Order preserved: alice, carol (bob filtered out)
        assertEq(active[0], alice);
        assertEq(active[1], carol);
    }

    function test_re_eligibilizing_existing_steward_does_not_double_push() public {
        _addThree();
        vm.startPrank(pool);
        reg.setSteward(pool, bob, false);
        reg.setSteward(pool, bob, true); // re-enable
        vm.stopPrank();
        (address[] memory active,) = reg.getEligibleStewards(pool);
        assertEq(active.length, 3);
    }
}

contract ApprovedHashRegistryTest is Test {
    ApprovedHashRegistry internal reg;
    address internal alice = address(0x1111);
    address internal bob = address(0x2222);
    bytes32 internal h = keccak256("allocation-decided-payload");

    function setUp() public {
        reg = new ApprovedHashRegistry();
    }

    function test_signer_approves_own_hash() public {
        vm.prank(alice);
        reg.approveHash(h);
        assertTrue(reg.isApproved(alice, h));
        assertFalse(reg.isApproved(bob, h));
    }

    function test_signer_revokes_own_hash() public {
        vm.startPrank(alice);
        reg.approveHash(h);
        reg.revokeHash(h);
        vm.stopPrank();
        assertFalse(reg.isApproved(alice, h));
    }

    function test_one_signer_cannot_revoke_anothers_approval() public {
        vm.prank(alice);
        reg.approveHash(h);
        vm.prank(bob);
        reg.revokeHash(h); // affects bob's slot, not alice's
        assertTrue(reg.isApproved(alice, h));
        assertFalse(reg.isApproved(bob, h));
    }
}
