// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/ClassAssertion.sol";

contract ClassAssertionTest is Test {
    ClassAssertion public ca;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    bytes32 classMatchInit = keccak256("sa:MatchInitiationAssertion");
    bytes32 classRoundOpen = keccak256("sa:RoundOpenedAssertion");
    bytes32 subjectA = keccak256("urn:demo:artifact-A");
    bytes32 subjectB = keccak256("urn:demo:artifact-B");

    function setUp() public {
        ca = new ClassAssertion();
    }

    function testAssertClass_emitsAndStores() public {
        vm.prank(alice);
        uint256 id = ca.assertClass(classMatchInit, subjectA, 0, 0, "data:application/json,{}");

        assertEq(id, 0);
        assertEq(ca.assertionCount(), 1);

        ClassAssertion.AssertionRecord memory rec = ca.getAssertion(id);
        assertEq(rec.classId, classMatchInit);
        assertEq(rec.subjectId, subjectA);
        assertEq(rec.asserter, alice);
        assertFalse(rec.revoked);
        assertEq(rec.validFrom, block.timestamp);
        assertEq(rec.validUntil, 0);

        // Indexed by class, subject, asserter
        uint256[] memory byClass = ca.getAssertionsByClass(classMatchInit);
        assertEq(byClass.length, 1);
        uint256[] memory bySubject = ca.getAssertionsBySubject(subjectA);
        assertEq(bySubject.length, 1);
        uint256[] memory byAsserter = ca.getAssertionsByAsserter(alice);
        assertEq(byAsserter.length, 1);
    }

    function testAssertClass_rejectsZeroClassId() public {
        vm.expectRevert(ClassAssertion.InvalidAssertion.selector);
        ca.assertClass(bytes32(0), subjectA, 0, 0, "");
    }

    function testAssertClass_rejectsZeroSubjectId() public {
        vm.expectRevert(ClassAssertion.InvalidAssertion.selector);
        ca.assertClass(classMatchInit, bytes32(0), 0, 0, "");
    }

    function testAssertClass_rejectsInvertedTimeWindow() public {
        vm.expectRevert(ClassAssertion.InvalidAssertion.selector);
        ca.assertClass(classMatchInit, subjectA, 100, 50, "");
    }

    function testRevoke_byAsserter() public {
        vm.prank(alice);
        uint256 id = ca.assertClass(classMatchInit, subjectA, 0, 0, "");

        vm.prank(alice);
        ca.revokeAssertion(id);

        ClassAssertion.AssertionRecord memory rec = ca.getAssertion(id);
        assertTrue(rec.revoked);
        assertFalse(ca.isAssertionCurrentlyValid(id));
    }

    function testRevoke_rejectsNonAsserter() public {
        vm.prank(alice);
        uint256 id = ca.assertClass(classMatchInit, subjectA, 0, 0, "");

        vm.prank(bob);
        vm.expectRevert(ClassAssertion.NotAuthorized.selector);
        ca.revokeAssertion(id);
    }

    function testRevoke_rejectsDoubleRevoke() public {
        vm.prank(alice);
        uint256 id = ca.assertClass(classMatchInit, subjectA, 0, 0, "");
        vm.prank(alice);
        ca.revokeAssertion(id);

        vm.prank(alice);
        vm.expectRevert(ClassAssertion.AlreadyRevoked.selector);
        ca.revokeAssertion(id);
    }

    function testIsAssertionCurrentlyValid_respectsTimeWindow() public {
        uint256 future = block.timestamp + 1000;
        vm.prank(alice);
        uint256 id = ca.assertClass(classMatchInit, subjectA, future, 0, "");

        // Not yet valid
        assertFalse(ca.isAssertionCurrentlyValid(id));

        vm.warp(future + 1);
        assertTrue(ca.isAssertionCurrentlyValid(id));
    }

    function testMultipleAssertions_perSubject() public {
        vm.prank(alice);
        ca.assertClass(classMatchInit, subjectA, 0, 0, "");
        vm.prank(bob);
        ca.assertClass(classRoundOpen, subjectA, 0, 0, "");

        uint256[] memory bySubject = ca.getAssertionsBySubject(subjectA);
        assertEq(bySubject.length, 2);
    }

    function testGetAssertion_revertsForUnknownId() public {
        vm.expectRevert(ClassAssertion.AssertionNotFound.selector);
        ca.getAssertion(42);
    }
}
