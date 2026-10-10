// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {KitBackupMailbox} from "../src/KitBackupMailbox.sol";

contract KitBackupMailboxTest is Test {
    KitBackupMailbox mailbox;
    uint256 annaKey = 0xA11CE;
    uint256 benKey = 0xB0B;
    uint256 carlaKey = 0xCA21A;
    uint256 swissquoteKey = 0x5A5A; // stands in for anyone who is not the wallet itself
    address anna;
    address ben;
    address carla;
    address relayer = address(0x7EA5);

    function setUp() public {
        mailbox = new KitBackupMailbox();
        anna = vm.addr(annaKey);
        ben = vm.addr(benKey);
        carla = vm.addr(carlaKey);
    }

    function _domain() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Swissquote Kit Backup"),
                keccak256("1"),
                block.chainid,
                address(mailbox)
            )
        );
    }

    function _sign(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", _domain(), structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _inboxSig(uint256 key, address owner, bytes memory inbox) internal view returns (bytes memory) {
        return _sign(key, keccak256(abi.encode(mailbox.INBOX_TYPEHASH(), owner, keccak256(inbox), mailbox.nonces(owner))));
    }

    function _register(uint256 key, bytes memory inbox) internal {
        address owner = vm.addr(key);
        vm.prank(relayer);
        mailbox.registerInboxKey(owner, inbox, _inboxSig(key, owner, inbox));
    }

    struct Set {
        bytes32 setId;
        bytes32 kitHash;
        uint32 chunks;
        address[] friends;
        bytes[] pieces;
        bytes[] kit;
    }

    function _set() internal view returns (Set memory s) {
        s.setId = keccak256("set-1");
        s.kit = new bytes[](2);
        s.kit[0] = hex"0102030405";
        s.kit[1] = hex"0607";
        s.kitHash = keccak256(abi.encodePacked(keccak256(abi.encodePacked(bytes32(0), s.kit[0])), s.kit[1]));
        s.chunks = 2;
        s.friends = new address[](2);
        s.friends[0] = ben;
        s.friends[1] = carla;
        s.pieces = new bytes[](2);
        s.pieces[0] = hex"aa01";
        s.pieces[1] = hex"bb02";
    }

    function _backupSig(uint256 key, address wallet, Set memory s) internal view returns (bytes memory) {
        bytes32[] memory hashes = new bytes32[](s.pieces.length);
        for (uint256 i; i < hashes.length; ++i) hashes[i] = keccak256(s.pieces[i]);
        return _sign(
            key,
            keccak256(
                abi.encode(
                    mailbox.BACKUP_TYPEHASH(),
                    wallet,
                    s.setId,
                    s.kitHash,
                    s.chunks,
                    keccak256(abi.encodePacked(s.friends)),
                    keccak256(abi.encodePacked(hashes)),
                    mailbox.nonces(wallet)
                )
            )
        );
    }

    function _create(Set memory s) internal {
        bytes memory sig = _backupSig(annaKey, anna, s);
        vm.prank(relayer);
        mailbox.createBackup(anna, s.setId, s.kitHash, s.chunks, s.friends, s.pieces, sig);
    }

    // ---------- inbox keys ----------

    function test_friendRegistersInboxKeyWithOwnSignature() public {
        _register(benKey, hex"04aa");
        assertEq(mailbox.inboxKey(ben), hex"04aa");
        assertEq(mailbox.nonces(ben), 1);
    }

    function test_nobodyElseCanSetAFriendsInboxKey() public {
        bytes memory sig = _inboxSig(swissquoteKey, ben, hex"04ee");
        vm.expectRevert(KitBackupMailbox.BadSignature.selector);
        mailbox.registerInboxKey(ben, hex"04ee", sig);
    }

    function test_inboxSignatureCannotBeReplayed() public {
        bytes memory sig = _inboxSig(benKey, ben, hex"04aa");
        mailbox.registerInboxKey(ben, hex"04aa", sig);
        _register(benKey, hex"04bb");
        vm.expectRevert(KitBackupMailbox.BadSignature.selector);
        mailbox.registerInboxKey(ben, hex"04aa", sig); // an attacker re-submitting the old key
        assertEq(mailbox.inboxKey(ben), hex"04bb");
    }

    // ---------- backups ----------

    function test_backupWithChunksCompletes() public {
        _register(benKey, hex"04aa");
        _register(carlaKey, hex"04bb");
        Set memory s = _set();
        _create(s);
        vm.startPrank(relayer);
        mailbox.uploadKitChunk(s.setId, s.kit[0]);
        assertFalse(mailbox.isComplete(s.setId));
        mailbox.uploadKitChunk(s.setId, s.kit[1]);
        vm.stopPrank();
        assertTrue(mailbox.isComplete(s.setId));
        assertEq(mailbox.latestBackup(anna), s.setId);
        assertEq(mailbox.backupsHeldBy(ben)[0], s.setId);
        (address wallet,,, uint64[] memory blocks, address[] memory friends, bytes[] memory pieces) = mailbox.getBackup(s.setId);
        assertEq(wallet, anna);
        assertEq(blocks.length, 2);
        assertEq(friends[1], carla);
        assertEq(pieces[1], hex"bb02");
    }

    function test_backupNeedsTheWalletsSignature() public {
        _register(benKey, hex"04aa");
        _register(carlaKey, hex"04bb");
        Set memory s = _set();
        bytes memory forged = _backupSig(swissquoteKey, anna, s);
        vm.expectRevert(KitBackupMailbox.BadSignature.selector);
        mailbox.createBackup(anna, s.setId, s.kitHash, s.chunks, s.friends, s.pieces, forged);
    }

    function test_swappedPiecesBreakTheSignature() public {
        _register(benKey, hex"04aa");
        _register(carlaKey, hex"04bb");
        Set memory s = _set();
        bytes memory sig = _backupSig(annaKey, anna, s);
        s.pieces[0] = hex"ee99"; // e.g. a piece encrypted to someone else's key
        vm.expectRevert(KitBackupMailbox.BadSignature.selector);
        mailbox.createBackup(anna, s.setId, s.kitHash, s.chunks, s.friends, s.pieces, sig);
    }

    function test_friendWithoutInboxKeyIsRefused() public {
        _register(benKey, hex"04aa");
        Set memory s = _set();
        bytes memory sig = _backupSig(annaKey, anna, s);
        vm.expectRevert(KitBackupMailbox.BadInput.selector);
        mailbox.createBackup(anna, s.setId, s.kitHash, s.chunks, s.friends, s.pieces, sig);
    }

    function test_onlyTheUploaderAddsChunks() public {
        _register(benKey, hex"04aa");
        _register(carlaKey, hex"04bb");
        Set memory s = _set();
        _create(s);
        vm.expectRevert(KitBackupMailbox.NotUploader.selector);
        mailbox.uploadKitChunk(s.setId, s.kit[0]);
    }

    function test_wrongKitDataNeverCompletes() public {
        _register(benKey, hex"04aa");
        _register(carlaKey, hex"04bb");
        Set memory s = _set();
        _create(s);
        vm.startPrank(relayer);
        mailbox.uploadKitChunk(s.setId, s.kit[0]);
        vm.expectRevert(KitBackupMailbox.KitMismatch.selector);
        mailbox.uploadKitChunk(s.setId, hex"ffff");
        vm.stopPrank();
        assertFalse(mailbox.isComplete(s.setId));
    }

    function test_setIdCannotBeTakenOver() public {
        _register(benKey, hex"04aa");
        _register(carlaKey, hex"04bb");
        Set memory s = _set();
        _create(s);
        bytes memory sig = _backupSig(benKey, ben, s);
        vm.expectRevert(KitBackupMailbox.AlreadyExists.selector);
        mailbox.createBackup(ben, s.setId, s.kitHash, s.chunks, s.friends, s.pieces, sig);
    }

    // ---------- giving pieces back ----------

    function test_returnedPiecesAreCapped() public {
        bytes32 requestId = keccak256("one-time key");
        for (uint256 i; i < mailbox.MAX_RETURNS(); ++i) mailbox.returnPiece(requestId, hex"01");
        assertEq(mailbox.returnedPieces(requestId).length, mailbox.MAX_RETURNS());
        vm.expectRevert(KitBackupMailbox.TooManyReturns.selector);
        mailbox.returnPiece(requestId, hex"01");
    }
}
