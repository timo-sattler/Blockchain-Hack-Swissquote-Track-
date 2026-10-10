// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @dev The parts of Coinbase Smart Wallet v1.1 (MultiOwnable) this module uses.
interface ICoinbaseSmartWallet {
    function addOwnerPublicKey(bytes32 x, bytes32 y) external;
    function removeOwnerAtIndex(uint256 index, bytes calldata owner) external;
    function isOwnerAddress(address account) external view returns (bool);
    function isOwnerPublicKey(bytes32 x, bytes32 y) external view returns (bool);
    function nextOwnerIndex() external view returns (uint256);
    function ownerAtIndex(uint256 index) external view returns (bytes memory);
}

/**
 * @title RecoveryModule
 * @notice Guardian recovery for Coinbase Smart Wallet accounts. M-of-N guardians (for example the
 * client's own backup key, Swissquote and a trusted contact) can replace the account's passkey,
 * but only after a delay during which any current owner can cancel.
 *
 * The account adds this module as an owner so it is allowed to change owners. The module only
 * ever calls `addOwnerPublicKey` and `removeOwnerAtIndex`, and only from `executeRecovery`: it
 * cannot move funds. It is not upgradeable and has no admin.
 *
 * Guardian approvals are EIP-712 signatures checked with OpenZeppelin's SignatureChecker, so a
 * guardian can be a plain key (ECDSA) or a smart account such as another passkey wallet (ERC-1271).
 */
contract RecoveryModule is EIP712 {
    struct Config {
        address[] guardians; // sorted ascending, no duplicates
        uint8 threshold;
        uint32 delay;
        uint64 nonce; // bumped on every change and every started recovery, so approvals cannot be replayed
    }

    struct PendingRecovery {
        bytes32 x;
        bytes32 y;
        uint64 executeAfter; // 0 means nothing is pending
    }

    bytes32 public constant RECOVERY_TYPEHASH =
        keccak256("Recovery(address account,bytes32 x,bytes32 y,uint256 nonce,uint256 deadline)");

    uint256 public constant MAX_GUARDIANS = 5;

    /// @notice Shortest delay an account may choose. 72 hours in production, minutes for the demo.
    uint32 public immutable minDelay;

    mapping(address account => Config) internal _configs;
    mapping(address account => PendingRecovery) public pending;

    event GuardiansSet(address indexed account, address[] guardians, uint8 threshold, uint32 delay);
    event RecoveryStarted(address indexed account, bytes32 x, bytes32 y, uint64 executeAfter, address[] approvedBy);
    event RecoveryCancelled(address indexed account);
    event RecoveryExecuted(address indexed account, bytes32 x, bytes32 y);

    error InvalidGuardians();
    error InvalidThreshold();
    error DelayTooShort();
    error NotConfigured();
    error RecoveryAlreadyPending();
    error NoPendingRecovery();
    error RecoveryNotReady(uint64 executeAfter);
    error ApprovalsExpired();
    error InvalidPublicKey();
    error NotEnoughApprovals();
    error SignersNotSorted();
    error NotAGuardian(address signer);
    error InvalidSignature(address signer);

    constructor(uint32 minDelay_) EIP712("Swissquote Wallet Recovery", "1") {
        minDelay = minDelay_;
    }

    // ---------------------------------------------------------------- account owner actions

    /// @notice Called by the account itself (through a passkey-signed UserOperation).
    /// Replaces the guardian set and cancels any pending recovery.
    function setGuardians(address[] calldata guardians, uint8 threshold, uint32 delay) external {
        if (guardians.length == 0 || guardians.length > MAX_GUARDIANS) revert InvalidGuardians();
        // No single party may recover alone, and the threshold must be reachable.
        if (threshold < 2 || threshold > guardians.length) revert InvalidThreshold();
        if (delay < minDelay) revert DelayTooShort();

        address previous = address(0);
        for (uint256 i; i < guardians.length; ++i) {
            if (guardians[i] <= previous || guardians[i] == msg.sender) revert InvalidGuardians();
            previous = guardians[i];
        }

        Config storage config = _configs[msg.sender];
        config.guardians = guardians;
        config.threshold = threshold;
        config.delay = delay;
        config.nonce++;
        delete pending[msg.sender];

        emit GuardiansSet(msg.sender, guardians, threshold, delay);
    }

    /// @notice The owner's veto: any current owner of the account can stop a pending recovery.
    function cancelRecovery() external {
        if (pending[msg.sender].executeAfter == 0) revert NoPendingRecovery();
        delete pending[msg.sender];
        _configs[msg.sender].nonce++;
        emit RecoveryCancelled(msg.sender);
    }

    // ---------------------------------------------------------------- recovery (anyone can submit)

    /// @notice Starts the delay once enough guardians approved the new passkey `(x, y)`.
    /// @param signers Guardians who approved, sorted ascending. `signatures[i]` belongs to `signers[i]`.
    function startRecovery(
        address account,
        bytes32 x,
        bytes32 y,
        uint256 deadline,
        address[] calldata signers,
        bytes[] calldata signatures
    ) external {
        Config storage config = _configs[account];
        if (config.threshold == 0) revert NotConfigured();
        if (pending[account].executeAfter != 0) revert RecoveryAlreadyPending();
        if (block.timestamp > deadline) revert ApprovalsExpired();
        if (x == bytes32(0) && y == bytes32(0)) revert InvalidPublicKey();
        if (signers.length < config.threshold || signers.length != signatures.length) revert NotEnoughApprovals();

        bytes32 digest = recoveryDigest(account, x, y, config.nonce, deadline);
        address previous = address(0);
        for (uint256 i; i < signers.length; ++i) {
            address signer = signers[i];
            if (signer <= previous) revert SignersNotSorted();
            previous = signer;
            if (!_isGuardian(config.guardians, signer)) revert NotAGuardian(signer);
            if (!SignatureChecker.isValidSignatureNow(signer, digest, signatures[i])) revert InvalidSignature(signer);
        }

        config.nonce++;
        uint64 executeAfter = uint64(block.timestamp) + config.delay;
        pending[account] = PendingRecovery(x, y, executeAfter);
        emit RecoveryStarted(account, x, y, executeAfter, signers);
    }

    /// @notice After the delay, makes `(x, y)` the account's passkey and removes every other owner
    /// except this module, so the lost or stolen device can no longer sign.
    function executeRecovery(address account) external {
        PendingRecovery memory recovery = pending[account];
        if (recovery.executeAfter == 0) revert NoPendingRecovery();
        if (block.timestamp < recovery.executeAfter) revert RecoveryNotReady(recovery.executeAfter);
        delete pending[account];

        ICoinbaseSmartWallet wallet = ICoinbaseSmartWallet(account);
        if (!wallet.isOwnerPublicKey(recovery.x, recovery.y)) wallet.addOwnerPublicKey(recovery.x, recovery.y);

        bytes32 keep = keccak256(abi.encode(recovery.x, recovery.y));
        bytes32 self = keccak256(abi.encode(address(this)));
        uint256 count = wallet.nextOwnerIndex();
        for (uint256 i; i < count; ++i) {
            bytes memory owner = wallet.ownerAtIndex(i);
            if (owner.length == 0) continue; // slot of an already removed owner
            bytes32 ownerHash = keccak256(owner);
            if (ownerHash == keep || ownerHash == self) continue;
            wallet.removeOwnerAtIndex(i, owner);
        }

        emit RecoveryExecuted(account, recovery.x, recovery.y);
    }

    // ---------------------------------------------------------------- views

    /// @notice The EIP-712 digest a guardian signs to approve `(x, y)` as the account's new passkey.
    function recoveryDigest(address account, bytes32 x, bytes32 y, uint256 nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(RECOVERY_TYPEHASH, account, x, y, nonce, deadline)));
    }

    function getConfig(address account)
        external
        view
        returns (address[] memory guardians, uint8 threshold, uint32 delay, uint64 nonce)
    {
        Config storage config = _configs[account];
        return (config.guardians, config.threshold, config.delay, config.nonce);
    }

    /// @notice True when recovery would work: guardians are set and the module is an owner.
    function isEnabled(address account) external view returns (bool) {
        if (_configs[account].threshold == 0 || account.code.length == 0) return false;
        return ICoinbaseSmartWallet(account).isOwnerAddress(address(this));
    }

    function _isGuardian(address[] storage guardians, address signer) private view returns (bool) {
        for (uint256 i; i < guardians.length; ++i) {
            if (guardians[i] == signer) return true;
        }
        return false;
    }
}
