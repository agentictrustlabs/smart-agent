// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title AgentValidationProfile
 * @notice Records how a specific assertion was validated.
 *
 * Links an assertion ID to the validation method, verifier contract,
 * and evidence that backs the claim. This is the "why should anyone
 * believe this?" layer.
 *
 * For TEE attestations:
 *   validationMethod = tee-onchain-verified
 *   verifierContract = address of TEE verifier
 *   evidence contains teeArch, codeMeasurement, quoteType
 *
 * For insurance:
 *   validationMethod = insurer-issued
 *   verifierContract = 0x0 (no on-chain verifier)
 *   evidence contains policy reference, coverage details
 */
contract AgentValidationProfile {
    struct ValidationRecord {
        uint256 validationId;
        uint256 assertionId;         // which assertion this validates
        bytes32 validationMethod;    // VM_TEE_ONCHAIN_VERIFIED, etc.
        address verifierContract;    // on-chain verifier (0x0 if off-chain)
        bytes32 teeArch;             // TEE architecture (nitro, tdx, sgx, 0x0 if N/A)
        bytes32 codeMeasurement;     // code hash / PCR / RTMR (0x0 if N/A)
        string evidenceURI;          // URI to full evidence bundle
        address validatedBy;         // who performed the validation
        uint256 validatedAt;
    }

    // ─── Well-Known TEE Architectures ───────────────────────────────

    bytes32 public constant TEE_NITRO = keccak256("aws-nitro");
    bytes32 public constant TEE_TDX = keccak256("intel-tdx");
    bytes32 public constant TEE_SGX = keccak256("intel-sgx");
    bytes32 public constant TEE_SEV = keccak256("amd-sev");
    bytes32 public constant TEE_NONE = bytes32(0);

    // ─── Storage ────────────────────────────────────────────────────

    ValidationRecord[] private _records;
    mapping(uint256 => uint256[]) private _byAssertionId;
    mapping(address => uint256[]) private _byValidator;

    // ─── Events ─────────────────────────────────────────────────────

    event ValidationRecorded(
        uint256 indexed validationId,
        uint256 indexed assertionId,
        bytes32 validationMethod,
        address indexed validatedBy
    );

    error ValidationNotFound();

    // ─── Record ─────────────────────────────────────────────────────

    function recordValidation(
        uint256 assertionId,
        bytes32 validationMethod,
        address verifierContract,
        bytes32 teeArch,
        bytes32 codeMeasurement,
        string calldata evidenceURI
    ) external returns (uint256 validationId) {
        validationId = _records.length;

        _records.push(ValidationRecord({
            validationId: validationId,
            assertionId: assertionId,
            validationMethod: validationMethod,
            verifierContract: verifierContract,
            teeArch: teeArch,
            codeMeasurement: codeMeasurement,
            evidenceURI: evidenceURI,
            validatedBy: msg.sender,
            validatedAt: block.timestamp
        }));

        _byAssertionId[assertionId].push(validationId);
        _byValidator[msg.sender].push(validationId);

        emit ValidationRecorded(validationId, assertionId, validationMethod, msg.sender);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getValidation(uint256 validationId) external view returns (ValidationRecord memory) {
        if (validationId >= _records.length) revert ValidationNotFound();
        return _records[validationId];
    }

    function getValidationsByAssertion(uint256 assertionId) external view returns (uint256[] memory) {
        return _byAssertionId[assertionId];
    }

    function getValidationsByValidator(address validator) external view returns (uint256[] memory) {
        return _byValidator[validator];
    }

    function validationCount() external view returns (uint256) {
        return _records.length;
    }
}
