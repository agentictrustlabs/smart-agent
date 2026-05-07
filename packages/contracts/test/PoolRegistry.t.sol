// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/AgentAccountFactory.sol";
import "../src/OntologyTermRegistry.sol";
import "../src/ShapeRegistry.sol";
import "../src/PoolRegistry.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

contract PoolRegistryTest is Test {
    EntryPoint entryPoint;
    AgentAccountFactory factory;
    OntologyTermRegistry ontology;
    ShapeRegistry shapes;
    PoolRegistry pools;

    address poolOwner;
    address steward1;
    address steward2;
    address outsider;
    address poolAgent;

    bytes32 enumGov;
    bytes32 enumCeiling;
    bytes32 enumVis;

    bytes32 constant GOV_GIVING_CIRCLE = keccak256("sa:GovGivingCircle");
    bytes32 constant GOV_FUND          = keccak256("sa:GovFund");
    bytes32 constant CEILING_BLOCK     = keccak256("sa:CeilingBlock");
    bytes32 constant CEILING_ACCEPT    = keccak256("sa:CeilingAccept");
    bytes32 constant VIS_PUBLIC        = keccak256("sa:VisibilityPublic");
    bytes32 constant DOMAIN_FAITH      = keccak256("sa:DomainFaithNetwork");
    bytes32 constant KIND_GIVING       = keccak256("sa:GivingKind");
    bytes32 constant KIND_PRAYER       = keccak256("sa:PrayerKind");

    function setUp() public {
        poolOwner = makeAddr("poolOwner");
        steward1 = makeAddr("steward1");
        steward2 = makeAddr("steward2");
        outsider = makeAddr("outsider");

        entryPoint = new EntryPoint();
        ontology = new OntologyTermRegistry(address(this));
        shapes = new ShapeRegistry(address(this));
        pools = new PoolRegistry(address(ontology), address(shapes));

        factory = new AgentAccountFactory(IEntryPoint(address(entryPoint)), address(0), address(this));
        poolAgent = address(factory.createAccount(poolOwner, 1));

        _registerTerm(pools.SA_POOL_DOMAIN(), "sa:poolDomain", "bytes32");
        _registerTerm(pools.SA_POOL_GOVERNANCE_MODEL(), "sa:poolGovernanceModel", "bytes32");
        _registerTerm(pools.SA_POOL_MANDATE_HASH(), "sa:poolMandateHash", "bytes32");
        _registerTerm(pools.SA_POOL_MANDATE_URI(), "sa:poolMandateURI", "string");
        _registerTerm(pools.SA_POOL_ACCEPTED_UNITS(), "sa:poolAcceptedUnits", "bytes32[]");
        _registerTerm(pools.SA_POOL_ACCEPTED_KINDS(), "sa:poolAcceptedKinds", "bytes32[]");
        _registerTerm(pools.SA_POOL_CEILING_POLICY(), "sa:poolCeilingPolicy", "bytes32");
        _registerTerm(pools.SA_POOL_CAPACITY_CEILING(), "sa:poolCapacityCeiling", "uint256");
        _registerTerm(pools.SA_POOL_STEWARDS(), "sa:poolStewards", "address[]");
        _registerTerm(pools.SA_POOL_VISIBILITY(), "sa:poolVisibility", "bytes32");
        _registerTerm(pools.SA_POOL_OPENED_AT(), "sa:poolOpenedAt", "uint256");
        _registerTerm(pools.SA_POOL_CLOSED_AT(), "sa:poolClosedAt", "uint256");

        enumGov = keccak256(abi.encodePacked(pools.CLASS_POOL(), pools.SA_POOL_GOVERNANCE_MODEL()));
        bytes32[] memory govValues = new bytes32[](2);
        govValues[0] = GOV_GIVING_CIRCLE;
        govValues[1] = GOV_FUND;
        shapes.defineEnumSet(enumGov, govValues);

        enumCeiling = keccak256(abi.encodePacked(pools.CLASS_POOL(), pools.SA_POOL_CEILING_POLICY()));
        bytes32[] memory ceilingValues = new bytes32[](2);
        ceilingValues[0] = CEILING_BLOCK;
        ceilingValues[1] = CEILING_ACCEPT;
        shapes.defineEnumSet(enumCeiling, ceilingValues);

        enumVis = keccak256(abi.encodePacked(pools.CLASS_POOL(), pools.SA_POOL_VISIBILITY()));
        bytes32[] memory visValues = new bytes32[](1);
        visValues[0] = VIS_PUBLIC;
        shapes.defineEnumSet(enumVis, visValues);

        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](9);
        props[0] = _prop(pools.SA_POOL_DOMAIN(), 5, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[1] = _prop(pools.SA_POOL_GOVERNANCE_MODEL(), 5, ShapeRegistry.Cardinality.REQUIRED_ONE, enumGov);
        props[2] = _prop(pools.SA_POOL_MANDATE_HASH(), 5, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[3] = _prop(pools.SA_POOL_ACCEPTED_KINDS(), 8, ShapeRegistry.Cardinality.REQUIRED_MANY, bytes32(0));
        props[4] = _prop(pools.SA_POOL_CEILING_POLICY(), 5, ShapeRegistry.Cardinality.REQUIRED_ONE, enumCeiling);
        props[5] = _prop(pools.SA_POOL_STEWARDS(), 7, ShapeRegistry.Cardinality.REQUIRED_MANY, bytes32(0));
        props[6] = _prop(pools.SA_POOL_VISIBILITY(), 5, ShapeRegistry.Cardinality.REQUIRED_ONE, enumVis);
        props[7] = _prop(pools.SA_POOL_OPENED_AT(), 4, ShapeRegistry.Cardinality.REQUIRED_ONE, bytes32(0));
        props[8] = _prop(pools.SA_POOL_CAPACITY_CEILING(), 4, ShapeRegistry.Cardinality.OPTIONAL, bytes32(0));
        shapes.defineShape(pools.CLASS_POOL(), props, "uri", keccak256("v1"));
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

    function _validParams() internal view returns (PoolRegistry.OpenParams memory p) {
        bytes32[] memory units;
        bytes32[] memory kinds = new bytes32[](2);
        kinds[0] = KIND_GIVING;
        kinds[1] = KIND_PRAYER;
        address[] memory stewards = new address[](2);
        stewards[0] = steward1;
        stewards[1] = steward2;

        p = PoolRegistry.OpenParams({
            poolAgent: poolAgent,
            domain: DOMAIN_FAITH,
            governanceModel: GOV_GIVING_CIRCLE,
            mandateHash: keccak256("mandate-v1"),
            mandateURI: "ipfs://Qm.../mandate.json",
            acceptedUnits: units,
            acceptedKinds: kinds,
            ceilingPolicy: CEILING_BLOCK,
            capacityCeiling: 5_000e6,
            stewards: stewards,
            visibility: VIS_PUBLIC
        });
    }

    function test_open_with_valid_params() public {
        PoolRegistry.OpenParams memory p = _validParams();
        vm.prank(poolOwner);
        pools.open(p);

        assertTrue(pools.isOpen(poolAgent));
        assertEq(pools.getDomain(poolAgent), DOMAIN_FAITH);
        assertEq(pools.getGovernanceModel(poolAgent), GOV_GIVING_CIRCLE);
        (bytes32 mh, string memory mu) = pools.getMandate(poolAgent);
        assertEq(mh, keccak256("mandate-v1"));
        assertEq(mu, "ipfs://Qm.../mandate.json");
        assertEq(pools.getCapacityCeiling(poolAgent), 5_000e6);
        assertEq(pools.getStewards(poolAgent).length, 2);
    }

    function test_open_emits_PoolOpened() public {
        PoolRegistry.OpenParams memory p = _validParams();
        bytes32 expected = bytes32(uint256(uint160(poolAgent)));
        vm.expectEmit(true, false, false, true);
        emit PoolRegistry.PoolOpened(poolAgent, expected);
        vm.prank(poolOwner);
        pools.open(p);
    }

    function test_open_reverts_if_not_pool_owner() public {
        PoolRegistry.OpenParams memory p = _validParams();
        vm.prank(outsider);
        vm.expectRevert(PoolRegistry.NotPoolOwner.selector);
        pools.open(p);
    }

    function test_open_reverts_with_invalid_governance_enum() public {
        PoolRegistry.OpenParams memory p = _validParams();
        bytes32 fakeGov = keccak256("sa:GovNotInEnum");
        p.governanceModel = fakeGov;
        vm.prank(poolOwner);
        vm.expectRevert(abi.encodeWithSelector(
            ShapeRegistry.EnumValueNotAllowed.selector, pools.SA_POOL_GOVERNANCE_MODEL(), fakeGov
        ));
        pools.open(p);
    }

    function test_open_reverts_with_invalid_ceiling_enum() public {
        PoolRegistry.OpenParams memory p = _validParams();
        bytes32 fakeCeiling = keccak256("sa:CeilingFake");
        p.ceilingPolicy = fakeCeiling;
        vm.prank(poolOwner);
        vm.expectRevert(abi.encodeWithSelector(
            ShapeRegistry.EnumValueNotAllowed.selector, pools.SA_POOL_CEILING_POLICY(), fakeCeiling
        ));
        pools.open(p);
    }

    function test_close_sets_closedAt_and_isOpen_false() public {
        PoolRegistry.OpenParams memory p = _validParams();
        vm.prank(poolOwner);
        pools.open(p);

        vm.warp(block.timestamp + 1 days);
        vm.prank(poolOwner);
        pools.close(poolAgent);
        assertGt(pools.getClosedAt(poolAgent), 0);
        assertFalse(pools.isOpen(poolAgent));
    }

    function test_close_reverts_if_not_pool_owner() public {
        PoolRegistry.OpenParams memory p = _validParams();
        vm.prank(poolOwner);
        pools.open(p);
        vm.prank(outsider);
        vm.expectRevert(PoolRegistry.NotPoolOwner.selector);
        pools.close(poolAgent);
    }

    function test_updateMandate_replaces_hash_and_uri() public {
        PoolRegistry.OpenParams memory p = _validParams();
        vm.prank(poolOwner);
        pools.open(p);
        bytes32 newHash = keccak256("mandate-v2");
        vm.prank(poolOwner);
        pools.updateMandate(poolAgent, newHash, "ipfs://new");
        (bytes32 mh, string memory mu) = pools.getMandate(poolAgent);
        assertEq(mh, newHash);
        assertEq(mu, "ipfs://new");
    }

    function test_updateMandate_skips_uri_when_empty() public {
        PoolRegistry.OpenParams memory p = _validParams();
        vm.prank(poolOwner);
        pools.open(p);
        bytes32 newHash = keccak256("mandate-v2");
        vm.prank(poolOwner);
        pools.updateMandate(poolAgent, newHash, "");
        (bytes32 mh, string memory mu) = pools.getMandate(poolAgent);
        assertEq(mh, newHash);
        assertEq(mu, "ipfs://Qm.../mandate.json");
    }

    function test_updateMandate_reverts_if_not_owner() public {
        PoolRegistry.OpenParams memory p = _validParams();
        vm.prank(poolOwner);
        pools.open(p);
        vm.prank(outsider);
        vm.expectRevert(PoolRegistry.NotPoolOwner.selector);
        pools.updateMandate(poolAgent, bytes32("x"), "");
    }

    function test_rotateStewards_replaces_array() public {
        PoolRegistry.OpenParams memory p = _validParams();
        vm.prank(poolOwner);
        pools.open(p);
        address newSteward = makeAddr("newSteward");
        address[] memory rotation = new address[](1);
        rotation[0] = newSteward;
        vm.prank(poolOwner);
        pools.rotateStewards(poolAgent, rotation);
        address[] memory got = pools.getStewards(poolAgent);
        assertEq(got.length, 1);
        assertEq(got[0], newSteward);
    }

    function test_rotateStewards_reverts_if_not_owner() public {
        PoolRegistry.OpenParams memory p = _validParams();
        vm.prank(poolOwner);
        pools.open(p);
        address[] memory empty;
        vm.prank(outsider);
        vm.expectRevert(PoolRegistry.NotPoolOwner.selector);
        pools.rotateStewards(poolAgent, empty);
    }

    function test_open_skips_optional_uri_when_empty() public {
        PoolRegistry.OpenParams memory p = _validParams();
        p.mandateURI = "";
        vm.prank(poolOwner);
        pools.open(p);
        assertFalse(pools.isSet(bytes32(uint256(uint160(poolAgent))), pools.SA_POOL_MANDATE_URI()));
    }

    function test_open_skips_capacity_when_zero() public {
        PoolRegistry.OpenParams memory p = _validParams();
        p.capacityCeiling = 0;
        vm.prank(poolOwner);
        pools.open(p);
        assertFalse(pools.isSet(bytes32(uint256(uint160(poolAgent))), pools.SA_POOL_CAPACITY_CEILING()));
    }
}
