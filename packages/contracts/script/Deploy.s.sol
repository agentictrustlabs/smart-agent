// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/AgentAccountFactory.sol";
import "../src/SessionAgentAccountFactory.sol";
import "../src/modules/ECDSASessionValidator.sol";
import "../src/modules/SpendCapHookModule.sol";
import "../src/modules/RateLimitHookModule.sol";
import "../src/modules/TargetSelectorAllowlistHookModule.sol";
import "../src/modules/RevocationModule.sol";
import "../src/DelegationManager.sol";
import "../src/enforcers/TimestampEnforcer.sol";
import "../src/enforcers/ValueEnforcer.sol";
import "../src/enforcers/AllowedTargetsEnforcer.sol";
import "../src/enforcers/AllowedMethodsEnforcer.sol";
import "../src/enforcers/CallDataHashEnforcer.sol";
import "../src/enforcers/McpToolScopeEnforcer.sol";
import "../src/enforcers/DataScopeEnforcer.sol";
import "../src/enforcers/RateLimitEnforcer.sol";
import "../src/enforcers/TaskBindingEnforcer.sol";
import "../src/enforcers/RecoveryEnforcer.sol";
import "../src/enforcers/PoolMandateEnforcer.sol";
import "../src/enforcers/RoundDecisionWindowEnforcer.sol";
import "../src/enforcers/AllocationLimitEnforcer.sol";
import "../src/enforcers/StewardEligibilityEnforcer.sol";
import "../src/enforcers/QuorumEnforcer.sol";
import "../src/MandateRegistry.sol";
import "../src/StewardEligibilityRegistry.sol";
import "../src/ApprovedHashRegistry.sol";
import "../src/validators/PasskeyValidator.sol";
import "../src/UniversalSignatureValidator.sol";
import "../src/AgentRelationship.sol";
import "../src/AgentAssertion.sol";
import "../src/ClassAssertion.sol";
import "../src/AgentRelationshipResolver.sol";
import "../src/RelationshipTypeRegistry.sol";
import "../src/AgentRelationshipQuery.sol";
import "../src/AgentRelationshipTemplate.sol";
import "../src/AgentIssuerProfile.sol";
import "../src/AgentValidationProfile.sol";
import "../src/AgentReviewRecord.sol";
import "../src/AgentDisputeRecord.sol";
import "../src/AgentTrustProfile.sol";
import "../src/AgentControl.sol";
import "../src/MockTeeVerifier.sol";
import "../src/OntologyTermRegistry.sol";
import "../src/ShapeRegistry.sol";
import "../src/AgentAccountResolver.sol";
import "../src/AgentUniversalResolver.sol";
import "../src/AgentNameRegistry.sol";
import "../src/AgentNameResolver.sol";
import "../src/AgentNameAttributeResolver.sol";
import "../src/PoolRegistry.sol";
import "../src/FundRegistry.sol";
import "../src/VoteRegistry.sol";
import "../src/GrantProposalRegistry.sol";
import "../src/PledgeRegistry.sol";
import "../src/MatchInitiationRegistry.sol";
import "../src/ProposalRegistry.sol";
import "../src/AgentNameUniversalResolver.sol";
import "../src/enforcers/NameScopeEnforcer.sol";
import "../src/enforcers/MembershipProofEnforcer.sol";
import "../src/CredentialRegistry.sol";
import "../src/DaimoP256Verifier.sol";
import "../src/GeoFeatureRegistry.sol";
import "../src/GeoClaimRegistry.sol";
import "../src/SkillDefinitionRegistry.sol";
import "../src/AgentSkillRegistry.sol";
import "../src/SkillIssuerRegistry.sol";
import "../src/zk/GeoH3InclusionVerifier.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "account-abstraction/core/EntryPoint.sol";

/**
 * @title Deploy
 * @notice Deploys all Agent Smart Account Kit contracts.
 *
 * Usage:
 *   # Local Anvil:
 *   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 *
 *   # Sepolia:
 *   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
 */
contract Deploy is Script {
    // ERC-4337 EntryPoint v0.7 canonical address
    address constant ENTRYPOINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerKey);

        // 1. EntryPoint — use canonical if deployed, otherwise deploy for local testing
        IEntryPoint entryPoint;
        if (ENTRYPOINT_V07.code.length > 0) {
            entryPoint = IEntryPoint(ENTRYPOINT_V07);
            console.log("EntryPoint (existing):", ENTRYPOINT_V07);
        } else {
            EntryPoint ep = new EntryPoint();
            entryPoint = IEntryPoint(address(ep));
            console.log("EntryPoint (deployed):", address(ep));
        }

        // 2. DelegationManager (deployed first so factory can pass it to accounts)
        DelegationManager delegationManager = new DelegationManager();
        console.log("DelegationManager:", address(delegationManager));

        // 3. AgentAccountFactory (deploys implementation singleton, sets DelegationManager + serverSigner)
        AgentAccountFactory factory = new AgentAccountFactory(entryPoint, address(delegationManager), deployer);
        console.log("AgentAccountFactory:", address(factory));
        console.log("  AgentAccount impl:", address(factory.accountImplementation()));

        // 4. Caveat Enforcers
        TimestampEnforcer timestampEnforcer = new TimestampEnforcer();
        console.log("TimestampEnforcer:", address(timestampEnforcer));

        ValueEnforcer valueEnforcer = new ValueEnforcer();
        console.log("ValueEnforcer:", address(valueEnforcer));

        AllowedTargetsEnforcer allowedTargetsEnforcer = new AllowedTargetsEnforcer();
        console.log("AllowedTargetsEnforcer:", address(allowedTargetsEnforcer));

        AllowedMethodsEnforcer allowedMethodsEnforcer = new AllowedMethodsEnforcer();
        console.log("AllowedMethodsEnforcer:", address(allowedMethodsEnforcer));
        DataScopeEnforcer dataScopeEnforcer = new DataScopeEnforcer();
        console.log("DataScopeEnforcer:", address(dataScopeEnforcer));

        // Phase 2 (delegation refactor) — sub-delegated path enforcers.
        // TaskBindingEnforcer records the A2A taskId in the caveat terms;
        // CallDataHashEnforcer locks the redeem to one exact callData hash.
        TaskBindingEnforcer taskBindingEnforcer = new TaskBindingEnforcer();
        console.log("TaskBindingEnforcer:", address(taskBindingEnforcer));

        CallDataHashEnforcer callDataHashEnforcer = new CallDataHashEnforcer();
        console.log("CallDataHashEnforcer:", address(callDataHashEnforcer));

        // MCP tool-scope: on-chain no-op landing pad so DelegationManager
        // can call beforeHook() during redeem without reverting. Real policy
        // (which MCP tool names are allowed) is enforced off-chain by the
        // MCP server's verify-delegation.ts.
        McpToolScopeEnforcer mcpToolScopeEnforcer = new McpToolScopeEnforcer();
        console.log("McpToolScopeEnforcer:", address(mcpToolScopeEnforcer));

        // Phase 3 (delegation refactor) — first-party ERC-7579 modules and the
        // SessionAgentAccountFactory. Used by a2a-agent when a session is
        // bootstrapped with stateful=true.
        ECDSASessionValidator ecdsaSessionValidator = new ECDSASessionValidator();
        console.log("ECDSASessionValidator:", address(ecdsaSessionValidator));
        SpendCapHookModule spendCapHook = new SpendCapHookModule();
        console.log("SpendCapHookModule:", address(spendCapHook));
        RateLimitHookModule rateLimitHook = new RateLimitHookModule();
        console.log("RateLimitHookModule:", address(rateLimitHook));
        TargetSelectorAllowlistHookModule targetSelectorAllowlistHook =
            new TargetSelectorAllowlistHookModule();
        console.log("TargetSelectorAllowlistHookModule:", address(targetSelectorAllowlistHook));
        RevocationModule revocationModule = new RevocationModule();
        console.log("RevocationModule:", address(revocationModule));
        SessionAgentAccountFactory sessionAgentAccountFactory =
            new SessionAgentAccountFactory(factory);
        console.log("SessionAgentAccountFactory:", address(sessionAgentAccountFactory));

        // 4b. Treasury Phase 2 — pool/round/quorum policy primitives.
        // Registries first (they're referenced by enforcers' terms encoding).
        MandateRegistry mandateRegistry = new MandateRegistry();
        console.log("MandateRegistry:", address(mandateRegistry));

        StewardEligibilityRegistry stewardEligibilityRegistry = new StewardEligibilityRegistry();
        console.log("StewardEligibilityRegistry:", address(stewardEligibilityRegistry));

        ApprovedHashRegistry approvedHashRegistry = new ApprovedHashRegistry();
        console.log("ApprovedHashRegistry:", address(approvedHashRegistry));

        PoolMandateEnforcer poolMandateEnforcer = new PoolMandateEnforcer();
        console.log("PoolMandateEnforcer:", address(poolMandateEnforcer));

        RoundDecisionWindowEnforcer roundDecisionWindowEnforcer = new RoundDecisionWindowEnforcer();
        console.log("RoundDecisionWindowEnforcer:", address(roundDecisionWindowEnforcer));

        AllocationLimitEnforcer allocationLimitEnforcer = new AllocationLimitEnforcer();
        console.log("AllocationLimitEnforcer:", address(allocationLimitEnforcer));

        StewardEligibilityEnforcer stewardEligibilityEnforcer = new StewardEligibilityEnforcer();
        console.log("StewardEligibilityEnforcer:", address(stewardEligibilityEnforcer));

        QuorumEnforcer quorumEnforcer = new QuorumEnforcer();
        console.log("QuorumEnforcer:", address(quorumEnforcer));

        // 5. Relationship Protocol (3 contracts)
        AgentRelationship agentRelationship = new AgentRelationship();
        console.log("AgentRelationship:", address(agentRelationship));

        AgentAssertion agentAssertion = new AgentAssertion(address(agentRelationship));
        console.log("AgentAssertion:", address(agentAssertion));

        // ClassAssertion — generic class-tagged assertion log (intent-marketplace +)
        ClassAssertion classAssertion = new ClassAssertion();
        console.log("ClassAssertion:", address(classAssertion));

        AgentRelationshipResolver agentResolver = new AgentRelationshipResolver(
            address(agentRelationship), address(agentAssertion)
        );
        console.log("AgentRelationshipResolver:", address(agentResolver));

        // 5b. Relationship Type Registry (semantic metadata for relationship types)
        RelationshipTypeRegistry typeRegistry = new RelationshipTypeRegistry(deployer);
        console.log("RelationshipTypeRegistry:", address(typeRegistry));

        // 5c. Relationship Query (read-only view contract for directed traversal)
        AgentRelationshipQuery relQuery = new AgentRelationshipQuery(
            address(agentRelationship), address(typeRegistry)
        );
        console.log("AgentRelationshipQuery:", address(relQuery));

        // 6. Template contract
        AgentRelationshipTemplate agentTemplate = new AgentRelationshipTemplate();
        console.log("AgentRelationshipTemplate:", address(agentTemplate));

        // 7. Issuer Profile
        AgentIssuerProfile issuerProfile = new AgentIssuerProfile();
        console.log("AgentIssuerProfile:", address(issuerProfile));

        // 8. Validation Profile
        AgentValidationProfile validationProfile = new AgentValidationProfile();
        console.log("AgentValidationProfile:", address(validationProfile));

        // 9. Review Record
        AgentReviewRecord reviewRecord = new AgentReviewRecord();
        console.log("AgentReviewRecord:", address(reviewRecord));

        // 10. Dispute Record
        AgentDisputeRecord disputeRecord = new AgentDisputeRecord();
        console.log("AgentDisputeRecord:", address(disputeRecord));

        // 11. Trust Profile
        AgentTrustProfile trustProfile = new AgentTrustProfile(
            address(agentRelationship), address(reviewRecord), address(disputeRecord), address(validationProfile)
        );
        console.log("AgentTrustProfile:", address(trustProfile));

        // 12. Agent Control (Governance)
        AgentControl agentControl = new AgentControl();
        console.log("AgentControl:", address(agentControl));

        // 13. Mock TEE Verifier (development only — simulates attestation verification)
        MockTeeVerifier mockTeeVerifier = new MockTeeVerifier();
        console.log("MockTeeVerifier:", address(mockTeeVerifier));

        // 14. Ontology Term Registry (governed predicate definitions)
        OntologyTermRegistry ontologyRegistry = new OntologyTermRegistry(deployer);
        console.log("OntologyTermRegistry:", address(ontologyRegistry));

        // 15a. Shape registry — shared validation surface, decoupled from
        //      any one store. Each registry below owns its own typed
        //      attribute storage via the AttributeStorage abstract base.
        ShapeRegistry shapeRegistry = new ShapeRegistry(deployer);
        console.log("ShapeRegistry:", address(shapeRegistry));

        // 15b. PoolRegistry — owns its pool-attribute storage.
        PoolRegistry poolRegistry = new PoolRegistry(address(ontologyRegistry), address(shapeRegistry));
        console.log("PoolRegistry:", address(poolRegistry));

        // 15c. FundRegistry — owns its fund + round attribute storage.
        FundRegistry fundRegistry = new FundRegistry(address(ontologyRegistry), address(shapeRegistry));
        console.log("FundRegistry:", address(fundRegistry));

        // 15d. ProposalRegistry — public facets only at award time. Body
        //      never anchors here per sa:GrantProposalAlwaysPrivateShape.
        ProposalRegistry proposalRegistry = new ProposalRegistry(address(ontologyRegistry), address(shapeRegistry));
        console.log("ProposalRegistry:", address(proposalRegistry));

        // 15e–15h. Spec 004 — full marketplace state on chain. Each
        //         registry stores nullifier-keyed rows so identity stays
        //         off-chain (AnonCreds presentations gate writes via
        //         org-mcp's verifier; the chain trusts the gateway).
        VoteRegistry voteRegistry = new VoteRegistry(
            address(ontologyRegistry), address(shapeRegistry), address(fundRegistry)
        );
        console.log("VoteRegistry:", address(voteRegistry));
        GrantProposalRegistry grantProposalRegistry = new GrantProposalRegistry(
            address(ontologyRegistry), address(shapeRegistry), address(fundRegistry)
        );
        console.log("GrantProposalRegistry:", address(grantProposalRegistry));
        PledgeRegistry pledgeRegistry = new PledgeRegistry(
            address(ontologyRegistry), address(shapeRegistry)
        );
        console.log("PledgeRegistry:", address(pledgeRegistry));
        MatchInitiationRegistry matchInitiationRegistry = new MatchInitiationRegistry(
            address(ontologyRegistry), address(shapeRegistry)
        );
        console.log("MatchInitiationRegistry:", address(matchInitiationRegistry));

        // 15. AgentAccountResolver — owns its agent metadata storage.
        AgentAccountResolver accountResolver = new AgentAccountResolver(address(ontologyRegistry));
        console.log("AgentAccountResolver:", address(accountResolver));

        // 16. Agent Universal Resolver (read-only aggregation façade)
        AgentUniversalResolver universalResolver = new AgentUniversalResolver(
            address(accountResolver),
            address(agentRelationship),
            address(reviewRecord),
            address(disputeRecord),
            address(validationProfile),
            address(trustProfile)
        );
        console.log("AgentUniversalResolver:", address(universalResolver));

        // 9. Agent Naming System
        AgentNameRegistry nameRegistry = new AgentNameRegistry(agentRelationship);
        console.log("AgentNameRegistry:", address(nameRegistry));

        AgentNameResolver nameResolver = new AgentNameResolver(nameRegistry);
        console.log("AgentNameResolver:", address(nameResolver));

        // Store-backed name resolver — owns its own typed attribute state.
        AgentNameAttributeResolver nameAttributeResolver = new AgentNameAttributeResolver(
            nameRegistry,
            address(ontologyRegistry)
        );
        console.log("AgentNameAttributeResolver:", address(nameAttributeResolver));

        AgentNameUniversalResolver nameUniversalResolver = new AgentNameUniversalResolver(
            nameRegistry, nameResolver, accountResolver
        );
        console.log("AgentNameUniversalResolver:", address(nameUniversalResolver));

        NameScopeEnforcer nameScopeEnforcer = new NameScopeEnforcer();
        console.log("NameScopeEnforcer:", address(nameScopeEnforcer));

        CredentialRegistry credentialRegistry = new CredentialRegistry();
        console.log("CredentialRegistry:", address(credentialRegistry));

        MembershipProofEnforcer membershipProofEnforcer = new MembershipProofEnforcer();
        console.log("MembershipProofEnforcer:", address(membershipProofEnforcer));

        RateLimitEnforcer rateLimitEnforcer = new RateLimitEnforcer();
        console.log("RateLimitEnforcer:", address(rateLimitEnforcer));

        RecoveryEnforcer recoveryEnforcer = new RecoveryEnforcer();
        console.log("RecoveryEnforcer:", address(recoveryEnforcer));

        PasskeyValidator passkeyValidator = new PasskeyValidator();
        console.log("PasskeyValidator:", address(passkeyValidator));

        UniversalSignatureValidator universalSigValidator = new UniversalSignatureValidator();
        console.log("UniversalSignatureValidator:", address(universalSigValidator));

        // Initialize .agent root and set default resolver
        nameRegistry.initializeRoot(deployer, address(nameResolver));

        // ─── Multi-root namespaces (.geo, .pg) ────────────────────────
        // Each TLD root is owned by the deployer for the demo; in
        // production each would have its own steward AgentAccount.
        nameRegistry.initializeRoot("geo", deployer, address(nameResolver), nameRegistry.KIND_GEO());
        nameRegistry.initializeRoot("pg",  deployer, address(nameResolver), nameRegistry.KIND_PEOPLE_GROUP());
        // v1: `.skill` TLD for developer-friendly aliases of canonical skillIds.
        nameRegistry.initializeRoot("skill", deployer, address(nameResolver), nameRegistry.KIND_SKILL());

        // ─── Geo registries ───────────────────────────────────────────
        GeoFeatureRegistry geoFeatures = new GeoFeatureRegistry(nameRegistry);
        console.log("GeoFeatureRegistry:", address(geoFeatures));
        GeoClaimRegistry geoClaims = new GeoClaimRegistry(geoFeatures);
        console.log("GeoClaimRegistry:", address(geoClaims));

        // ─── Skill registries (mirrors geo, with .skill TLD wired) ────
        SkillDefinitionRegistry skillDefs = new SkillDefinitionRegistry(address(nameRegistry));
        console.log("SkillDefinitionRegistry:", address(skillDefs));
        AgentSkillRegistry skillClaims = new AgentSkillRegistry(skillDefs);
        console.log("AgentSkillRegistry:", address(skillClaims));
        SkillIssuerRegistry skillIssuers = new SkillIssuerRegistry(deployer);
        console.log("SkillIssuerRegistry:", address(skillIssuers));

        // ─── ZK verifier for geo H3 inclusion ──────────────────────────
        // snarkjs-generated groth16 verifier; the holder wallet (Phase 6)
        // submits proofs against this contract to prove their private H3
        // cell is included under a feature's h3CoverageRoot without
        // revealing the cell. Renamed from H3Membership* to avoid
        // confusion with org-membership relationships.
        GeoH3InclusionVerifier geoH3Verifier = new GeoH3InclusionVerifier();
        console.log("GeoH3InclusionVerifier:", address(geoH3Verifier));

        // ─── Seed ontology predicates ─────────────────────────────────
        // AgentAccountResolver rejects any setStringProperty / addMulti…
        // call whose predicate isn't registered + active here. The full
        // catalog has to be registered as part of deploy so resolver
        // writes work from block 1. Mirrors the predicates in
        // packages/sdk/src/predicates.ts.
        _seedOntology(ontologyRegistry);
        _seedPoolOntologyAndShape(ontologyRegistry, shapeRegistry, poolRegistry);
        _seedFundOntologyAndShape(ontologyRegistry, shapeRegistry, fundRegistry);
        _seedProposalOntologyAndShape(ontologyRegistry, shapeRegistry, proposalRegistry);

        // ─── P-256 verifier (OpenZeppelin-backed) ─────────────────────
        // AgentAccount's P256Verifier library tries:
        //   (1) RIP-7212 precompile at 0x0000…0100 — not active on anvil 1.5
        //   (2) Daimo verifier at 0xc2b7…54De4 — must be present so
        //       passkey signatures validate via ERC-1271.
        // We deploy a fresh implementation here as a normal broadcast tx,
        // then a runtime hook (apps/web/src/lib/dev-p256-stub.ts) copies
        // its bytecode to the canonical Daimo address via anvil_setCode.
        // (vm.etch doesn't persist past broadcast, so this two-step is
        // the cleanest way to get a real verifier at the address the
        // account contract expects.)
        DaimoP256Verifier verifier = new DaimoP256Verifier();
        console.log("DaimoP256Verifier:", address(verifier));

        vm.stopBroadcast();

        // Print env vars for copy-paste into apps/web/.env
        console.log("");
        console.log("=== Copy to apps/web/.env ===");
        _logEnv("ENTRYPOINT_ADDRESS", address(entryPoint));
        _logEnv("AGENT_FACTORY_ADDRESS", address(factory));
        _logEnv("DELEGATION_MANAGER_ADDRESS", address(delegationManager));
        _logEnv("AGENT_RELATIONSHIP_ADDRESS", address(agentRelationship));
        _logEnv("AGENT_ASSERTION_ADDRESS", address(agentAssertion));
        _logEnv("CLASS_ASSERTION_ADDRESS", address(classAssertion));
        _logEnv("AGENT_RESOLVER_ADDRESS", address(agentResolver));
        _logEnv("TIMESTAMP_ENFORCER_ADDRESS", address(timestampEnforcer));
        _logEnv("VALUE_ENFORCER_ADDRESS", address(valueEnforcer));
        _logEnv("ALLOWED_TARGETS_ENFORCER_ADDRESS", address(allowedTargetsEnforcer));
        _logEnv("ALLOWED_METHODS_ENFORCER_ADDRESS", address(allowedMethodsEnforcer));
        _logEnv("DATA_SCOPE_ENFORCER_ADDRESS", address(dataScopeEnforcer));
        // Phase 2 — sub-delegated path enforcers
        _logEnv("TASK_BINDING_ENFORCER_ADDRESS", address(taskBindingEnforcer));
        _logEnv("CALLDATA_HASH_ENFORCER_ADDRESS", address(callDataHashEnforcer));
        _logEnv("MCP_TOOL_SCOPE_ENFORCER_ADDRESS", address(mcpToolScopeEnforcer));
        // Phase 3 — session-account path: factory + first-party modules
        _logEnv("SESSION_AGENT_ACCOUNT_FACTORY_ADDRESS", address(sessionAgentAccountFactory));
        _logEnv("ECDSA_SESSION_VALIDATOR_ADDRESS", address(ecdsaSessionValidator));
        _logEnv("SPEND_CAP_HOOK_ADDRESS", address(spendCapHook));
        _logEnv("RATE_LIMIT_HOOK_ADDRESS", address(rateLimitHook));
        _logEnv("TARGET_SELECTOR_ALLOWLIST_HOOK_ADDRESS", address(targetSelectorAllowlistHook));
        _logEnv("REVOCATION_MODULE_ADDRESS", address(revocationModule));
        _logEnv("AGENT_TEMPLATE_ADDRESS", address(agentTemplate));
        _logEnv("AGENT_ISSUER_ADDRESS", address(issuerProfile));
        _logEnv("AGENT_VALIDATION_ADDRESS", address(validationProfile));
        _logEnv("AGENT_REVIEW_ADDRESS", address(reviewRecord));
        _logEnv("AGENT_DISPUTE_ADDRESS", address(disputeRecord));
        _logEnv("AGENT_TRUST_PROFILE_ADDRESS", address(trustProfile));
        _logEnv("AGENT_CONTROL_ADDRESS", address(agentControl));
        _logEnv("MOCK_TEE_VERIFIER_ADDRESS", address(mockTeeVerifier));
        _logEnv("ONTOLOGY_REGISTRY_ADDRESS", address(ontologyRegistry));
        _logEnv("AGENT_ACCOUNT_RESOLVER_ADDRESS", address(accountResolver));
        _logEnv("UNIVERSAL_RESOLVER_ADDRESS", address(universalResolver));
        _logEnv("RELATIONSHIP_TYPE_REGISTRY_ADDRESS", address(typeRegistry));
        _logEnv("AGENT_RELATIONSHIP_QUERY_ADDRESS", address(relQuery));
        _logEnv("AGENT_NAME_REGISTRY_ADDRESS", address(nameRegistry));
        _logEnv("AGENT_NAME_RESOLVER_ADDRESS", address(nameResolver));
        _logEnv("AGENT_NAME_ATTRIBUTE_RESOLVER_ADDRESS", address(nameAttributeResolver));
        _logEnv("AGENT_NAME_UNIVERSAL_RESOLVER_ADDRESS", address(nameUniversalResolver));
        _logEnv("NAME_SCOPE_ENFORCER_ADDRESS", address(nameScopeEnforcer));
        _logEnv("CREDENTIAL_REGISTRY_CONTRACT_ADDRESS", address(credentialRegistry));
        _logEnv("MEMBERSHIP_PROOF_ENFORCER_ADDRESS", address(membershipProofEnforcer));
        _logEnv("RATE_LIMIT_ENFORCER_ADDRESS", address(rateLimitEnforcer));
        _logEnv("RECOVERY_ENFORCER_ADDRESS", address(recoveryEnforcer));
        _logEnv("PASSKEY_VALIDATOR_ADDRESS", address(passkeyValidator));
        _logEnv("UNIVERSAL_SIG_VALIDATOR_ADDRESS", address(universalSigValidator));
        _logEnv("P256_VERIFIER_ADDRESS", address(verifier));
        _logEnv("GEO_FEATURE_REGISTRY_ADDRESS", address(geoFeatures));
        _logEnv("GEO_CLAIM_REGISTRY_ADDRESS", address(geoClaims));
        _logEnv("GEO_H3_INCLUSION_VERIFIER_ADDRESS", address(geoH3Verifier));
        _logEnv("SKILL_DEFINITION_REGISTRY_ADDRESS", address(skillDefs));
        _logEnv("AGENT_SKILL_REGISTRY_ADDRESS", address(skillClaims));
        _logEnv("SKILL_ISSUER_REGISTRY_ADDRESS", address(skillIssuers));
        // Treasury Phase 2 — pool/round/quorum policy primitives
        _logEnv("MANDATE_REGISTRY_ADDRESS", address(mandateRegistry));
        _logEnv("STEWARD_ELIGIBILITY_REGISTRY_ADDRESS", address(stewardEligibilityRegistry));
        _logEnv("APPROVED_HASH_REGISTRY_ADDRESS", address(approvedHashRegistry));
        _logEnv("POOL_MANDATE_ENFORCER_ADDRESS", address(poolMandateEnforcer));
        _logEnv("ROUND_DECISION_WINDOW_ENFORCER_ADDRESS", address(roundDecisionWindowEnforcer));
        _logEnv("ALLOCATION_LIMIT_ENFORCER_ADDRESS", address(allocationLimitEnforcer));
        _logEnv("STEWARD_ELIGIBILITY_ENFORCER_ADDRESS", address(stewardEligibilityEnforcer));
        _logEnv("QUORUM_ENFORCER_ADDRESS", address(quorumEnforcer));
        // Per-registry storage foundation
        _logEnv("SHAPE_REGISTRY_ADDRESS", address(shapeRegistry));
        _logEnv("POOL_REGISTRY_ADDRESS", address(poolRegistry));
        _logEnv("FUND_REGISTRY_ADDRESS", address(fundRegistry));
        _logEnv("PROPOSAL_REGISTRY_ADDRESS", address(proposalRegistry));
        _logEnv("VOTE_REGISTRY_ADDRESS", address(voteRegistry));
        _logEnv("GRANT_PROPOSAL_REGISTRY_ADDRESS", address(grantProposalRegistry));
        _logEnv("PLEDGE_REGISTRY_ADDRESS", address(pledgeRegistry));
        _logEnv("MATCH_INITIATION_REGISTRY_ADDRESS", address(matchInitiationRegistry));
    }

    function _logEnv(string memory key, address addr) internal pure {
        console.log(string.concat(key, "=", vm.toString(addr)));
    }

    function _seedPoolOntologyAndShape(OntologyTermRegistry ont, ShapeRegistry shapes, PoolRegistry pool) internal {
        // ─── Pool predicates ────────────────────────────────────────
        string[14] memory curies = [
            "sa:poolDomain",
            "sa:poolGovernanceModel",
            "sa:poolMandateHash",
            "sa:poolMandateURI",
            "sa:poolAcceptedUnits",
            "sa:poolAcceptedKinds",
            "sa:poolCeilingPolicy",
            "sa:poolCapacityCeiling",
            "sa:poolStewards",
            "sa:poolVisibility",
            "sa:poolOpenedAt",
            "sa:poolClosedAt",
            "sa:poolAcceptedRestrictions",
            "sa:poolSlug"
        ];
        string[14] memory dtypes = [
            "bytes32",
            "bytes32",
            "bytes32",
            "string",
            "bytes32[]",
            "bytes32[]",
            "bytes32",
            "uint256",
            "address[]",
            "bytes32",
            "uint256",
            "uint256",
            "string",
            "string"
        ];
        bytes32[] memory ids = new bytes32[](14);
        string[] memory cd = new string[](14);
        string[] memory ud = new string[](14);
        string[] memory ld = new string[](14);
        string[] memory dd = new string[](14);
        for (uint256 i = 0; i < 14; i++) {
            ids[i] = keccak256(bytes(curies[i]));
            cd[i] = curies[i];
            ud[i] = string.concat("https://agentictrust.io/ontology/sa#", curies[i]);
            ld[i] = curies[i];
            dd[i] = dtypes[i];
        }
        ont.registerTermBatch(ids, cd, ud, ld, dd);

        // ─── Enum sets ──────────────────────────────────────────────
        bytes32 enumGov = keccak256(abi.encodePacked(pool.CLASS_POOL(), pool.SA_POOL_GOVERNANCE_MODEL()));
        bytes32[] memory govValues = new bytes32[](4);
        govValues[0] = keccak256("sa:GovDAF");
        govValues[1] = keccak256("sa:GovGivingCircle");
        govValues[2] = keccak256("sa:GovFund");
        govValues[3] = keccak256("sa:GovOpenCall");
        shapes.defineEnumSet(enumGov, govValues);

        bytes32 enumCeiling = keccak256(abi.encodePacked(pool.CLASS_POOL(), pool.SA_POOL_CEILING_POLICY()));
        bytes32[] memory ceilingValues = new bytes32[](3);
        ceilingValues[0] = keccak256("sa:CeilingBlock");
        ceilingValues[1] = keccak256("sa:CeilingWaitlist");
        ceilingValues[2] = keccak256("sa:CeilingAccept");
        shapes.defineEnumSet(enumCeiling, ceilingValues);

        bytes32 enumVis = keccak256(abi.encodePacked(pool.CLASS_POOL(), pool.SA_POOL_VISIBILITY()));
        bytes32[] memory visValues = new bytes32[](2);
        visValues[0] = keccak256("sa:VisibilityPublic");
        visValues[1] = keccak256("sa:VisibilityPrivate");
        shapes.defineEnumSet(enumVis, visValues);

        // ─── sa:Pool shape ──────────────────────────────────────────
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](9);
        props[0] = ShapeRegistry.PropertyConstraint({
            predicate: pool.SA_POOL_DOMAIN(),
            expectedDatatype: 5, // DT_BYTES32
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[1] = ShapeRegistry.PropertyConstraint({
            predicate: pool.SA_POOL_GOVERNANCE_MODEL(),
            expectedDatatype: 5,
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: enumGov,
            expectedClass: bytes32(0)
        });
        props[2] = ShapeRegistry.PropertyConstraint({
            predicate: pool.SA_POOL_MANDATE_HASH(),
            expectedDatatype: 5,
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[3] = ShapeRegistry.PropertyConstraint({
            predicate: pool.SA_POOL_ACCEPTED_KINDS(),
            expectedDatatype: 8, // DT_BYTES32_ARR
            cardinality: ShapeRegistry.Cardinality.REQUIRED_MANY,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[4] = ShapeRegistry.PropertyConstraint({
            predicate: pool.SA_POOL_CEILING_POLICY(),
            expectedDatatype: 5,
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: enumCeiling,
            expectedClass: bytes32(0)
        });
        props[5] = ShapeRegistry.PropertyConstraint({
            predicate: pool.SA_POOL_STEWARDS(),
            expectedDatatype: 7, // DT_ADDRESS_ARR
            cardinality: ShapeRegistry.Cardinality.REQUIRED_MANY,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[6] = ShapeRegistry.PropertyConstraint({
            predicate: pool.SA_POOL_VISIBILITY(),
            expectedDatatype: 5,
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: enumVis,
            expectedClass: bytes32(0)
        });
        props[7] = ShapeRegistry.PropertyConstraint({
            predicate: pool.SA_POOL_OPENED_AT(),
            expectedDatatype: 4, // DT_UINT256
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[8] = ShapeRegistry.PropertyConstraint({
            predicate: pool.SA_POOL_CAPACITY_CEILING(),
            expectedDatatype: 4,
            cardinality: ShapeRegistry.Cardinality.OPTIONAL,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        shapes.defineShape(
            pool.CLASS_POOL(),
            props,
            "https://agentictrust.io/ontology/tbox/shacl/pool-shapes.ttl#PoolShape",
            keccak256("PoolShape.v1")
        );
    }

    function _seedFundOntologyAndShape(OntologyTermRegistry ont, ShapeRegistry shapes, FundRegistry fund) internal {
        // ─── Fund + Round predicates ────────────────────────────────
        string[16] memory curies = [
            "sa:fundAcceptedKinds",
            "sa:fundOpenForCalls",
            "sa:roundFundAgent",
            "sa:roundDeadline",
            "sa:roundDecisionDate",
            "sa:roundReportingCadence",
            "sa:roundRequiredCredentials",
            "sa:roundStatus",
            "sa:roundVisibility",
            "sa:roundAwardsRoot",
            "sa:roundDisputeUntil",
            "sa:roundMandate",
            "sa:roundMilestoneTemplate",
            "sa:roundValidatorRequirements",
            "sa:roundSlug",
            "sa:roundPoolAgent"
        ];
        string[16] memory dtypes = [
            "bytes32[]",
            "bool",
            "address",
            "uint256",
            "uint256",
            "bytes32",
            "bytes32[]",
            "bytes32",
            "bytes32",
            "bytes32",
            "uint256",
            "string",
            "string",
            "string",
            "string",
            "address"
        ];
        bytes32[] memory ids = new bytes32[](17);
        string[] memory cd = new string[](17);
        string[] memory ud = new string[](17);
        string[] memory ld = new string[](17);
        string[] memory dd = new string[](17);
        for (uint256 i = 0; i < 16; i++) {
            ids[i] = keccak256(bytes(curies[i]));
            cd[i] = curies[i];
            ud[i] = string.concat("https://agentictrust.io/ontology/sa#", curies[i]);
            ld[i] = curies[i];
            dd[i] = dtypes[i];
        }
        // sa:roundOpenedAt — written by openRound; required uint256
        ids[16] = keccak256("sa:roundOpenedAt");
        cd[16] = "sa:roundOpenedAt";
        ud[16] = "https://agentictrust.io/ontology/sa#roundOpenedAt";
        ld[16] = "sa:roundOpenedAt";
        dd[16] = "uint256";
        ont.registerTermBatch(ids, cd, ud, ld, dd);

        // ─── Round status enum ──────────────────────────────────────
        bytes32 enumStatus = keccak256(abi.encodePacked(fund.CLASS_ROUND(), fund.SA_ROUND_STATUS()));
        bytes32[] memory statusValues = new bytes32[](5);
        statusValues[0] = keccak256("sa:RoundOpen");
        statusValues[1] = keccak256("sa:RoundReview");
        statusValues[2] = keccak256("sa:RoundDecided");
        statusValues[3] = keccak256("sa:RoundClosed");
        statusValues[4] = keccak256("sa:RoundCanceled");
        shapes.defineEnumSet(enumStatus, statusValues);

        // ─── Round visibility enum ──────────────────────────────────
        bytes32 enumVis = keccak256(abi.encodePacked(fund.CLASS_ROUND(), fund.SA_ROUND_VISIBILITY()));
        bytes32[] memory visValues = new bytes32[](2);
        visValues[0] = keccak256("sa:VisibilityPublic");
        visValues[1] = keccak256("sa:VisibilityPrivate");
        shapes.defineEnumSet(enumVis, visValues);

        // ─── sa:Round shape ─────────────────────────────────────────
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](7);
        props[0] = ShapeRegistry.PropertyConstraint({
            predicate: fund.SA_ROUND_FUND_AGENT(),
            expectedDatatype: 2, // DT_ADDRESS
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[1] = ShapeRegistry.PropertyConstraint({
            predicate: fund.SA_ROUND_DEADLINE(),
            expectedDatatype: 4, // DT_UINT256
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[2] = ShapeRegistry.PropertyConstraint({
            predicate: fund.SA_ROUND_DECISION_DATE(),
            expectedDatatype: 4,
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[3] = ShapeRegistry.PropertyConstraint({
            predicate: fund.SA_ROUND_REPORTING_CADENCE(),
            expectedDatatype: 5, // DT_BYTES32
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[4] = ShapeRegistry.PropertyConstraint({
            predicate: fund.SA_ROUND_STATUS(),
            expectedDatatype: 5,
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: enumStatus,
            expectedClass: bytes32(0)
        });
        props[5] = ShapeRegistry.PropertyConstraint({
            predicate: fund.SA_ROUND_VISIBILITY(),
            expectedDatatype: 5,
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: enumVis,
            expectedClass: bytes32(0)
        });
        props[6] = ShapeRegistry.PropertyConstraint({
            predicate: fund.SA_ROUND_OPENED_AT(),
            expectedDatatype: 4,
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        shapes.defineShape(
            fund.CLASS_ROUND(),
            props,
            "https://agentictrust.io/ontology/tbox/shacl/round-shapes.ttl#RoundShape",
            keccak256("RoundShape.v1")
        );
    }

    function _seedProposalOntologyAndShape(OntologyTermRegistry ont, ShapeRegistry shapes, ProposalRegistry proposal) internal {
        // ─── Proposal predicates (PUBLIC FACETS ONLY) ────────────────
        string[10] memory curies = [
            "sa:proposalKind",
            "sa:proposalStatus",
            "sa:proposalBasedOnIntentId",
            "sa:proposalRound",
            "sa:proposalProposer",
            "sa:proposalRecipient",
            "sa:proposalTotalAwarded",
            "sa:proposalAwardedAt",
            "sa:proposalBodyHash",
            "sa:proposalAwardingFund"
        ];
        string[10] memory dtypes = [
            "bytes32",
            "bytes32",
            "bytes32",
            "bytes32",
            "address",
            "address",
            "uint256",
            "uint256",
            "bytes32",
            "address"
        ];
        bytes32[] memory ids = new bytes32[](10);
        string[] memory cd = new string[](10);
        string[] memory ud = new string[](10);
        string[] memory ld = new string[](10);
        string[] memory dd = new string[](10);
        for (uint256 i = 0; i < 10; i++) {
            ids[i] = keccak256(bytes(curies[i]));
            cd[i] = curies[i];
            ud[i] = string.concat("https://agentictrust.io/ontology/sa#", curies[i]);
            ld[i] = curies[i];
            dd[i] = dtypes[i];
        }
        ont.registerTermBatch(ids, cd, ud, ld, dd);

        // ─── Proposal status enum ───────────────────────────────────
        // ProposalSubmitted is INTENTIONALLY ABSENT — submitted proposals
        // never anchor. Body lives in MCP per sa:GrantProposalAlwaysPrivateShape.
        bytes32 enumStatus = keccak256(abi.encodePacked(
            proposal.CLASS_PROPOSAL_PUBLIC_FACET(),
            proposal.SA_PROPOSAL_STATUS()
        ));
        bytes32[] memory statusValues = new bytes32[](3);
        statusValues[0] = keccak256("sa:ProposalAwarded");
        statusValues[1] = keccak256("sa:ProposalDeclined");
        statusValues[2] = keccak256("sa:ProposalRescinded");
        shapes.defineEnumSet(enumStatus, statusValues);

        // ─── sa:GrantProposalPublicFacet shape ──────────────────────
        ShapeRegistry.PropertyConstraint[] memory props = new ShapeRegistry.PropertyConstraint[](7);
        props[0] = ShapeRegistry.PropertyConstraint({
            predicate: proposal.SA_PROPOSAL_KIND(),
            expectedDatatype: 5, // DT_BYTES32
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[1] = ShapeRegistry.PropertyConstraint({
            predicate: proposal.SA_PROPOSAL_STATUS(),
            expectedDatatype: 5,
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: enumStatus,
            expectedClass: bytes32(0)
        });
        props[2] = ShapeRegistry.PropertyConstraint({
            predicate: proposal.SA_PROPOSAL_ROUND(),
            expectedDatatype: 5,
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[3] = ShapeRegistry.PropertyConstraint({
            predicate: proposal.SA_PROPOSAL_PROPOSER(),
            expectedDatatype: 2, // DT_ADDRESS
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[4] = ShapeRegistry.PropertyConstraint({
            predicate: proposal.SA_PROPOSAL_RECIPIENT(),
            expectedDatatype: 2,
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[5] = ShapeRegistry.PropertyConstraint({
            predicate: proposal.SA_PROPOSAL_TOTAL_AWARDED(),
            expectedDatatype: 4, // DT_UINT256
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        props[6] = ShapeRegistry.PropertyConstraint({
            predicate: proposal.SA_PROPOSAL_AWARDING_FUND(),
            expectedDatatype: 2,
            cardinality: ShapeRegistry.Cardinality.REQUIRED_ONE,
            enumSetId: bytes32(0),
            expectedClass: bytes32(0)
        });
        shapes.defineShape(
            proposal.CLASS_PROPOSAL_PUBLIC_FACET(),
            props,
            "https://agentictrust.io/ontology/tbox/shacl/proposal-shapes.ttl#GrantProposalPublicFacetShape",
            keccak256("GrantProposalPublicFacetShape.v1")
        );
    }

    function _seedOntology(OntologyTermRegistry ont) internal {
        // Single batched call instead of N separate registerTerm txs.
        // Phase 0.1: atl:agentType / atl:aiAgentClass moved string→bytes32 to
        // match the on-chain attribute store; atl:registeredAt added.
        string[45] memory curies = [
            "atl:displayName", "atl:description", "atl:isActive", "atl:version",
            "atl:agentType", "atl:aiAgentClass", "atl:hasA2AEndpoint", "atl:hasMCPServer",
            "atl:hasServiceEndpoint", "atl:supportedTrustModel", "atl:hasCapability",
            "atl:hasController", "atl:operatedBy", "atl:metadataURI", "atl:metadataHash",
            "atl:schemaURI", "atl:latitude", "atl:longitude", "atl:spatialCRS",
            "atl:spatialType", "atl:hubNavConfig", "atl:hubNetworkLabel", "atl:hubContextTerm",
            "atl:hubOverviewLabel", "atl:hubAgentLabel", "atl:hubFeatures", "atl:hubTheme",
            "atl:hubViewModes", "atl:hubGreeting", "atl:hubVocabulary", "atl:hubRoleVocabulary",
            "atl:hubTypeVocabulary", "atl:genMapData", "atl:activityLog", "atl:trackedMembers",
            "atl:templateId", "atl:primaryName", "atl:nameLabel", "atl:entryPoint",
            "atl:implementation", "atl:delegationManager",
            // Phase 5 (geo-overlap.v1) reads city/region/country directly off
            // the agent for the coarse trust score; the precise GeoSPARQL
            // path uses lat/long + GeoFeatureRegistry features.
            "atl:city", "atl:region", "atl:country",
            "atl:registeredAt"
        ];
        string[45] memory dtypes = [
            "string", "string", "bool", "string",
            "bytes32", "bytes32", "string", "string",
            "string", "string[]", "string[]",
            "address[]", "address", "string", "bytes32",
            "string", "string", "string", "string",
            "string", "string", "string", "string",
            "string", "string", "string", "string",
            "string", "string", "string", "string",
            "string", "string", "string", "string",
            "string", "string", "string", "address",
            "address", "address",
            "string", "string", "string",
            "uint256"
        ];
        bytes32[] memory ids = new bytes32[](45);
        string[] memory curiesDyn = new string[](45);
        string[] memory uris = new string[](45);
        string[] memory labels = new string[](45);
        string[] memory dtypesDyn = new string[](45);
        for (uint256 i = 0; i < 45; i++) {
            ids[i] = keccak256(bytes(curies[i]));
            curiesDyn[i] = curies[i];
            uris[i] = string.concat("https://agentictrust.io/ontology/core#", curies[i]);
            labels[i] = curies[i];
            dtypesDyn[i] = dtypes[i];
        }
        ont.registerTermBatch(ids, curiesDyn, uris, labels, dtypesDyn);
    }
}
