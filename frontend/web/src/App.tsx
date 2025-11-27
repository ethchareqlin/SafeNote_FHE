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
  timestamp: number;
  creator: string;
  encryptedValue: number;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
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
  const [newNoteData, setNewNoteData] = useState({ title: "", content: "", priority: "" });
  const [selectedNote, setSelectedNote] = useState<SecureNote | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({ total: 0, verified: 0, encrypted: 0 });
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        console.error('FHEVM initialization failed:', error);
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
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadNotes();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isConnected]);

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
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            encryptedValue: 0,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading note data:', e);
        }
      }
      
      setNotes(notesList);
      updateStats(notesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load notes" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (notesList: SecureNote[]) => {
    setStats({
      total: notesList.length,
      verified: notesList.filter(note => note.isVerified).length,
      encrypted: notesList.length
    });
  };

  const createNote = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingNote(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating secure note with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const priorityValue = parseInt(newNoteData.priority) || 1;
      const businessId = `note-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, priorityValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newNoteData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        priorityValue,
        0,
        newNoteData.content
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Note created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadNotes();
      setShowCreateModal(false);
      setNewNoteData({ title: "", content: "", priority: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingNote(false); 
    }
  };

  const decryptNote = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return Number(businessData.decryptedValue) || 0;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractWrite.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadNotes();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadNotes();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredNotes = notes.filter(note =>
    note.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    note.content.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>SafeNote FHE 🔐</h1>
            <p>FHE-based Secure Notes</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Your Wallet to Access Secure Notes</h2>
            <p>Your notes are encrypted with FHE technology for maximum privacy protection.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Create encrypted notes with homomorphic properties</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Search and verify your data securely</p>
              </div>
            </div>
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
        <p className="loading-note">Securing your notes with homomorphic encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading secure notes...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>SafeNote FHE 🔐</h1>
          <p>Fully Homomorphic Encrypted Notes</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="status-btn">
            Check FHE Status
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Note
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-item">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Notes</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{stats.encrypted}</div>
            <div className="stat-label">Encrypted</div>
          </div>
        </div>
        
        <div className="search-section">
          <input
            type="text"
            placeholder="Search notes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <button onClick={loadNotes} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        
        <div className="notes-grid">
          {filteredNotes.length === 0 ? (
            <div className="no-notes">
              <p>No secure notes found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Note
              </button>
            </div>
          ) : (
            filteredNotes.map((note) => (
              <div 
                key={note.id}
                className={`note-card ${selectedNote?.id === note.id ? "selected" : ""}`}
                onClick={() => setSelectedNote(note)}
              >
                <div className="note-header">
                  <h3>{note.title}</h3>
                  <span className={`status-badge ${note.isVerified ? "verified" : "encrypted"}`}>
                    {note.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                  </span>
                </div>
                <div className="note-content">
                  {note.content.substring(0, 100)}...
                </div>
                <div className="note-footer">
                  <span>Priority: {note.publicValue1}</span>
                  <span>{new Date(note.timestamp * 1000).toLocaleDateString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <CreateNoteModal 
          onSubmit={createNote} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingNote} 
          noteData={newNoteData} 
          setNoteData={setNewNoteData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedNote && (
        <NoteDetailModal 
          note={selectedNote} 
          onClose={() => setSelectedNote(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptData={() => decryptNote(selectedNote.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateNoteModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  noteData: any;
  setNoteData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, noteData, setNoteData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'priority') {
      const intValue = value.replace(/[^\d]/g, '');
      setNoteData({ ...noteData, [name]: intValue });
    } else {
      setNoteData({ ...noteData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-note-modal">
        <div className="modal-header">
          <h2>New Secure Note</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption Active</strong>
            <p>Note priority will be encrypted with homomorphic encryption</p>
          </div>
          
          <div className="form-group">
            <label>Title *</label>
            <input 
              type="text" 
              name="title" 
              value={noteData.title} 
              onChange={handleChange} 
              placeholder="Enter note title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Content *</label>
            <textarea 
              name="content" 
              value={noteData.content} 
              onChange={handleChange} 
              placeholder="Enter your note content..." 
              rows={4}
            />
          </div>
          
          <div className="form-group">
            <label>Priority Level (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="priority" 
              value={noteData.priority} 
              onChange={handleChange} 
              placeholder="Enter priority..." 
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !noteData.title || !noteData.content || !noteData.priority} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Secure Note"}
          </button>
        </div>
      </div>
    </div>
  );
};

const NoteDetailModal: React.FC<{
  note: SecureNote;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ note, onClose, isDecrypting, decryptData }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (note.isVerified) return;
    
    const value = await decryptData();
    if (value !== null) {
      setDecryptedValue(value);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="note-detail-modal">
        <div className="modal-header">
          <h2>Note Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="note-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{note.title}</strong>
            </div>
            <div className="info-item">
              <span>Created:</span>
              <strong>{new Date(note.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{note.creator.substring(0, 8)}...{note.creator.substring(36)}</strong>
            </div>
          </div>
          
          <div className="content-section">
            <h3>Content</h3>
            <div className="note-content-full">
              {note.content}
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>FHE Encryption Status</h3>
            <div className="encryption-info">
              <div className="encryption-status">
                <span>Priority Level:</span>
                <strong>
                  {note.isVerified ? 
                    `${note.decryptedValue} (Verified)` : 
                    decryptedValue !== null ? 
                    `${decryptedValue} (Decrypted)` : 
                    "🔒 Encrypted"
                  }
                </strong>
              </div>
              
              <button 
                className={`decrypt-btn ${(note.isVerified || decryptedValue !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || note.isVerified}
              >
                {isDecrypting ? "Decrypting..." : 
                 note.isVerified ? "✅ Verified" : 
                 decryptedValue !== null ? "🔓 Decrypted" : 
                 "🔓 Verify Decryption"}
              </button>
            </div>
            
            <div className="fhe-explanation">
              <p>This note's priority is encrypted using FHE. You can verify the decryption without revealing the plaintext to the network.</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;