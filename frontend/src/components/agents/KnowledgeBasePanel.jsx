import { useState, useEffect, useCallback } from 'react';
import { Trash2, Upload, FileText, AlertCircle, CheckCircle2, Clock, RefreshCw, FileCheck } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT } from '../../constants.js';

export default function KnowledgeBasePanel({ bases, onChanged }) {
  const [name, setName] = useState('');
  const [sector, setSector] = useState('');
  const [selected, setSelected] = useState('');
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [documents, setDocuments] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState({ type: '', text: '' });
  const [deletingId, setDeletingId] = useState(null);

  // Auto-select the first base if none selected
  useEffect(() => {
    if (!selected && bases && bases.length > 0) {
      setSelected(String(bases[0].id));
    }
  }, [bases, selected]);

  const loadDocuments = useCallback(async (baseId) => {
    if (!baseId) {
      setDocuments([]);
      return;
    }
    setLoadingDocs(true);
    try {
      const list = await api.knowledgeBases.documents(baseId);
      setDocuments(list || []);
    } catch (e) {
      console.error('[KnowledgeBasePanel] fetch docs:', e.message);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    if (selected) {
      loadDocuments(selected);
    }
  }, [selected, loadDocuments]);

  const handleCreate = async () => {
    if (!name.trim()) return setNotice({ type: 'error', text: 'Enter a knowledge base name.' });
    setBusy(true);
    setNotice({ type: '', text: '' });
    try {
      const b = await api.knowledgeBases.create({ name: name.trim(), sector: sector.trim() || 'General' });
      setSelected(String(b.id));
      setName('');
      setSector('');
      setNotice({ type: 'success', text: 'Knowledge base created successfully.' });
      if (onChanged) await onChanged();
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const handleUpload = async () => {
    if (!selected) return setNotice({ type: 'error', text: 'Please select a knowledge base first.' });
    if (!file) return setNotice({ type: 'error', text: 'Choose a document to upload.' });
    setBusy(true);
    setNotice({ type: '', text: '' });
    try {
      const d = await api.knowledgeBases.upload(selected, file, title.trim());
      setFile(null);
      setTitle('');
      if (d.status === 'ready') {
        setNotice({ type: 'success', text: `Document processed successfully into ${d.chunk_count} approved sections.` });
      } else {
        setNotice({ type: 'error', text: `Document processing failed: ${d.error_message || d.status}` });
      }
      await loadDocuments(selected);
      if (onChanged) await onChanged();
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteDoc = async (docId) => {
    if (!selected || !docId) return;
    setDeletingId(docId);
    try {
      await api.knowledgeBases.removeDocument(selected, docId);
      setNotice({ type: 'success', text: 'Document removed from knowledge base.' });
      await loadDocuments(selected);
      if (onChanged) await onChanged();
    } catch (e) {
      setNotice({ type: 'error', text: e.message });
    } finally {
      setDeletingId(null);
    }
  };

  const currentBase = bases.find(b => String(b.id) === String(selected));

  return (
    <div style={{ marginTop: 16, padding: 18, border: `1px solid ${C.border}`, borderRadius: 12, background: '#FFFFFF', fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileCheck size={16} color={C.primary} /> Knowledge libraries
          </div>
          <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
            Upload approved product, pricing, policy, and process documents for your team.
          </div>
        </div>
      </div>

      {notice.text && (
        <div style={{
          padding: '9px 13px',
          borderRadius: 8,
          marginBottom: 14,
          fontSize: 12,
          fontWeight: 500,
          background: notice.type === 'error' ? '#FCEBEB' : '#E6F4EA',
          color: notice.type === 'error' ? '#A32D2D' : '#137333',
          border: `1px solid ${notice.type === 'error' ? '#FBC8C8' : '#CEEAD6'}`,
          display: 'flex',
          alignItems: 'center',
          gap: 6
        }}>
          {notice.type === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
          {notice.text}
        </div>
      )}

      {/* Create Base Section */}
      <div style={{ padding: 12, borderRadius: 8, background: '#F8F9FA', border: `1px solid ${C.border}`, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
          Create knowledge base
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Knowledge library name (e.g. Product Guide)"
            style={smallInput}
          />
          <input
            value={sector}
            onChange={e => setSector(e.target.value)}
            placeholder="Topic (e.g. Admissions, Support)"
            style={{ ...smallInput, maxWidth: 180 }}
          />
          <button onClick={handleCreate} disabled={busy} style={btnPrimary}>
            {busy ? 'Creating…' : 'Create Library'}
          </button>
        </div>
      </div>

      {/* Document Upload & Selector */}
      <div style={{ padding: 12, borderRadius: 8, background: '#F8F9FA', border: `1px solid ${C.border}`, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
          Upload Approved Document
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <select value={selected} onChange={e => setSelected(e.target.value)} style={{ ...smallInput, flex: '1 1 200px' }}>
            <option value="">Select Knowledge Library</option>
            {bases.map(b => (
              <option key={b.id} value={b.id}>
                {b.sector} · {b.name} ({b.readyDocumentCount || 0} ready docs)
              </option>
            ))}
          </select>

          <input
            type="file"
            accept=".pdf,.docx,.txt,.md,.csv,.xlsx"
            onChange={e => setFile(e.target.files?.[0] || null)}
            style={{ fontSize: 12, flex: '1 1 200px' }}
          />

          <button onClick={handleUpload} disabled={busy || !selected || !file} style={btnUpload}>
            <Upload size={13} style={{ marginRight: 4 }} />
            {busy ? 'Indexing…' : 'Upload & Index'}
          </button>
        </div>

        <div style={{ fontSize: 11, color: C.textMuted, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span>📄 Supported formats: PDF, DOCX, TXT, Markdown, CSV, XLSX</span>
          <span>⚠️ Scanned image PDFs require OCR text extraction before uploading.</span>
        </div>
      </div>

      {/* Document List */}
      {selected && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
              Documents in {currentBase ? `"${currentBase.name}" (${currentBase.sector})` : 'Selected Library'}
            </div>
            <button onClick={() => loadDocuments(selected)} disabled={loadingDocs} style={btnGhost}>
              <RefreshCw size={12} style={{ animation: loadingDocs ? 'spin 1s linear infinite' : 'none' }} /> Refresh
            </button>
          </div>

          {loadingDocs ? (
            <div style={{ padding: '16px 0', fontSize: 12, color: C.textMuted, textAlign: 'center' }}>Loading documents…</div>
          ) : documents.length === 0 ? (
            <div style={{ padding: 18, border: `1px dashed ${C.border}`, borderRadius: 8, textAlign: 'center', color: C.textMuted, fontSize: 12 }}>
              No approved documents uploaded yet for this sector library.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {documents.map(d => (
                <div key={d.id} style={docRow}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                    <FileText size={16} color={C.textMuted} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                        {d.title || d.original_name}
                      </div>
                      <div style={{ fontSize: 11, color: C.textMuted, display: 'flex', gap: 8 }}>
                        <span>{d.chunk_count || 0} indexed sections</span>
                        <span>•</span>
                        <span>{d.created_at ? new Date(d.created_at).toLocaleDateString() : ''}</span>
                      </div>
                      {d.error_message && (
                        <div style={{ fontSize: 11, color: '#A32D2D', marginTop: 2 }}>{d.error_message}</div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <StatusBadge status={d.status} />
                    <button
                      onClick={() => handleDeleteDoc(d.id)}
                      disabled={deletingId === d.id}
                      title="Delete document"
                      style={btnDelete}
                    >
                      <Trash2 size={13} color="#A32D2D" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  if (status === 'ready') {
    return (
      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 12, background: '#E6F4EA', color: '#137333', display: 'flex', alignItems: 'center', gap: 4 }}>
        <CheckCircle2 size={11} /> Ready
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 12, background: '#FCEBEB', color: '#A32D2D', display: 'flex', alignItems: 'center', gap: 4 }}>
        <AlertCircle size={11} /> Failed
      </span>
    );
  }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 12, background: '#FEF7E0', color: '#B06000', display: 'flex', alignItems: 'center', gap: 4 }}>
      <Clock size={11} /> Processing
    </span>
  );
}

const smallInput = {
  flex: '1 1 180px',
  padding: '8px 10px',
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  fontSize: 12,
  background: '#FFFFFF',
  outline: 'none',
};

const btnPrimary = {
  padding: '8px 12px',
  border: 0,
  borderRadius: 6,
  background: '#E52A2A',
  color: '#FFFFFF',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const btnUpload = {
  padding: '8px 12px',
  border: 0,
  borderRadius: 6,
  background: '#1F2937',
  color: '#FFFFFF',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  whiteSpace: 'nowrap',
};

const btnGhost = {
  background: 'none',
  border: 0,
  color: C.textMuted,
  fontSize: 11,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const btnDelete = {
  background: '#FCEBEB',
  border: '1px solid #FBC8C8',
  borderRadius: 6,
  padding: '5px 7px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const docRow = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 12px',
  borderRadius: 8,
  background: '#FFFFFF',
  border: `1px solid ${C.border}`,
  gap: 12,
};
