// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Dev-only ERC-20 stand-in for USDC. 6 decimals, open mint.
 *
 *   NOT FOR PRODUCTION DEPLOYMENT.
 *
 *   The mint surface is intentionally open — off-chain seed scripts
 *   gate on `chainId === 31337` before calling it. If this contract
 *   ever lands on a public network by accident the open mint is
 *   annoying but doesn't leak real funds (it's not real USDC).
 *
 *   Lives under `src/mocks/` so the production-deploy script can
 *   exclude the mocks directory wholesale.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
