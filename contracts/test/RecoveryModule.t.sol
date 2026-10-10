// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RecoveryModule, ICoinbaseSmartWallet} from "../src/RecoveryModule.sol";

interface ICoinbaseSmartWalletFactory {
    function createAccount(bytes[] calldata owners, uint256 nonce) external payable returns (address);
}

interface IOwnerAdmin {
    function addOwnerAddress(address owner) external;
}

/// Runs against the real Coinbase Smart Wallet v1.1 factory on a Base Sepolia fork,
/// the same contract the app deploys for every client.
contract RecoveryModuleTest is Test {
    ICoinbaseSmartWalletFactory constant FACTORY = ICoinbaseSmartWalletFactory(0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842);
    uint32 constant DELAY = 72 hours;

    RecoveryModule module;
    address account;

    // The client's original passkey (lost in the story) and the new one on the replacement phone.
    bytes32 constant OLD_X = bytes32(uint256(0x1111));
    bytes32 constant OLD_Y = bytes32(uint256(0x2222));
    bytes32 constant NEW_X = bytes32(uint256(0x3333));
    bytes32 constant NEW_Y = bytes32(uint256(0x4444));

    // Random keys: tiny keys like 0x1 map to public testnet addresses that carry EIP-7702 code.
    uint256 backupKey;
    uint256 swissquoteKey;
    uint256 contactKey;
    uint256 attackerKey;

    function setUp() public {
        vm.createSelectFork(vm.envOr("RPC_URL", string("https://sepolia.base.org")));
        module = new RecoveryModule(1 hours);
        (, backupKey) = makeAddrAndKey("client-backup");
        (, swissquoteKey) = makeAddrAndKey("swissquote-guardian");
        (, contactKey) = makeAddrAndKey("trusted-contact");
        (, attackerKey) = makeAddrAndKey("attacker");

        bytes[] memory owners = new bytes[](1);
        owners[0] = abi.encode(OLD_X, OLD_Y);
        account = FACTORY.createAccount(owners, uint256(keccak256("recovery-test")));

        // What the app does in one passkey-signed UserOperation: enable the module, set guardians.
        vm.startPrank(account);
        IOwnerAdmin(account).addOwnerAddress(address(module));
        module.setGuardians(_sorted3(vm.addr(backupKey), vm.addr(swissquoteKey), vm.addr(contactKey)), 2, DELAY);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- happy paths

    function test_LostPhone_BackupAndSwissquoteRecover() public {
        assertTrue(module.isEnabled(account));
        _start(_two(backupKey, swissquoteKey));
        vm.warp(block.timestamp + DELAY);
        module.executeRecovery(account);

        ICoinbaseSmartWallet wallet = ICoinbaseSmartWallet(account);
        assertTrue(wallet.isOwnerPublicKey(NEW_X, NEW_Y), "new passkey is owner");
        assertFalse(wallet.isOwnerPublicKey(OLD_X, OLD_Y), "lost passkey is revoked");
        assertTrue(wallet.isOwnerAddress(address(module)), "module stays enabled");
    }

    function test_SwissquoteGone_BackupAndContactRecover() public {
        _start(_two(backupKey, contactKey));
        vm.warp(block.timestamp + DELAY);
        module.executeRecovery(account);
        assertTrue(ICoinbaseSmartWallet(account).isOwnerPublicKey(NEW_X, NEW_Y));
    }

    // ---------------------------------------------------------------- attacks

    function test_RevertWhen_OnlyOneGuardianApproves() public {
        uint256[] memory keys = new uint256[](1);
        keys[0] = swissquoteKey;
        _startExpecting(keys, abi.encodeWithSelector(RecoveryModule.NotEnoughApprovals.selector));
    }

    function test_RevertWhen_AttackerSignsWithOwnKey() public {
        // Stolen phone + email give no guardian key: the attacker can only sign with their own.
        _startExpecting(
            _two(backupKey, attackerKey),
            abi.encodeWithSelector(RecoveryModule.NotAGuardian.selector, vm.addr(attackerKey))
        );
    }

    function test_RevertWhen_SameGuardianSignsTwice() public {
        uint256[] memory keys = new uint256[](2);
        keys[0] = swissquoteKey;
        keys[1] = swissquoteKey;
        _startExpecting(keys, abi.encodeWithSelector(RecoveryModule.SignersNotSorted.selector));
    }

    function test_RevertWhen_ExecutedBeforeDelay() public {
        _start(_two(swissquoteKey, contactKey));
        vm.warp(block.timestamp + DELAY - 1);
        vm.expectRevert();
        module.executeRecovery(account);
    }

    function test_OwnerVetoes_SwissquoteAndPartnerCollusion() public {
        // Swissquote and the contact collude; the real client still has a passkey and cancels.
        (bytes32 digest, uint256 deadline) = _digest();
        (address[] memory signers, bytes[] memory sigs) = _sign(_two(swissquoteKey, contactKey), digest);
        module.startRecovery(account, NEW_X, NEW_Y, deadline, signers, sigs);

        vm.prank(account);
        module.cancelRecovery();

        // The same approvals cannot be replayed after the veto.
        vm.expectRevert(abi.encodeWithSelector(RecoveryModule.InvalidSignature.selector, signers[0]));
        module.startRecovery(account, NEW_X, NEW_Y, deadline, signers, sigs);

        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(RecoveryModule.NoPendingRecovery.selector);
        module.executeRecovery(account);
        assertTrue(ICoinbaseSmartWallet(account).isOwnerPublicKey(OLD_X, OLD_Y));
    }

    function test_RevertWhen_ApprovalsExpired() public {
        (bytes32 digest, uint256 deadline) = _digest();
        (address[] memory signers, bytes[] memory sigs) = _sign(_two(backupKey, swissquoteKey), digest);
        vm.warp(deadline + 1);
        vm.expectRevert(RecoveryModule.ApprovalsExpired.selector);
        module.startRecovery(account, NEW_X, NEW_Y, deadline, signers, sigs);
    }

    function test_RevertWhen_ApprovalIsForADifferentKey() public {
        (bytes32 digest, uint256 deadline) = _digest();
        (address[] memory signers, bytes[] memory sigs) = _sign(_two(backupKey, swissquoteKey), digest);
        bytes32 attackerX = bytes32(uint256(0xBAD));
        vm.expectRevert();
        module.startRecovery(account, attackerX, NEW_Y, deadline, signers, sigs);
    }

    function test_RevertWhen_SingleGuardianThreshold() public {
        vm.prank(account);
        vm.expectRevert(RecoveryModule.InvalidThreshold.selector);
        module.setGuardians(_sorted3(vm.addr(backupKey), vm.addr(swissquoteKey), vm.addr(contactKey)), 1, DELAY);
    }

    function test_RevertWhen_DelayBelowMinimum() public {
        vm.prank(account);
        vm.expectRevert(RecoveryModule.DelayTooShort.selector);
        module.setGuardians(_sorted3(vm.addr(backupKey), vm.addr(swissquoteKey), vm.addr(contactKey)), 2, 59 minutes);
    }

    function test_ChangingGuardiansCancelsPendingRecovery() public {
        _start(_two(swissquoteKey, contactKey));
        vm.prank(account);
        module.setGuardians(_sorted3(vm.addr(backupKey), vm.addr(swissquoteKey), vm.addr(0xD1)), 2, DELAY);
        (,, uint64 executeAfter) = module.pending(account);
        assertEq(executeAfter, 0);
    }

    // ---------------------------------------------------------------- helpers

    function _start(uint256[] memory keys) internal {
        _startExpecting(keys, "");
    }

    /// Signs first, then arms expectRevert, so the revert is matched against startRecovery itself.
    function _startExpecting(uint256[] memory keys, bytes memory revertData) internal {
        (bytes32 digest, uint256 deadline) = _digest();
        (address[] memory signers, bytes[] memory sigs) = _sign(keys, digest);
        if (revertData.length > 0) vm.expectRevert(revertData);
        module.startRecovery(account, NEW_X, NEW_Y, deadline, signers, sigs);
    }

    function _digest() internal view returns (bytes32 digest, uint256 deadline) {
        (,,, uint64 nonce) = module.getConfig(account);
        deadline = block.timestamp + 1 days;
        digest = module.recoveryDigest(account, NEW_X, NEW_Y, nonce, deadline);
    }

    /// Signs with each key and returns signers sorted ascending, as the contract requires.
    function _sign(uint256[] memory keys, bytes32 digest)
        internal
        pure
        returns (address[] memory signers, bytes[] memory sigs)
    {
        signers = new address[](keys.length);
        sigs = new bytes[](keys.length);
        for (uint256 i; i < keys.length; ++i) {
            signers[i] = vm.addr(keys[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(keys[i], digest);
            sigs[i] = abi.encodePacked(r, s, v);
        }
        for (uint256 i; i < keys.length; ++i) {
            for (uint256 j = i + 1; j < keys.length; ++j) {
                if (signers[j] < signers[i]) {
                    (signers[i], signers[j]) = (signers[j], signers[i]);
                    (sigs[i], sigs[j]) = (sigs[j], sigs[i]);
                }
            }
        }
    }

    function _two(uint256 a, uint256 b) internal pure returns (uint256[] memory keys) {
        keys = new uint256[](2);
        keys[0] = a;
        keys[1] = b;
    }

    function _sorted3(address a, address b, address c) internal pure returns (address[] memory list) {
        list = new address[](3);
        list[0] = a;
        list[1] = b;
        list[2] = c;
        for (uint256 i; i < 3; ++i) {
            for (uint256 j = i + 1; j < 3; ++j) {
                if (list[j] < list[i]) (list[i], list[j]) = (list[j], list[i]);
            }
        }
    }
}
