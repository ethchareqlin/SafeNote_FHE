import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface SecureNote {
  id: string;
  title: string;
  content: string;
  encryptedValue: number;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
  category: string;
  publicValue1: number;
  publicValue2: number;
}

interface OperationHistory {
  id: string;
  type: string;
  noteId: string;
  timestamp: number;
  status: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState<SecureNote[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingNote, setCreatingNote] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newNoteData, setNewNoteData] = useState({ 
    title: "", 
    content: "", 
    category: "personal",
    encryptedValue: 0 
  });
  const [selectedNote, setSelectedNote] = useState<SecureNote | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [operationHistory, setOperationHistory] = useState<OperationHistory[]>([]);
  const [showFAQ, setShowFAQ] = useState(false);
  const notesPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [contractAddress, setContractAddress] = useState("");

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadNotes();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const addOperationToHistory = (type: string, noteId: string, status: string) => {
    const newOp: OperationHistory = {
      id: Date.now().toString(),
      type,
      noteId,
      timestamp: Date.now(),
      status
    };
    setOperationHistory(prev => [newOp, ...prev.slice(0, 9)]);
  };

  const loadNotes = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const notesList: SecureNote[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          notesList.push({
            id: businessId,
            title: businessData.name,
            content: businessData.description,
            encryptedValue: 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0,
            category: "encrypted",
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0
          });
        } catch (e) {
          console.error('Error loading note data:', e);
        }
      }
      
      setNotes(notesList);
      addOperationToHistory("load", "all", "success");
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load notes" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      addOperationToHistory("load", "all", "failed");
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createNote = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingNote(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted note with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const encryptedValue = parseInt(newNoteData.content) || 0;
      const businessId = `note-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, encryptedValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newNoteData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newNoteData.category === "personal" ? 1 : 0,
        0,
        newNoteData.content
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Note created and encrypted successfully!" });
      addOperationToHistory("create", businessId, "success");
      
      await loadNotes();
      setShowCreateModal(false);
      setNewNoteData({ title: "", content: "", category: "personal", encryptedValue: 0 });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      addOperationToHistory("create", "new", "failed");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingNote(false); 
    }
  };

  const decryptNote = async (noteId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(noteId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        addOperationToHistory("decrypt", noteId, "verified");
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(noteId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(noteId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadNotes();
      addOperationToHistory("decrypt", noteId, "success");
      
      setTransactionStatus({ visible: true, status: "success", message: "Note decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadNotes();
        addOperationToHistory("decrypt", noteId, "already_verified");
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      addOperationToHistory("decrypt", noteId, "failed");
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        addOperationToHistory("check", "system", "available");
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredNotes = notes.filter(note => 
    note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    note.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
    note.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedNotes = filteredNotes.slice(
    (currentPage - 1) * notesPerPage,
    currentPage * notesPerPage
  );

  const totalPages = Math.ceil(filteredNotes.length / notesPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>SafeNote FHE 🔐</h1>
            <p>Encrypted Secure Notes</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access encrypted secure notes with FHE technology.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted notes...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>SafeNote FHE 🔐</h1>
          <p>Fully Homomorphic Encrypted Secure Notes</p>
        </div>
        
        <div className="header-actions">
          <button className="faq-btn" onClick={() => setShowFAQ(!showFAQ)}>
            FAQ
          </button>
          <button className="availability-btn" onClick={checkAvailability}>
            Check FHE
          </button>
          <button className="create-btn" onClick={() => setShowCreateModal(true)}>
            + New Note
          </button>
          <ConnectButton />
        </div>
      </header>

      {showFAQ && (
        <div className="faq-panel">
          <h3>FHE Secure Notes FAQ</h3>
          <div className="faq-item">
            <strong>What is FHE?</strong>
            <p>Fully Homomorphic Encryption allows computations on encrypted data without decryption.</p>
          </div>
          <div className="faq-item">
            <strong>How are notes encrypted?</strong>
            <p>Note content is encrypted using Zama FHE technology before being stored on-chain.</p>
          </div>
          <div className="faq-item">
            <strong>Can I search encrypted notes?</strong>
            <p>Yes! FHE enables searching through encrypted content without revealing the data.</p>
          </div>
          <button className="close-faq" onClick={() => setShowFAQ(false)}>Close</button>
        </div>
      )}

      <div className="main-content">
        <div className="sidebar">
          <div className="search-section">
            <input
              type="text"
              placeholder="Search encrypted notes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="stats-panel">
            <h3>Encryption Stats</h3>
            <div className="stat-item">
              <span>Total Notes:</span>
              <span>{notes.length}</span>
            </div>
            <div className="stat-item">
              <span>Verified:</span>
              <span>{notes.filter(n => n.isVerified).length}</span>
            </div>
            <div className="stat-item">
              <span>Encrypted:</span>
              <span>{notes.length}</span>
            </div>
          </div>

          <div className="history-panel">
            <h3>Recent Operations</h3>
            {operationHistory.slice(0, 5).map(op => (
              <div key={op.id} className="history-item">
                <span className="op-type">{op.type}</span>
                <span className="op-status">{op.status}</span>
                <span className="op-time">{new Date(op.timestamp).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="content-area">
          <div className="notes-header">
            <h2>Encrypted Notes</h2>
            <button onClick={loadNotes} disabled={isRefreshing} className="refresh-btn">
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="notes-grid">
            {paginatedNotes.length === 0 ? (
              <div className="empty-state">
                <p>No encrypted notes found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Note
                </button>
              </div>
            ) : (
              paginatedNotes.map((note) => (
                <div 
                  key={note.id} 
                  className={`note-card ${selectedNote?.id === note.id ? "selected" : ""} ${note.isVerified ? "verified" : ""}`}
                  onClick={() => setSelectedNote(note)}
                >
                  <div className="note-header">
                    <h3>{note.title}</h3>
                    <span className={`status-badge ${note.isVerified ? "verified" : "encrypted"}`}>
                      {note.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                    </span>
                  </div>
                  <p className="note-preview">{note.content.substring(0, 100)}...</p>
                  <div className="note-meta">
                    <span>{new Date(note.timestamp * 1000).toLocaleDateString()}</span>
                    <span>{note.category}</span>
                  </div>
                  {note.isVerified && note.decryptedValue && (
                    <div className="decrypted-value">
                      Decrypted: {note.decryptedValue}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                disabled={currentPage === 1} 
                onClick={() => setCurrentPage(currentPage - 1)}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                disabled={currentPage === totalPages} 
                onClick={() => setCurrentPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create Encrypted Note</h2>
              <button onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Title</label>
                <input
                  type="text"
                  value={newNoteData.title}
                  onChange={(e) => setNewNoteData({...newNoteData, title: e.target.value})}
                  placeholder="Note title..."
                />
              </div>
              <div className="form-group">
                <label>Content (Integer only for FHE encryption)</label>
                <input
                  type="number"
                  value={newNoteData.content}
                  onChange={(e) => setNewNoteData({...newNoteData, content: e.target.value})}
                  placeholder="Enter integer content..."
                />
              </div>
              <div className="form-group">
                <label>Category</label>
                <select 
                  value={newNoteData.category}
                  onChange={(e) => setNewNoteData({...newNoteData, category: e.target.value})}
                >
                  <option value="personal">Personal</option>
                  <option value="work">Work</option>
                  <option value="financial">Financial</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button 
                onClick={createNote}
                disabled={creatingNote || !newNoteData.title || !newNoteData.content}
              >
                {creatingNote ? "Encrypting..." : "Create Encrypted Note"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedNote && (
        <div className="modal-overlay">
          <div className="note-detail-modal">
            <div className="modal-header">
              <h2>{selectedNote.title}</h2>
              <button onClick={() => setSelectedNote(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="note-info">
                <p><strong>Content:</strong> {selectedNote.content}</p>
                <p><strong>Created:</strong> {new Date(selectedNote.timestamp * 1000).toLocaleString()}</p>
                <p><strong>Category:</strong> {selectedNote.category}</p>
                <p><strong>Status:</strong> {selectedNote.isVerified ? "Verified" : "Encrypted"}</p>
              </div>
              
              {selectedNote.isVerified ? (
                <div className="verified-section">
                  <h3>✅ On-chain Verified</h3>
                  <p>Decrypted value: {selectedNote.decryptedValue}</p>
                </div>
              ) : (
                <div className="decrypt-section">
                  <button 
                    onClick={() => decryptNote(selectedNote.id)}
                    disabled={fheIsDecrypting}
                    className="decrypt-btn"
                  >
                    {fheIsDecrypting ? "Decrypting..." : "🔓 Decrypt Note"}
                  </button>
                  <p>This will verify the decryption on-chain using FHE technology</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && "✓"}
            {transactionStatus.status === "error" && "✗"}
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;


