// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title OntologyTermRegistry
 * @notice Governed registry of valid ontology predicates.
 *
 * Controls which predicate terms can be used in the AgentAccountResolver.
 * Each term maps a bytes32 id (keccak256 of a CURIE like "atl:displayName")
 * to its full URI, human label, and expected datatype.
 *
 * Governance: only the governor address can register or deactivate terms.
 * In production this would be a DAO or multi-sig; for development it's the deployer.
 */
contract OntologyTermRegistry {
    struct Term {
        bytes32 id;          // keccak256("atl:displayName")
        string curie;        // "atl:displayName"
        string uri;          // "https://agentictrust.io/ontology/core#displayName"
        string label;        // "Display Name"
        string datatype;     // "string", "address", "bool", "uint256", "string[]", "address[]"
        bool active;
        uint256 registeredAt;
    }

    address public governor;
    mapping(bytes32 => Term) private _terms;
    bytes32[] private _termIds;

    event TermRegistered(bytes32 indexed id, string curie, string uri);
    event TermDeactivated(bytes32 indexed id);
    event TermActivated(bytes32 indexed id);
    event GovernorTransferred(address indexed oldGovernor, address indexed newGovernor);

    error NotGovernor();
    error TermExists();
    error TermNotFound();

    modifier onlyGovernor() {
        if (msg.sender != governor) revert NotGovernor();
        _;
    }

    constructor(address governor_) {
        governor = governor_;
    }

    function transferGovernor(address newGovernor) external onlyGovernor {
        emit GovernorTransferred(governor, newGovernor);
        governor = newGovernor;
    }

    function registerTerm(
        bytes32 id,
        string calldata curie,
        string calldata uri,
        string calldata label,
        string calldata datatype
    ) external onlyGovernor {
        if (_terms[id].registeredAt != 0) revert TermExists();

        _terms[id] = Term({
            id: id,
            curie: curie,
            uri: uri,
            label: label,
            datatype: datatype,
            active: true,
            registeredAt: block.timestamp
        });
        _termIds.push(id);

        emit TermRegistered(id, curie, uri);
    }

    function registerTermBatch(
        bytes32[] calldata ids,
        string[] calldata curies,
        string[] calldata uris,
        string[] calldata labels,
        string[] calldata datatypes
    ) external onlyGovernor {
        for (uint256 i = 0; i < ids.length; i++) {
            if (_terms[ids[i]].registeredAt != 0) continue; // skip existing
            _terms[ids[i]] = Term({
                id: ids[i],
                curie: curies[i],
                uri: uris[i],
                label: labels[i],
                datatype: datatypes[i],
                active: true,
                registeredAt: block.timestamp
            });
            _termIds.push(ids[i]);
            emit TermRegistered(ids[i], curies[i], uris[i]);
        }
    }

    function deactivateTerm(bytes32 id) external onlyGovernor {
        if (_terms[id].registeredAt == 0) revert TermNotFound();
        _terms[id].active = false;
        emit TermDeactivated(id);
    }

    function activateTerm(bytes32 id) external onlyGovernor {
        if (_terms[id].registeredAt == 0) revert TermNotFound();
        _terms[id].active = true;
        emit TermActivated(id);
    }

    // ─── Queries ────────────────────────────────────────────────────

    function getTerm(bytes32 id) external view returns (Term memory) {
        return _terms[id];
    }

    function isRegistered(bytes32 id) external view returns (bool) {
        return _terms[id].registeredAt != 0;
    }

    function isActive(bytes32 id) external view returns (bool) {
        return _terms[id].active;
    }

    function termCount() external view returns (uint256) {
        return _termIds.length;
    }

    function getTermAt(uint256 index) external view returns (Term memory) {
        return _terms[_termIds[index]];
    }

    function getAllTermIds() external view returns (bytes32[] memory) {
        return _termIds;
    }
}
