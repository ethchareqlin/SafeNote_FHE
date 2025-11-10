pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SafeNoteFHE is ZamaEthereumConfig {
    
    struct Note {
        string title;
        euint32 encryptedContent;
        uint256 timestamp;
        address owner;
        bool isDecrypted;
        string decryptedContent;
    }
    
    mapping(string => Note) private notes;
    string[] private noteIds;
    
    event NoteCreated(string indexed noteId, address indexed owner);
    event NoteDecrypted(string indexed noteId);
    
    constructor() ZamaEthereumConfig() {}
    
    function createNote(
        string calldata noteId,
        string calldata title,
        externalEuint32 encryptedContent,
        bytes calldata inputProof
    ) external {
        require(bytes(notes[noteId].title).length == 0, "Note already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedContent, inputProof)), "Invalid encrypted content");
        
        notes[noteId] = Note({
            title: title,
            encryptedContent: FHE.fromExternal(encryptedContent, inputProof),
            timestamp: block.timestamp,
            owner: msg.sender,
            isDecrypted: false,
            decryptedContent: ""
        });
        
        FHE.allowThis(notes[noteId].encryptedContent);
        FHE.makePubliclyDecryptable(notes[noteId].encryptedContent);
        
        noteIds.push(noteId);
        emit NoteCreated(noteId, msg.sender);
    }
    
    function decryptNote(
        string calldata noteId,
        bytes memory abiEncodedClearContent,
        bytes memory decryptionProof
    ) external {
        require(bytes(notes[noteId].title).length > 0, "Note does not exist");
        require(!notes[noteId].isDecrypted, "Note already decrypted");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(notes[noteId].encryptedContent);
        
        FHE.checkSignatures(cts, abiEncodedClearContent, decryptionProof);
        
        string memory decodedContent = abi.decode(abiEncodedClearContent, (string));
        
        notes[noteId].decryptedContent = decodedContent;
        notes[noteId].isDecrypted = true;
        
        emit NoteDecrypted(noteId);
    }
    
    function getNote(string calldata noteId) external view returns (
        string memory title,
        uint256 timestamp,
        address owner,
        bool isDecrypted,
        string memory decryptedContent
    ) {
        require(bytes(notes[noteId].title).length > 0, "Note does not exist");
        Note storage note = notes[noteId];
        
        return (
            note.title,
            note.timestamp,
            note.owner,
            note.isDecrypted,
            note.decryptedContent
        );
    }
    
    function getEncryptedContent(string calldata noteId) external view returns (euint32) {
        require(bytes(notes[noteId].title).length > 0, "Note does not exist");
        return notes[noteId].encryptedContent;
    }
    
    function getAllNoteIds() external view returns (string[] memory) {
        return noteIds;
    }
    
    function updateNoteTitle(string calldata noteId, string calldata newTitle) external {
        require(bytes(notes[noteId].title).length > 0, "Note does not exist");
        require(msg.sender == notes[noteId].owner, "Only owner can update");
        
        notes[noteId].title = newTitle;
    }
    
    function deleteNote(string calldata noteId) external {
        require(bytes(notes[noteId].title).length > 0, "Note does not exist");
        require(msg.sender == notes[noteId].owner, "Only owner can delete");
        
        delete notes[noteId];
        
        for (uint i; i < noteIds.length; i++) {
            if (keccak256(bytes(noteIds[i])) == keccak256(bytes(noteId))) {
                noteIds[i] = noteIds[noteIds.length - 1];
                noteIds.pop();
                break;
            }
        }
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


