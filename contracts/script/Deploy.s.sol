// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {RecoveryModule} from "../src/RecoveryModule.sol";

/// Deploys RecoveryModule through the deterministic CREATE2 deployer, so it gets the same
/// address on every EVM chain. MIN_DELAY is in seconds: 60 for the demo, 259200 (72 h) in production.
contract Deploy is Script {
    function run() external returns (RecoveryModule module) {
        uint32 minDelay = uint32(vm.envOr("MIN_DELAY", uint256(60)));
        vm.startBroadcast();
        module = new RecoveryModule{salt: keccak256("swissquote-wallet-recovery-v1")}(minDelay);
        vm.stopBroadcast();
        console.log("RecoveryModule:", address(module));
        console.log("minDelay (s):", minDelay);
    }
}
