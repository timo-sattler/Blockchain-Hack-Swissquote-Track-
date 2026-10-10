// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title KitBackupMailbox
/// @notice Public mailbox for the social backup of a 2-of-3 MPC wallet's recovery kit (Swissquote
/// Wallet Challenge prototype). It holds no funds, has no owner and stores only ciphertext:
///   - each friend's inbox key, registered with a signature from the friend's own wallet. Swissquote
///     co-signs for every wallet but holds only one of its key shares, so it cannot forge this
///     signature and swap in an inbox key of its own;
///   - a client's locked kit, as events: useless without two unlock pieces AND the client's password;
///   - each unlock piece, encrypted to one friend's inbox key;
///   - pieces a friend gives back, encrypted to the one-time key of the client's recovering phone.
/// Anyone may pay the gas (Swissquote's treasury does in the prototype); authority comes only from
/// the signatures checked here.
contract KitBackupMailbox is EIP712 {
    bytes32 public constant INBOX_TYPEHASH = keccak256("InboxKey(address owner,bytes key,uint256 nonce)");
    bytes32 public constant BACKUP_TYPEHASH = keccak256(
        "Backup(address wallet,bytes32 setId,bytes32 kitHash,uint32 kitChunks,address[] friends,bytes32 piecesHash,uint256 nonce)"
    );
    uint256 public constant MAX_FRIENDS = 5;
    uint256 public constant MAX_RETURNS = 8;
    uint256 public constant MAX_PIECE_BYTES = 1024;

    struct Backup {
        address wallet;
        address uploader; // the only account that may upload the kit chunks: whoever created the backup
        bytes32 kitHash; // chained hash over all chunks, h = keccak256(h, chunk) starting from zero
        bytes32 uploaded; // the same chained hash over the chunks uploaded so far
        uint32 kitChunks;
        uint64[] chunkBlocks; // block of each chunk event, so readers fetch them without scanning
        address[] friends;
        bytes[] pieces; // pieces[i] is encrypted to friends[i]'s inbox key
    }

    mapping(address => bytes) public inboxKey;
    mapping(address => uint256) public nonces;
    mapping(address => bytes32) public latestBackup;
    mapping(bytes32 => Backup) private backups;
    mapping(address => bytes32[]) private held;
    mapping(bytes32 => bytes[]) private returned;

    event InboxKeyRegistered(address indexed owner, bytes key);
    event BackupCreated(address indexed wallet, bytes32 indexed setId, address[] friends);
    event KitChunk(bytes32 indexed setId, uint256 index, bytes data);
    event BackupComplete(bytes32 indexed setId);
    event PieceReturned(bytes32 indexed requestId, uint256 index);

    error BadSignature();
    error BadInput();
    error AlreadyExists();
    error NotUploader();
    error KitMismatch();
    error TooManyReturns();

    constructor() EIP712("Swissquote Kit Backup", "1") {}

    // ---------- friends: publish an inbox key, signed by the friend's own wallet ----------

    function registerInboxKey(address owner, bytes calldata key, bytes calldata signature) external {
        if (key.length == 0 || key.length > 128) revert BadInput();
        bytes32 structHash = keccak256(abi.encode(INBOX_TYPEHASH, owner, keccak256(key), nonces[owner]++));
        if (ECDSA.recover(_hashTypedDataV4(structHash), signature) != owner) revert BadSignature();
        inboxKey[owner] = key;
        emit InboxKeyRegistered(owner, key);
    }

    // ---------- client: one signed backup = encrypted pieces for friends + the locked kit ----------

    function createBackup(
        address wallet,
        bytes32 setId,
        bytes32 kitHash,
        uint32 kitChunks,
        address[] calldata friends,
        bytes[] calldata pieces,
        bytes calldata signature
    ) external {
        if (backups[setId].wallet != address(0)) revert AlreadyExists();
        uint256 n = friends.length;
        if (n == 0 || n > MAX_FRIENDS || pieces.length != n || kitChunks == 0 || wallet == address(0)) revert BadInput();
        bytes32[] memory pieceHashes = new bytes32[](n);
        for (uint256 i; i < n; ++i) {
            if (inboxKey[friends[i]].length == 0 || pieces[i].length == 0 || pieces[i].length > MAX_PIECE_BYTES) revert BadInput();
            pieceHashes[i] = keccak256(pieces[i]);
        }
        bytes32 structHash = keccak256(
            abi.encode(
                BACKUP_TYPEHASH,
                wallet,
                setId,
                kitHash,
                kitChunks,
                keccak256(abi.encodePacked(friends)),
                keccak256(abi.encodePacked(pieceHashes)),
                nonces[wallet]++
            )
        );
        if (ECDSA.recover(_hashTypedDataV4(structHash), signature) != wallet) revert BadSignature();

        Backup storage b = backups[setId];
        b.wallet = wallet;
        b.uploader = msg.sender;
        b.kitHash = kitHash;
        b.kitChunks = kitChunks;
        for (uint256 i; i < n; ++i) {
            b.friends.push(friends[i]);
            b.pieces.push(pieces[i]);
            held[friends[i]].push(setId);
        }
        latestBackup[wallet] = setId;
        emit BackupCreated(wallet, setId, friends);
    }

    /// The locked kit is too large for one transaction, so it follows in chunks. The signed kitHash
    /// pins their content: a backup only completes if every chunk is exactly what the client signed.
    function uploadKitChunk(bytes32 setId, bytes calldata data) external {
        Backup storage b = backups[setId];
        if (b.wallet == address(0) || msg.sender != b.uploader) revert NotUploader();
        uint256 index = b.chunkBlocks.length;
        if (index >= b.kitChunks || data.length == 0) revert BadInput();
        b.uploaded = keccak256(abi.encodePacked(b.uploaded, data));
        b.chunkBlocks.push(uint64(block.number));
        emit KitChunk(setId, index, data);
        if (index + 1 == b.kitChunks) {
            if (b.uploaded != b.kitHash) revert KitMismatch();
            emit BackupComplete(setId);
        }
    }

    // ---------- recovery: a friend gives a piece back to the client's new phone ----------

    /// `requestId` is keccak256 of the recovering phone's one-time public key, which the client sends
    /// to friends out of band. The piece is encrypted to that key, so only that phone can read it.
    function returnPiece(bytes32 requestId, bytes calldata sealedPiece) external {
        bytes[] storage list = returned[requestId];
        if (list.length >= MAX_RETURNS) revert TooManyReturns();
        if (sealedPiece.length == 0 || sealedPiece.length > MAX_PIECE_BYTES) revert BadInput();
        list.push(sealedPiece);
        emit PieceReturned(requestId, list.length - 1);
    }

    // ---------- views ----------

    function getBackup(bytes32 setId)
        external
        view
        returns (
            address wallet,
            bytes32 kitHash,
            uint32 kitChunks,
            uint64[] memory chunkBlocks,
            address[] memory friends,
            bytes[] memory pieces
        )
    {
        Backup storage b = backups[setId];
        return (b.wallet, b.kitHash, b.kitChunks, b.chunkBlocks, b.friends, b.pieces);
    }

    function isComplete(bytes32 setId) external view returns (bool) {
        Backup storage b = backups[setId];
        return b.kitChunks != 0 && b.chunkBlocks.length == b.kitChunks;
    }

    function backupsHeldBy(address friend) external view returns (bytes32[] memory) {
        return held[friend];
    }

    function returnedPieces(bytes32 requestId) external view returns (bytes[] memory) {
        return returned[requestId];
    }
}
