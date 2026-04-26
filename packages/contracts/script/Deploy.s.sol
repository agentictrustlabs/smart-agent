// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/AgentAccountFactory.sol";
import "../src/DelegationManager.sol";
import "../src/enforcers/TimestampEnforcer.sol";
import "../src/enforcers/ValueEnforcer.sol";
import "../src/enforcers/AllowedTargetsEnforcer.sol";
import "../src/enforcers/AllowedMethodsEnforcer.sol";
import "../src/enforcers/DataScopeEnforcer.sol";
import "../src/enforcers/RateLimitEnforcer.sol";
import "../src/enforcers/RecoveryEnforcer.sol";
import "../src/validators/PasskeyValidator.sol";
import "../src/UniversalSignatureValidator.sol";
import "../src/AgentRelationship.sol";
import "../src/AgentAssertion.sol";
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
import "../src/AgentAccountResolver.sol";
import "../src/AgentUniversalResolver.sol";
import "../src/AgentNameRegistry.sol";
import "../src/AgentNameResolver.sol";
import "../src/AgentNameUniversalResolver.sol";
import "../src/enforcers/NameScopeEnforcer.sol";
import "../src/enforcers/MembershipProofEnforcer.sol";
import "../src/CredentialRegistry.sol";
import "../src/DaimoP256Verifier.sol";
import "../src/GeoFeatureRegistry.sol";
import "../src/GeoClaimRegistry.sol";
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

        // 5. Relationship Protocol (3 contracts)
        AgentRelationship agentRelationship = new AgentRelationship();
        console.log("AgentRelationship:", address(agentRelationship));

        AgentAssertion agentAssertion = new AgentAssertion(address(agentRelationship));
        console.log("AgentAssertion:", address(agentAssertion));

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

        // 15. Agent Account Resolver (on-chain agent metadata)
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

        // ─── Geo registries ───────────────────────────────────────────
        GeoFeatureRegistry geoFeatures = new GeoFeatureRegistry(nameRegistry);
        console.log("GeoFeatureRegistry:", address(geoFeatures));
        GeoClaimRegistry geoClaims = new GeoClaimRegistry(geoFeatures);
        console.log("GeoClaimRegistry:", address(geoClaims));

        // ─── Seed ontology predicates ─────────────────────────────────
        // AgentAccountResolver rejects any setStringProperty / addMulti…
        // call whose predicate isn't registered + active here. The full
        // catalog has to be registered as part of deploy so resolver
        // writes work from block 1. Mirrors the predicates in
        // packages/sdk/src/predicates.ts.
        _seedOntology(ontologyRegistry);

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
        _logEnv("AGENT_RESOLVER_ADDRESS", address(agentResolver));
        _logEnv("TIMESTAMP_ENFORCER_ADDRESS", address(timestampEnforcer));
        _logEnv("VALUE_ENFORCER_ADDRESS", address(valueEnforcer));
        _logEnv("ALLOWED_TARGETS_ENFORCER_ADDRESS", address(allowedTargetsEnforcer));
        _logEnv("ALLOWED_METHODS_ENFORCER_ADDRESS", address(allowedMethodsEnforcer));
        _logEnv("DATA_SCOPE_ENFORCER_ADDRESS", address(dataScopeEnforcer));
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
    }

    function _logEnv(string memory key, address addr) internal pure {
        console.log(string.concat(key, "=", vm.toString(addr)));
    }

    function _seedOntology(OntologyTermRegistry ont) internal {
        // Single batched call instead of N separate registerTerm txs.
        string[44] memory curies = [
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
            "atl:city", "atl:region", "atl:country"
        ];
        string[44] memory dtypes = [
            "string", "string", "bool", "string",
            "string", "string", "string", "string",
            "string", "string[]", "string[]",
            "address[]", "address", "string", "bytes32",
            "string", "string", "string", "string",
            "string", "string", "string", "string",
            "string", "string", "string", "string",
            "string", "string", "string", "string",
            "string", "string", "string", "string",
            "string", "string", "string", "address",
            "address", "address",
            "string", "string", "string"
        ];
        bytes32[] memory ids = new bytes32[](44);
        string[] memory curiesDyn = new string[](44);
        string[] memory uris = new string[](44);
        string[] memory labels = new string[](44);
        string[] memory dtypesDyn = new string[](44);
        for (uint256 i = 0; i < 44; i++) {
            ids[i] = keccak256(bytes(curies[i]));
            curiesDyn[i] = curies[i];
            uris[i] = string.concat("https://agentictrust.io/ontology/core#", curies[i]);
            labels[i] = curies[i];
            dtypesDyn[i] = dtypes[i];
        }
        ont.registerTermBatch(ids, curiesDyn, uris, labels, dtypesDyn);
    }
}
