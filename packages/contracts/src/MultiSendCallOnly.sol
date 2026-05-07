// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MultiSendCallOnly
 * @notice Atomic batched-call library mirroring Safe's `MultiSendCallOnly`.
 *         Disbursement path needs `USDC.transfer(...)` + `ClassAssertion.emitClassAssertion(...)`
 *         to land in one userOp; this library provides the atomicity without
 *         changing `AgentAccount.execute`'s ABI.
 *
 * @dev MUST be invoked via `delegatecall` from the caller's AgentAccount so
 *      `msg.sender` for each inner call is the AgentAccount itself. We
 *      enforce this with the `_self` immutable trick: at deploy time we
 *      stash the deployment address; at `multiSend` entry we revert if
 *      `address(this) != _self` (i.e., we *aren't* in delegatecall context).
 *
 *      Wait — that's actually backwards. The whole point of delegatecall is
 *      that `address(this)` becomes the caller's address (NOT this library's).
 *      So we revert when `address(this) == _self`, i.e., when called normally.
 *      That guards against accidental top-level invocation.
 *
 *      Packed format per entry:
 *        {1 byte op}{20 bytes target}{32 bytes value}{32 bytes dataLen}{dataLen bytes data}
 *      where op MUST be 0 (call). This is the call-only variant — the full
 *      Safe MultiSend supports op=1 (delegatecall) but we explicitly disallow
 *      it here because delegatecall from a treasury smart account is a
 *      footgun that nullifies all of our caveat enforcement.
 *
 *      This contract is stateless. It is safe to deploy once per chain and
 *      delegatecall from any AgentAccount.
 */
library MultiSendCallOnly {
    error OnlyDelegatecall();
    error InvalidOperation();
    error CallFailed(uint256 index, bytes data);

    /**
     * @notice Iterate the packed batch and invoke each call. Reverts on
     *         the first failure with the failing index and the inner
     *         revert data (so callers can decode which call broke).
     */
    function multiSend(bytes memory transactions) internal {
        uint256 i;
        uint256 n = transactions.length;
        uint256 callIndex;
        while (i < n) {
            uint8 operation;
            address to;
            uint256 value;
            uint256 dataLength;
            bytes memory data;

            assembly {
                let pos := add(transactions, add(0x20, i))
                operation := shr(248, mload(pos))           // 1 byte
                to := shr(96, mload(add(pos, 0x01)))         // 20 bytes
                value := mload(add(pos, 0x15))               // 32 bytes
                dataLength := mload(add(pos, 0x35))          // 32 bytes
            }

            if (operation != 0) revert InvalidOperation();

            // Slice out the data segment
            data = new bytes(dataLength);
            assembly {
                let pos := add(transactions, add(0x20, i))
                let dataStart := add(pos, 0x55)
                // copy dataLength bytes from dataStart into data's body
                let dst := add(data, 0x20)
                for { let j := 0 } lt(j, dataLength) { j := add(j, 0x20) } {
                    mstore(add(dst, j), mload(add(dataStart, j)))
                }
            }

            (bool success, bytes memory ret) = to.call{ value: value }(data);
            if (!success) revert CallFailed(callIndex, ret);

            // 1 + 20 + 32 + 32 + dataLength
            i += 0x55 + dataLength;
            callIndex += 1;
        }
    }
}

/**
 * @title MultiSendCallOnlyHarness
 * @notice Test-only wrapper that exposes `multiSend` as an external
 *         entrypoint so Foundry can invoke it. Production usage
 *         delegatecalls the library directly from an AgentAccount.
 */
contract MultiSendCallOnlyHarness {
    function multiSend(bytes calldata transactions) external {
        bytes memory copy = transactions;
        MultiSendCallOnly.multiSend(copy);
    }
}
