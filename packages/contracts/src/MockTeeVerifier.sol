// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MockTeeVerifier
 * @notice Development TEE verifier that simulates attestation verification.
 *
 * In production, this would be replaced by:
 *   - Automata DCAP Verifier (Intel TDX/SGX) — parses raw DCAP quotes on-chain
 *   - Base Nitro Validator (AWS Nitro) — verifies COSE_Sign1 + X.509 chain
 *   - Phala dstack Verifier — off-chain TEE-based verification with on-chain signature
 *
 * This mock follows the same IVerifier interface pattern proposed in the
 * ERC-8004 TEE Registry discussion: accept raw attestation bytes, return
 * a code measurement (bytes32).
 *
 * The mock computes measurements from input data rather than verifying
 * real hardware attestations, enabling end-to-end testing of the full
 * TEE validation flow without actual TEE hardware.
 */
contract MockTeeVerifier {
    // ─── TEE Architecture Constants ─────────────────────────────────

    bytes32 public constant TEE_NITRO = keccak256("aws-nitro");
    bytes32 public constant TEE_TDX = keccak256("intel-tdx");
    bytes32 public constant TEE_SGX = keccak256("intel-sgx");
    bytes32 public constant TEE_SEV = keccak256("amd-sev");

    // ─── Attestation Record ─────────────────────────────────────────

    struct Attestation {
        address agent;           // agent smart account address
        bytes32 teeArch;         // TEE architecture
        bytes32 codeMeasurement; // keccak256(PCR0||PCR1||PCR2) or equivalent
        bytes32 pcr0;            // enclave image / MRTD
        bytes32 pcr1;            // kernel / RTMR0
        bytes32 pcr2;            // application / RTMR1
        bytes publicKey;         // agent's TEE-bound public key
        uint256 verifiedAt;
        bool valid;
    }

    mapping(bytes32 => Attestation) private _attestations; // codeMeasurement → attestation
    mapping(address => bytes32[]) private _byAgent;        // agent → measurements
    bytes32[] private _allMeasurements;

    // ─── Events ─────────────────────────────────────────────────────

    event AttestationVerified(
        address indexed agent,
        bytes32 indexed codeMeasurement,
        bytes32 teeArch,
        uint256 verifiedAt
    );

    event AttestationRevoked(
        address indexed agent,
        bytes32 indexed codeMeasurement
    );

    // ─── Simulate Nitro Attestation ─────────────────────────────────

    /**
     * @notice Simulate verifying an AWS Nitro attestation.
     * @param agent The agent smart account this attestation is for.
     * @param pcr0 PCR0: Enclave image measurement.
     * @param pcr1 PCR1: Linux kernel and bootstrap measurement.
     * @param pcr2 PCR2: Application code measurement.
     * @param publicKey The public key bound to this TEE instance.
     * @return codeMeasurement The computed keccak256(pcr0 || pcr1 || pcr2).
     *
     * In production, this would:
     *   1. Parse the COSE_Sign1 attestation document
     *   2. Verify the X.509 certificate chain back to AWS root
     *   3. Verify the ECDSA-384 signature
     *   4. Extract PCR0, PCR1, PCR2 from the attested document
     *   5. Return the measurement hash
     */
    function verifyNitro(
        address agent,
        bytes32 pcr0,
        bytes32 pcr1,
        bytes32 pcr2,
        bytes calldata publicKey
    ) external returns (bytes32 codeMeasurement) {
        codeMeasurement = keccak256(abi.encodePacked(pcr0, pcr1, pcr2));
        _recordAttestation(agent, TEE_NITRO, codeMeasurement, pcr0, pcr1, pcr2, publicKey);
    }

    /**
     * @notice Simulate verifying an Intel TDX attestation.
     * @param agent The agent smart account.
     * @param mrtd Measurement of the Trust Domain.
     * @param rtmr0 Runtime measurement register 0 (firmware).
     * @param rtmr1 Runtime measurement register 1 (OS/kernel).
     * @param publicKey The public key bound to this TEE instance.
     * @return codeMeasurement The computed keccak256(mrtd || rtmr0 || rtmr1).
     *
     * In production, this would call Automata's DCAP verifier to parse
     * and verify a raw Intel TDX quote against cached Intel collaterals.
     */
    function verifyTdx(
        address agent,
        bytes32 mrtd,
        bytes32 rtmr0,
        bytes32 rtmr1,
        bytes calldata publicKey
    ) external returns (bytes32 codeMeasurement) {
        codeMeasurement = keccak256(abi.encodePacked(mrtd, rtmr0, rtmr1));
        _recordAttestation(agent, TEE_TDX, codeMeasurement, mrtd, rtmr0, rtmr1, publicKey);
    }

    /**
     * @notice Generic verify: accepts pre-computed measurements.
     *         Useful for testing or when the caller has already parsed the quote.
     */
    function verify(
        address agent,
        bytes32 teeArch,
        bytes32 measurement0,
        bytes32 measurement1,
        bytes32 measurement2,
        bytes calldata publicKey
    ) external returns (bytes32 codeMeasurement) {
        codeMeasurement = keccak256(abi.encodePacked(measurement0, measurement1, measurement2));
        _recordAttestation(agent, teeArch, codeMeasurement, measurement0, measurement1, measurement2, publicKey);
    }

    /**
     * @notice Revoke an attestation (e.g., when agent code is updated).
     */
    function revoke(bytes32 codeMeasurement) external {
        Attestation storage a = _attestations[codeMeasurement];
        require(a.valid, "Not found or already revoked");
        a.valid = false;
        emit AttestationRevoked(a.agent, codeMeasurement);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getAttestation(bytes32 codeMeasurement) external view returns (
        address agent, bytes32 teeArch, bytes32 pcr0, bytes32 pcr1, bytes32 pcr2,
        bytes memory publicKey, uint256 verifiedAt, bool valid
    ) {
        Attestation storage a = _attestations[codeMeasurement];
        return (a.agent, a.teeArch, a.pcr0, a.pcr1, a.pcr2, a.publicKey, a.verifiedAt, a.valid);
    }

    function getAgentMeasurements(address agent) external view returns (bytes32[] memory) {
        return _byAgent[agent];
    }

    function isValid(bytes32 codeMeasurement) external view returns (bool) {
        return _attestations[codeMeasurement].valid;
    }

    function attestationCount() external view returns (uint256) {
        return _allMeasurements.length;
    }

    // ─── Internal ───────────────────────────────────────────────────

    function _recordAttestation(
        address agent,
        bytes32 teeArch,
        bytes32 codeMeasurement,
        bytes32 m0, bytes32 m1, bytes32 m2,
        bytes calldata publicKey
    ) internal {
        _attestations[codeMeasurement] = Attestation({
            agent: agent,
            teeArch: teeArch,
            codeMeasurement: codeMeasurement,
            pcr0: m0,
            pcr1: m1,
            pcr2: m2,
            publicKey: publicKey,
            verifiedAt: block.timestamp,
            valid: true
        });
        _byAgent[agent].push(codeMeasurement);
        _allMeasurements.push(codeMeasurement);

        emit AttestationVerified(agent, codeMeasurement, teeArch, block.timestamp);
    }
}
