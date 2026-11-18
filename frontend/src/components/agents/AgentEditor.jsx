import { useState, useEffect, useCallback } from 'react';
import { Save, Trash2, Loader2, AlertCircle, CheckCircle2, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT, MONO } from '../../constants.js';
import DeleteConfirmModal from '../DeleteConfirmModal.jsx';
import SearchableSelect from '../SearchableSelect.jsx';
import InfoDot from '../InfoDot.jsx';
import AgentToolsList from './AgentToolsList.jsx';
import AgentRunsViewer from './AgentRunsViewer.jsx';
import AgentLivePreview from './AgentLivePreview.jsx';
import AgentMediaGroups from './AgentMediaGroups.jsx';
import KnowledgeBasePanel from './KnowledgeBasePanel.jsx';
import { modelsForProvider, providerDisplay } from './modelCatalog.js';

const BLANK = {
  name: '',
  description: '',
  systemPrompt: 'You are a helpful WhatsApp assistant. Keep replies concise.',
  aiModelId: '',
  llmModel: '',
  waAccountId: '',
  isActive: false,
  contextWindowMessages: 20,
  maxToolIterations: 6,
  transcribeAudio: false,
  triggerMode: 'any',
  triggerKeyword: '',
  triggerMatchType: 'contains',
  triggerCaseSensitive: false,
  triggerSessionMinutes: 30,
  mediaGroups: [],
  knowledgeBaseId: '', groundingMode: 'strict', retrievalMinScore: 0.7, retrievalMaxChunks: 5,
  defaultConsultantUserId: '', handoverMessage: 'Thank you. This needs a specialist review, so I am connecting you with our team. You can call {{consultant_phone}} for immediate assistance.',
  humanHandoverEnabled: true,
};

export default function AgentEditor({ agentId, waAccounts, user, navigate, onDone, onCancel }) {
  const isCreate = agentId == null;
  const [form, setForm] = useState(BLANK);
  const [aiModels, setAiModels] = useState([]);
  const [tools, setTools] = useState([]);
  const [knowledgeBases, setKnowledgeBases] = useState([]);
  const [teammates, setTeammates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingLive, setTogglingLive] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [models, a, bases, people] = await Promise.all([
        api.aiModels.list().catch(() => []),
        isCreate ? Promise.resolve(null) : api.agents.get(agentId),
        api.knowledgeBases.list().catch(() => []),
        api.users.list().catch(() => []),
      ]);
      setAiModels(models);
      setKnowledgeBases(bases); setTeammates(people.filter(p => p.isActive));
      if (a) {
        setForm({
          name: a.name || '',
          description: a.description || '',
          systemPrompt: a.systemPrompt || '',
          aiModelId: a.aiModelId ? String(a.aiModelId) : '',
          aiProvider: a.aiProvider || '',
          llmModel: a.llmModel || '',
          waAccountId: a.waAccountId || '',
          isActive: !!a.isActive,
          contextWindowMessages: a.contextWindowMessages || 20,
          maxToolIterations: a.maxToolIterations || 6,
          transcribeAudio: !!a.transcribeAudio,
          triggerMode: a.triggerMode || 'any',
          triggerKeyword: a.triggerKeyword || '',
          triggerMatchType: a.triggerMatchType || 'contains',
          triggerCaseSensitive: !!a.triggerCaseSensitive,
          triggerSessionMinutes: a.triggerSessionMinutes || 30,
          mediaGroups: Array.isArray(a.mediaGroups) ? a.mediaGroups : [],
          knowledgeBaseId: a.knowledgeBaseId ? String(a.knowledgeBaseId) : '', groundingMode: a.groundingMode || 'strict', retrievalMinScore: a.retrievalMinScore || 0.7, retrievalMaxChunks: a.retrievalMaxChunks || 5,
          defaultConsultantUserId: a.defaultConsultantUserId ? String(a.defaultConsultantUserId) : '', handoverMessage: a.handoverMessage || BLANK.handoverMessage,
          humanHandoverEnabled: a.humanHandoverEnabled !== false,
        });
        setTools(a.tools || []);
      }
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setLoading(false);
    }
  }, [agentId, isCreate]);

  useEffect(() => { refresh(); }, [refresh]);

  // Prefer the live registry row; fall back to the binding loaded with the
  // agent so an already-bound agent still renders its model even if the
  // registry list is momentarily empty (failed fetch) — without that fallback
  // the editor would show the "not integrated" card and a save would silently
  // demote a working agent to a draft.
  const selectedModelRow = aiModels.find(m => String(m.id) === String(form.aiModelId))
    || (form.aiModelId && form.aiProvider ? { id: form.aiModelId, provider: form.aiProvider, label: null } : null);
  const modelOptions = modelsForProvider(selectedModelRow?.provider);
  const hasModelSelected = !!(form.aiModelId && form.llmModel);
  // Only treat the workspace as "no provider connected" when the registry is
  // genuinely empty AND this agent isn't already bound to one.
  const showNotIntegrated = aiModels.length === 0 && !form.aiModelId;
  // Registry rows to offer, always including the agent's current binding.
  const modelRowOptions = (selectedModelRow && !aiModels.some(m => String(m.id) === String(selectedModelRow.id)))
    ? [...aiModels, selectedModelRow]
    : aiModels;

  // When the registry credential changes, snap the model dropdown to the first
  // model of that provider (the previously-selected model may belong to the
  // other provider).
  const setAiModelId = (id) => {
    const row = aiModels.find(m => String(m.id) === String(id));
    const first = modelsForProvider(row?.provider)[0]?.value || '';
    setForm(f => ({ ...f, aiModelId: id, llmModel: first }));
  };

  // Build the create/update payload from the form. `status` is derived: an
  // agent with a model fully chosen is 'active' (can be toggled on); otherwise
  // it's saved as a 'draft'.
  const buildPayload = (overrides = {}) => {
    const complete = !!(form.aiModelId && form.llmModel);
    const status = overrides.status || (complete ? 'active' : 'draft');
    return {
      name: form.name,
      description: form.description,
      systemPrompt: form.systemPrompt,
      aiModelId: form.aiModelId || null,
      llmModel: form.llmModel || null,
      status,
      waAccountId: form.waAccountId || null,
      isActive: status === 'active' ? form.isActive : false,
      contextWindowMessages: form.contextWindowMessages,
      maxToolIterations: form.maxToolIterations,
      transcribeAudio: form.transcribeAudio,
      triggerMode: form.triggerMode,
      triggerKeyword: form.triggerKeyword,
      triggerMatchType: form.triggerMatchType,
      triggerCaseSensitive: form.triggerCaseSensitive,
      triggerSessionMinutes: form.triggerSessionMinutes,
      mediaGroups: form.mediaGroups,
      knowledgeBaseId: form.knowledgeBaseId || null, groundingMode: form.groundingMode, retrievalMinScore: form.retrievalMinScore, retrievalMaxChunks: form.retrievalMaxChunks,
      defaultConsultantUserId: form.defaultConsultantUserId || null, handoverMessage: form.handoverMessage,
      humanHandoverEnabled: form.humanHandoverEnabled,
      ...overrides,
    };
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = buildPayload();
      if (isCreate) {
        const created = await api.agents.create(payload);
        onDone(created.id);
      } else {
        await api.agents.update(agentId, payload);
        onDone(agentId);
      }
    } catch (e) {
      setError(prettyError(e));
      setSaving(false);
    }
  };

  // "Go Live": activate (or deactivate) the agent from the header. Activating
  // does a full save first so the current config is persisted AND live in one
  // step; it needs a chosen model. Multiple agents can be live on the same
  // number at once (keyword agents alongside a catch-all).
  const handleToggleLive = async () => {
    const next = !form.isActive;
    if (next && !hasModelSelected) {
      setError('Connect an AI model and pick a model before going live.');
      return;
    }
    setTogglingLive(true);
    setError('');
    try {
      await api.agents.update(agentId, buildPayload({ isActive: next }));
      setForm(f => ({ ...f, isActive: next }));
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setTogglingLive(false);
    }
  };

  // "Go to Integrations": persist whatever the operator has entered as a draft
  // so nothing is lost, then jump to Integrations → AI Models to connect a
  // provider key. On return they reopen the draft and finish it.
  const handleGoToIntegrations = async () => {
    if (!navigate) return;
    setSaving(true);
    setError('');
    try {
      const payload = buildPayload({ status: 'draft', isActive: false });
      if (!payload.name?.trim()) payload.name = 'Untitled agent';
      if (isCreate) await api.agents.create(payload);
      else await api.agents.update(agentId, payload);
      navigate('admin-settings', 'integrations', 'ai-models');
    } catch (e) {
      setError(prettyError(e));
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.agents.delete(agentId);
      setPendingDelete(false);
      onDone();
    } catch (e) {
      setError(prettyError(e));
      setPendingDelete(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 8, color: C.textMuted, fontSize: 13 }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading…
      </div>
    );
  }

  const isAdmin = user?.role === 'admin';

  return (
    <div style={{ padding: '24px 24px 80px', width: '100%', boxSizing: 'border-box', fontFamily: FONT }}>
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 16,
          background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Header — agent name + live status, with a Go Live / deactivate toggle. */}
      {!isCreate && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text, letterSpacing: '-.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {form.name || 'Agent'}
            </div>
            <div style={{ fontSize: 12, color: form.isActive ? '#0F6E56' : C.textMuted, fontWeight: 600, marginTop: 2 }}>
              {form.isActive ? '● Live — answering WhatsApp messages' : 'Inactive — not answering messages'}
            </div>
          </div>
          <button
            type="button"
            onClick={handleToggleLive}
            disabled={togglingLive || (!form.isActive && !hasModelSelected)}
            title={!form.isActive && !hasModelSelected ? 'Connect & pick an AI model first' : (form.isActive ? 'Deactivate this agent' : 'Activate this agent')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '10px 20px', borderRadius: 99,
              border: form.isActive ? '1.5px solid #1D9E75' : 'none',
              background: form.isActive ? '#E1F5EE' : '#1D9E75',
              color: form.isActive ? '#0F6E56' : '#fff',
              fontSize: 13.5, fontFamily: FONT, fontWeight: 700, whiteSpace: 'nowrap',
              cursor: (togglingLive || (!form.isActive && !hasModelSelected)) ? 'not-allowed' : 'pointer',
              opacity: (togglingLive || (!form.isActive && !hasModelSelected)) ? 0.6 : 1,
            }}
          >
            {togglingLive
              ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
              : <span style={{ width: 8, height: 8, borderRadius: 99, background: form.isActive ? '#1D9E75' : '#fff' }} />}
            {togglingLive ? 'Saving…' : (form.isActive ? 'Live' : 'Go Live')}
          </button>
        </div>
      )}

      {/* Two columns: form on the left, a fixed-size, sticky live phone preview
          on the right that stays visible while the form scrolls. */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* LEFT — configuration form */}
        <div style={{ flex: '1 1 460px', minWidth: 0 }}>

      <Section title="Identity">
        <FieldRow>
          <Field label="Name *" info="Shown in the agents list. Just a label for you — the customer never sees it.">
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Booking Assistant" style={inputStyle} />
          </Field>
          <Field label="Description" info="An optional note about what this agent does. For your reference only.">
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What does this agent do?" style={inputStyle} />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="WhatsApp account" info="The number the agent answers on. You can have multiple active agents on the same number — a keyword agent takes priority over a catch-all agent. Media the agent sends is read from this number's Media Library.">
            <SearchableSelect
              value={form.waAccountId || ''}
              onChange={(val) => setForm(f => ({ ...f, waAccountId: val }))}
              placeholder="— None —"
              searchPlaceholder="Search accounts…"
              options={[{ value: '', label: '— None —' }, ...waAccounts.map(w => ({ value: String(w.id), label: `${w.displayName}${w.displayPhoneNumber ? ` (+${w.displayPhoneNumber})` : ''}` }))]}
            />
          </Field>
        </FieldRow>
      </Section>

      {/* Advanced settings — a hyperlink tucked under Identity that expands a
          dropdown panel (intentionally not a full section card). */}
      <div style={{ marginTop: -16, marginBottom: 28, paddingLeft: 2 }}>
        <button
          type="button"
          onClick={() => setAdvancedOpen(o => !o)}
          style={{
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 13, fontFamily: FONT, fontWeight: 600, color: C.primary,
          }}
        >
          {advancedOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Advanced settings
        </button>
        {advancedOpen && (
          <div style={{ marginTop: 10, padding: '16px 20px', background: C.cardBg, borderRadius: 10, border: `1px solid ${C.border}` }}>
            <FieldRow>
              <Field label="Context window (messages)" info="How many recent messages from the chat are fed to the model on each turn. Higher = more memory, but costs more per reply.">
                <input type="number" min={1} max={100}
                  value={form.contextWindowMessages}
                  onChange={e => setForm(f => ({ ...f, contextWindowMessages: parseInt(e.target.value, 10) || 20 }))}
                  style={inputStyle} />
              </Field>
              <Field label="Max tool iterations" info="Hard cap on how many times the model can call a tool (Sheets, send media, …) while handling one message. Stops runaway loops.">
                <input type="number" min={1} max={20}
                  value={form.maxToolIterations}
                  onChange={e => setForm(f => ({ ...f, maxToolIterations: parseInt(e.target.value, 10) || 6 }))}
                  style={inputStyle} />
              </Field>
            </FieldRow>
            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 4, paddingTop: 14 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.transcribeAudio}
                  onChange={e => setForm(f => ({ ...f, transcribeAudio: e.target.checked }))}
                  style={{ width: 16, height: 16, marginTop: 2, cursor: 'pointer' }}
                />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 600, color: C.text }}>
                    Transcribe voice notes
                    <InfoDot text="When on, incoming WhatsApp voice notes are transcribed to text with OpenAI Whisper and handled like a typed message. Connect an OpenAI key in Integrations → AI Models first — it reuses that key." />
                  </div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
                    Needs an OpenAI key connected in Integrations → AI Models.
                  </div>
                </div>
              </label>
            </div>
          </div>
        )}
      </div>

      <Section title="Model" subtitle="Pick a connected AI provider, then the model to call. API keys live in Integrations → AI Models, not on the agent.">
        {showNotIntegrated ? (
          <NotIntegratedCard onGo={handleGoToIntegrations} saving={saving} canGo={!!navigate} />
        ) : (
          <>
            <FieldRow>
              <Field label="AI Model *" info="The connected provider credential (from Integrations → AI Models) this agent uses.">
                <SearchableSelect
                  value={form.aiModelId}
                  onChange={setAiModelId}
                  placeholder="— Select —"
                  searchPlaceholder="Search providers…"
                  options={modelRowOptions.map(m => ({ value: String(m.id), label: providerDisplay(m.provider, m.label) }))}
                />
              </Field>
            </FieldRow>
            {selectedModelRow && (
              <FieldRow>
                <Field label="Model *">
                  <SearchableSelect
                    value={form.llmModel}
                    onChange={(val) => setForm(f => ({ ...f, llmModel: val }))}
                    placeholder="— Select —"
                    options={modelOptions.map(m => ({ value: m.value, label: m.label }))}
                  />
                </Field>
              </FieldRow>
            )}
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>
              Need another provider?{' '}
              <a
                href="#/admin-settings/integrations/ai-models"
                onClick={(e) => { if (navigate) { e.preventDefault(); handleGoToIntegrations(); } }}
                style={{ color: C.primary, fontWeight: 600, textDecoration: 'none' }}
              >
                Manage AI Models <ExternalLink size={10} style={{ verticalAlign: 'middle' }} />
              </a>
            </div>
          </>
        )}
      </Section>

      <Section title="Trigger">
        <TriggerConfig form={form} setForm={setForm} />
      </Section>

      <Section title="Behavior" subtitle="The agent uses this as its system prompt on every turn.">
        <textarea
          value={form.systemPrompt}
          onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
          rows={8}
          placeholder="You are a helpful WhatsApp assistant..."
          style={{ ...inputStyle, fontFamily: MONO, fontSize: 13, lineHeight: 1.5, resize: 'vertical', minHeight: 140 }}
        />
      </Section>

      <Section title="Approved knowledge" subtitle="Choose the sector knowledge this assistant is allowed to use. In strict mode, no matching approved material means the chat is handed to a person automatically.">
        <FieldRow>
          <Field label="Knowledge base" info="Create a shared knowledge base for each topic. Multiple agents can use the same approved documents.">
            <SearchableSelect
              value={form.knowledgeBaseId}
              onChange={v => setForm(f => ({ ...f, knowledgeBaseId: v }))}
              placeholder="— Select approved knowledge —"
              options={[
                { value: '', label: '— No knowledge base —' },
                ...knowledgeBases.filter(b => b.isActive).map(b => ({
                  value: String(b.id),
                  label: `${b.sector} · ${b.name} (${b.readyDocumentCount || 0}/${b.documentCount || 0} ready docs)`,
                })),
              ]}
            />
          </Field>
          <Field label="Answer policy" info="Strict is recommended for high-stakes information. Assistive lets the agent respond from its prompt if no document matches.">
            <select
              value={form.groundingMode}
              onChange={e => setForm(f => ({ ...f, groundingMode: e.target.value }))}
              style={inputStyle}
            >
              <option value="strict">Strict — hand over when knowledge is missing</option>
              <option value="assistive">Assistive — use prompt when knowledge is missing</option>
            </select>
          </Field>
        </FieldRow>

        <FieldRow>
          <Field label="Match threshold" info="Higher values (e.g. 0.75) demand a closer match before the AI replies. Keep 0.70 as a starting point.">
            <input
              type="number"
              min="0.1"
              max="0.99"
              step="0.05"
              value={form.retrievalMinScore}
              onChange={e => setForm(f => ({ ...f, retrievalMinScore: parseFloat(e.target.value) || 0.70 }))}
              style={inputStyle}
            />
          </Field>
          <Field label="Maximum source sections" info="Cap on how many knowledge chunks to include in the grounded prompt.">
            <input
              type="number"
              min="1"
              max="10"
              value={form.retrievalMaxChunks}
              onChange={e => setForm(f => ({ ...f, retrievalMaxChunks: parseInt(e.target.value, 10) || 5 }))}
              style={inputStyle}
            />
          </Field>
        </FieldRow>

        {form.groundingMode === 'strict' && form.knowledgeBaseId && (() => {
          const selKb = knowledgeBases.find(b => String(b.id) === String(form.knowledgeBaseId));
          if (selKb && (selKb.readyDocumentCount || 0) === 0) {
            return (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#FEF7E0', border: '1px solid #FCE4A6', color: '#B06000', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertCircle size={14} /> Strict mode is active, but this knowledge base has 0 ready documents. Incoming messages will trigger an immediate human handover until documents are uploaded and indexed.
              </div>
            );
          }
          return null;
        })()}

        <KnowledgeBasePanel bases={knowledgeBases} onChanged={refresh} />
      </Section>

      <Section title="Human handover" subtitle="When the AI cannot use approved knowledge or the customer needs a specialist, it pauses itself, assigns this person and gives the customer a call number.">
        {/* Master on/off. When off, the agent never transfers to a human and
            handles the whole conversation itself. */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '12px 14px', marginBottom: 16, borderRadius: 10,
          background: form.humanHandoverEnabled ? '#E6F4EA' : '#F2F2EC',
          border: `1px solid ${form.humanHandoverEnabled ? '#CEEAD6' : C.border}`,
        }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>Allow handover to a human</div>
            <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
              {form.humanHandoverEnabled
                ? 'The AI can transfer a chat to the specialist below when needed.'
                : 'The AI will never transfer chats — it answers every message itself.'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, humanHandoverEnabled: !f.humanHandoverEnabled }))}
            style={{
              width: 44, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer',
              background: form.humanHandoverEnabled ? '#059669' : '#CBD5E1',
              position: 'relative', transition: 'background .15s', flexShrink: 0,
            }}
          >
            <span style={{ position: 'absolute', top: 3, left: form.humanHandoverEnabled ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
          </button>
        </div>

        {!form.humanHandoverEnabled ? (
          <div style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.5 }}>
            Handover is off, so the specialist and transfer-message settings don’t apply. Turn it on to route
            pricing/legal questions, complaints, or explicit “talk to a person” requests to a teammate.
          </div>
        ) : (
        <>
        <Field label="Default specialist" info="This person owns handovers for this sector. Their WhatsApp notification number is shown to the customer as the call number.">
          <SearchableSelect
            value={form.defaultConsultantUserId}
            onChange={v => setForm(f => ({ ...f, defaultConsultantUserId: v }))}
            placeholder="— Select a team member —"
            options={[
              { value: '', label: '— Use account fallback —' },
              ...teammates.map(p => ({
                value: String(p.id),
                label: `${p.displayName}${p.notifyWaNumber ? ` · +${p.notifyWaNumber}` : ' · ⚠️ no phone number set'}`,
              })),
            ]}
          />
        </Field>

        {form.defaultConsultantUserId && (() => {
          const selUser = teammates.find(p => String(p.id) === String(form.defaultConsultantUserId));
          if (selUser && !selUser.notifyWaNumber) {
            return (
              <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: '#FEF7E0', border: '1px solid #FCE4A6', color: '#B06000', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertCircle size={14} /> {selUser.displayName} has no phone number set in their user profile (Settings → Team). Customers will be transferred to them, but will receive a fallback message without a call number.
              </div>
            );
          }
          if (selUser && selUser.notifyWaNumber) {
            return (
              <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: '#E6F4EA', border: '1px solid #CEEAD6', color: '#137333', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={14} /> Customers will be instructed to call +{selUser.notifyWaNumber} when handed over to {selUser.displayName}.
              </div>
            );
          }
          return null;
        })()}

        <Field label="Customer handover message" info="Use {{consultant_phone}} exactly as written; the system replaces it with the selected specialist’s number.">
          <textarea
            value={form.handoverMessage}
            onChange={e => setForm(f => ({ ...f, handoverMessage: e.target.value }))}
            rows={3}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>
        </>
        )}
      </Section>


      <Section title="Media" subtitle="Give the agent files it can send during a chat. Each group has a description (when to send) and one or more media; the agent decides which group fits and sends all of its files.">
        <AgentMediaGroups
          waAccountId={form.waAccountId}
          value={form.mediaGroups}
          onChange={(groups) => setForm(f => ({ ...f, mediaGroups: groups }))}
        />
      </Section>

      {!isCreate && (
        <Section title="Tools" subtitle="Connect tools the agent can call mid-conversation — e.g. Google Sheets to read or write rows. More tool types are on the way.">
          <AgentToolsList agentId={agentId} tools={tools} onChange={refresh} />
        </Section>
      )}
      {isCreate && (
        <Section title="Tools" subtitle="Save the agent first, then attach tools.">
          <div style={{ padding: 16, background: C.surfaceAlt, borderRadius: 8, fontSize: 12, color: C.textSecondary }}>
            You'll be able to add tools after the initial save.
          </div>
        </Section>
      )}

      {!isCreate && <AgentRunsViewer agentId={agentId} />}

      <ActionBar
        isCreate={isCreate}
        saving={saving}
        onSave={handleSave}
        onCancel={onCancel}
        onDelete={isAdmin && !isCreate ? () => setPendingDelete(true) : null}
      />
        </div>

        {/* RIGHT — live test chat in a fixed-size phone, sticky while scrolling */}
        <div style={{
          flex: '0 0 300px', position: 'sticky', top: 24, alignSelf: 'flex-start',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: '#888', fontWeight: 700 }}>
            Live test chat
          </div>
          <AgentLivePreview
            agentId={isCreate ? null : agentId}
            headerTitle={form.name}
            canTest={!isCreate}
          />
          <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'center', lineHeight: 1.45, maxWidth: 260 }}>
            Chats here run the live model but aren’t sent to WhatsApp or saved to run history. Sheets tools hit the real spreadsheet.
          </div>
        </div>
      </div>

      <DeleteConfirmModal
        open={pendingDelete}
        title="Delete this agent?"
        message="This permanently removes the agent and its run history. WhatsApp messages to its bound number will fall back to keyword automations only."
        confirmText="Delete agent"
        onCancel={() => setPendingDelete(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

/* ---------- shared bits ---------- */

// Shown in the Model section when the workspace has no AI provider connected.
// "Go to Integrations" persists the in-progress agent as a draft first (handled
// by the caller) so nothing entered so far is lost.
function NotIntegratedCard({ onGo, saving, canGo }) {
  return (
    <div style={{
      padding: 18, borderRadius: 10, background: 'var(--c-surfaceAlt)',
      border: `1px dashed ${C.border}`, fontFamily: FONT,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, color: C.text, fontWeight: 700, fontSize: 13 }}>
        <AlertCircle size={15} color="#B45309" /> No AI model connected
      </div>
      <div style={{ fontSize: 12, color: C.textSecondary, lineHeight: 1.55, marginBottom: 14 }}>
        Agents need a connected <strong>Anthropic</strong> or <strong>OpenAI</strong> key. Connect one
        under <strong>Integrations → AI Models</strong>, then come back and pick it here.
        Your progress is saved as a draft when you go.
      </div>
      <button
        type="button"
        onClick={onGo}
        disabled={saving || !canGo}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '9px 14px', borderRadius: 8, border: 'none',
          background: C.primary, color: '#fff',
          fontSize: 13, fontFamily: FONT, fontWeight: 700,
          cursor: (saving || !canGo) ? 'not-allowed' : 'pointer',
          opacity: (saving || !canGo) ? 0.6 : 1,
        }}
      >
        {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <ExternalLink size={13} />}
        Save draft &amp; go to Integrations
      </button>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: `1px solid ${C.border}`, fontSize: 14, fontFamily: FONT,
  color: C.text, background: C.cardBg, outline: 'none',
  boxSizing: 'border-box',
};

function Section({ title, subtitle, children, rightSlot }) {
  return (
    <div style={{ marginBottom: 28, padding: 20, background: C.cardBg, borderRadius: 12, border: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: C.text, letterSpacing: '-.01em' }}>{title}</span>
          {subtitle && <InfoDot text={subtitle} width={260} />}
        </div>
        {rightSlot}
      </div>
      {children}
    </div>
  );
}

function FieldRow({ children }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

// Field-level description now lives in an info icon next to the label (`info`),
// not as a paragraph under the input.
function Field({ label, info, children }) {
  return (
    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, fontWeight: 700, color: C.textSecondary,
        textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
        <span>{label}</span>{info && <InfoDot text={info} />}
      </div>
      {children}
    </div>
  );
}

/* ---------- Trigger config ---------- */

// Mode toggle (Any message / Keyword) + keyword settings. Styled to the agent
// builder (pills + fields), not the automation flow-canvas node.
function TriggerConfig({ form, setForm }) {
  const set = (patch) => setForm(f => ({ ...f, ...patch }));
  const isKeyword = form.triggerMode === 'keyword';
  return (
    <div>
      <FieldRow>
        <Field label="When does it run?" info="Any message: the agent replies to every inbound on its number (that no keyword automation caught). Keyword: it only engages when a message matches — then it keeps replying to that contact's follow-ups for the session window below.">
          <div style={{ display: 'flex', gap: 8 }}>
            <Pill active={!isKeyword} onClick={() => set({ triggerMode: 'any' })}>Any message</Pill>
            <Pill active={isKeyword} onClick={() => set({ triggerMode: 'keyword' })}>Keyword</Pill>
          </div>
        </Field>
      </FieldRow>

      {isKeyword && (
        <>
          <FieldRow>
            <Field label="Keyword *" info="The word or phrase the contact must send to wake the agent up.">
              <input
                value={form.triggerKeyword}
                onChange={e => set({ triggerKeyword: e.target.value.slice(0, 200) })}
                placeholder="e.g. price, book, support"
                style={inputStyle}
              />
            </Field>
            <Field label="Match type" info="Exact: the whole message equals the keyword. Contains: the keyword appears anywhere. Starts with: the message begins with the keyword.">
              <div style={{ display: 'flex', gap: 8 }}>
                <Pill active={form.triggerMatchType === 'exact'} onClick={() => set({ triggerMatchType: 'exact' })}>Exact</Pill>
                <Pill active={form.triggerMatchType === 'contains'} onClick={() => set({ triggerMatchType: 'contains' })}>Contains</Pill>
                <Pill active={form.triggerMatchType === 'starts'} onClick={() => set({ triggerMatchType: 'starts' })}>Starts with</Pill>
              </div>
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Session window (minutes)" info="After the keyword engages the agent, it keeps handling that contact's messages for this long since their last message — so it can hold a back-and-forth without re-typing the keyword.">
              <input
                type="number" min={1} max={1440}
                value={form.triggerSessionMinutes}
                onChange={e => set({ triggerSessionMinutes: parseInt(e.target.value, 10) || 30 })}
                style={inputStyle}
              />
            </Field>
            <Field label="Case sensitive" info="When on, 'PRICE' and 'price' are treated as different. Usually leave this off.">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 42, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.triggerCaseSensitive}
                  onChange={e => set({ triggerCaseSensitive: e.target.checked })}
                  style={{ width: 16, height: 16, cursor: 'pointer' }} />
                <span style={{ fontSize: 13, color: C.text }}>Match exact letter case</span>
              </label>
            </Field>
          </FieldRow>
        </>
      )}
    </div>
  );
}

function Pill({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
        border: `1.5px solid ${active ? C.primary : C.border}`,
        background: active ? '#FEF1F1' : C.cardBg,
        color: active ? C.primary : C.text,
        fontSize: 13, fontFamily: FONT, fontWeight: active ? 700 : 500,
      }}>
      {children}
    </button>
  );
}

function ActionBar({ isCreate, saving, onSave, onCancel, onDelete }) {
  return (
    <div style={{
      position: 'sticky', bottom: 0, marginTop: 16,
      background: C.pageBg, padding: '14px 0',
      borderTop: `1px solid ${C.border}`,
      display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end',
    }}>
      {onDelete && (
        <button type="button" onClick={onDelete}
          style={{
            marginRight: 'auto',
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 14px', borderRadius: 8,
            border: '1px solid #FBC8C8', background: '#fff',
            color: C.primary, fontSize: 13, fontFamily: FONT, fontWeight: 600,
            cursor: 'pointer',
          }}>
          <Trash2 size={13} /> Delete
        </button>
      )}
      <button type="button" onClick={onCancel}
        style={{
          padding: '10px 14px', borderRadius: 8,
          border: `1px solid ${C.border}`, background: C.cardBg,
          color: C.text, fontSize: 13, fontFamily: FONT, fontWeight: 600,
          cursor: 'pointer',
        }}>
        Cancel
      </button>
      <button type="button" onClick={onSave} disabled={saving}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '10px 18px', borderRadius: 8,
          border: 'none', background: C.primary, color: '#fff',
          fontSize: 13, fontFamily: FONT, fontWeight: 700,
          cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
        }}>
        {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
        {isCreate ? 'Create agent' : 'Save changes'}
      </button>
    </div>
  );
}

function prettyError(e) {
  if (!e) return 'Unknown error';
  const msg = e.message || String(e);
  try {
    const m = msg.match(/^\d+\s+(.+)$/);
    if (m) {
      const body = JSON.parse(m[1]);
      if (body && body.error) return body.error;
    }
  } catch { /* fall through */ }
  return msg;
}
