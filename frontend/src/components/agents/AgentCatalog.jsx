import { useState, useEffect, useCallback } from 'react';
import {
  Bot, UserSearch, CalendarClock, FileText, BellRing, RotateCcw,
  Zap, IndianRupee, BarChart3, Loader2, Plus, Check, X, Sparkles, Settings2,
} from 'lucide-react';
import { api } from '../../api.js';
import { C, FONT, MONO } from '../../constants.js';
import CampaignConfigModal from './CampaignConfigModal.jsx';

// Which presets are configurable outbound campaigns (Phase 2 gated agents).
const CAMPAIGN_KINDS = new Set(['recovery', 'reactivation', 'collection']);

// Map a preset's icon name (from the backend catalog) to a lucide component.
const ICONS = {
  UserSearch, CalendarClock, FileText, BellRing, RotateCcw, Zap, IndianRupee, BarChart3,
};

const CATEGORY_LABEL = {
  inbound: 'Chat agent',
  proactive: 'Scheduled',
  analytics: 'Internal',
};

// Human-readable status chips per catalog status.
function statusChip(preset) {
  if (preset.installable) return null; // installable ones show an Install button instead
  const map = {
    worker: { bg: '#ECFDF5', color: '#065F46', label: 'Runs as worker' },
    gated: { bg: '#FEF3C7', color: '#92400E', label: 'Template-gated' },
    available: { bg: '#EEF2FF', color: '#3730A3', label: 'Available' },
  };
  return map[preset.status] || { bg: '#F2F2EC', color: C.textSecondary, label: 'Info' };
}

/**
 * Built-in agent catalog. Renders the 8 productised presets. Installable
 * (inbound) presets install as PAUSED draft agents and jump into the editor;
 * the rest show what they are and (for the Manager agent) a live report.
 */
export default function AgentCatalog({ onInstalled }) {
  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [configKind, setConfigKind] = useState(null);
  const [genOpen, setGenOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPresets(await api.agents.presets());
    } catch (e) {
      setError(e?.message || 'Failed to load catalog');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const install = async (preset) => {
    setInstalling(preset.key);
    setError('');
    try {
      const { agent } = await api.agents.installPreset(preset.key);
      await refresh();
      if (onInstalled && agent?.id) onInstalled(agent.id);
    } catch (e) {
      setError(e?.message || `Failed to install ${preset.name}`);
    } finally {
      setInstalling(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 8, color: C.textMuted, fontSize: 13 }}>
        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading catalog…
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Sparkles size={16} color={C.primary} />
        <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>Built-in agents</div>
      </div>
      <p style={{ fontSize: 12.5, color: C.textSecondary, margin: '0 0 18px', lineHeight: 1.55, maxWidth: 720 }}>
        Ready-made AI agents for your team workflow. Chat agents install <strong>paused</strong> — connect an
        AI model, bind a WhatsApp number, review the instructions, then activate. Outbound agents run on a schedule and
        need approved WhatsApp templates before they message customers.
      </p>

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 8, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* AI onboarding: generate agents tailored to this business */}
      <button
        onClick={() => setGenOpen(true)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left',
          padding: '15px 18px', marginBottom: 18, borderRadius: 12, cursor: 'pointer',
          background: C.headerBg, border: 'none', fontFamily: FONT,
        }}
      >
        <span style={{ width: 42, height: 42, borderRadius: 11, background: 'rgba(255,255,255,0.1)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Sparkles size={20} color="#fff" />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14.5, fontWeight: 800, color: '#fff' }}>Generate agents for my business</span>
          <span style={{ display: 'block', fontSize: 12.5, color: 'rgba(255,255,255,0.72)', marginTop: 2 }}>Let AI read your company profile and draft ready-to-use agents tailored to what you do.</span>
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#fff', background: C.primary, padding: '9px 15px', borderRadius: 8, flexShrink: 0 }}>
          <Sparkles size={14} /> Generate
        </span>
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {presets.map(p => (
          <Card
            key={p.key}
            preset={p}
            installing={installing === p.key}
            onInstall={() => install(p)}
            onManager={() => setManagerOpen(true)}
            onConfigure={() => setConfigKind(p.key)}
          />
        ))}
      </div>

      {managerOpen && <ManagerReportModal onClose={() => setManagerOpen(false)} />}
      {configKind && (
        <CampaignConfigModal kind={configKind} onClose={() => { setConfigKind(null); refresh(); }} />
      )}
      {genOpen && (
        <GenerateAgentsModal
          onClose={() => setGenOpen(false)}
          onInstalled={(firstId) => { setGenOpen(false); refresh(); if (onInstalled && firstId) onInstalled(firstId); }}
        />
      )}
    </div>
  );
}

// AI onboarding modal: generate business-specific agent drafts, review, install.
function GenerateAgentsModal({ onClose, onInstalled }) {
  const [phase, setPhase] = useState('intro'); // intro | loading | review | installing
  const [agents, setAgents] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  const generate = async () => {
    setPhase('loading'); setError('');
    try {
      const res = await api.agents.generate();
      setAgents(res.agents || []);
      setPicked(new Set((res.agents || []).map((_, i) => i)));
      setMeta({ modelUsed: res.modelUsed, company: res.company });
      setPhase('review');
    } catch (e) {
      setError(e?.message || 'Could not generate agents');
      setPhase('intro');
    }
  };

  const toggle = (i) => setPicked(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const install = async () => {
    const chosen = agents.filter((_, i) => picked.has(i));
    if (chosen.length === 0) { setError('Select at least one agent.'); return; }
    setPhase('installing'); setError('');
    try {
      const { created } = await api.agents.installGenerated(chosen);
      onInstalled(created?.[0]?.id || null);
    } catch (e) {
      setError(e?.message || 'Could not install agents');
      setPhase('review');
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 620, maxHeight: '86vh', display: 'flex', flexDirection: 'column', background: C.cardBg, borderRadius: 16, border: `1px solid ${C.border}`, boxShadow: C.shadowMd, fontFamily: FONT, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Sparkles size={17} color={C.primary} />
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>Generate agents for your business</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, display: 'flex' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto' }}>
          {error && <div style={{ padding: '10px 14px', marginBottom: 14, borderRadius: 8, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 13 }}>{error}</div>}

          {phase === 'intro' && (
            <div style={{ fontSize: 13.5, color: C.textSecondary, lineHeight: 1.6 }}>
              <p style={{ marginTop: 0 }}>The AI will read your <strong>company profile</strong> (from Venture Setup) and your products/services, then draft a set of WhatsApp agents tailored to your business — with instructions that represent you accurately.</p>
              <p>They’re created <strong>paused</strong>, so you review and activate each one yourself. You’ll need an AI model connected under Settings → Integrations.</p>
            </div>
          )}
          {phase === 'loading' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '36px 0', color: C.textMuted }}>
              <Loader2 size={22} style={{ animation: 'spin 1s linear infinite', color: C.primary }} />
              <div style={{ fontSize: 13 }}>Designing agents for your business…</div>
            </div>
          )}
          {(phase === 'review' || phase === 'installing') && (
            <>
              {meta && <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12, fontFamily: MONO }}>For {meta.company} · {meta.modelUsed}</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {agents.map((a, i) => (
                  <div key={i} style={{ border: `1px solid ${picked.has(i) ? C.primary : C.border}`, borderRadius: 12, padding: '12px 14px', background: picked.has(i) ? '#FEF6F6' : C.cardBg }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} style={{ marginTop: 3, cursor: 'pointer' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{a.name}</div>
                        <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 2, lineHeight: 1.45 }}>{a.description}</div>
                        <button onClick={() => setExpanded(expanded === i ? null : i)} style={{ background: 'none', border: 'none', color: C.primary, cursor: 'pointer', fontSize: 11.5, fontWeight: 600, padding: 0, marginTop: 6 }}>
                          {expanded === i ? 'Hide instructions' : 'View instructions'}
                        </button>
                        {expanded === i && (
                          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11.5, color: C.textSecondary, background: C.pageBg, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, marginTop: 8, maxHeight: 200, overflow: 'auto', fontFamily: MONO }}>{a.systemPrompt}</pre>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.cardBg, color: C.text, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT }}>Cancel</button>
          {phase === 'intro' && <button onClick={generate} style={genBtn}><Sparkles size={15} /> Generate</button>}
          {phase === 'review' && <button onClick={install} style={genBtn}><Check size={15} /> Create {picked.size} as draft{picked.size === 1 ? '' : 's'}</button>}
          {(phase === 'loading' || phase === 'installing') && <button disabled style={{ ...genBtn, opacity: 0.7 }}><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Working…</button>}
        </div>
      </div>
    </div>
  );
}

const genBtn = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 9, border: 'none', background: C.primary, color: '#fff', cursor: 'pointer', fontSize: 13.5, fontWeight: 700, fontFamily: FONT };

function Card({ preset, installing, onInstall, onManager, onConfigure }) {
  const Icon = ICONS[preset.icon] || Bot;
  const chip = statusChip(preset);
  const installedCount = (preset.installedAgents || []).length;
  const isManager = preset.key === 'manager';
  const isCampaign = CAMPAIGN_KINDS.has(preset.key);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      padding: 16, borderRadius: 14, background: C.cardBg,
      border: `1px solid ${C.border}`, boxShadow: C.shadowSm,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11, flexShrink: 0,
          background: preset.installable ? '#FEF1F1' : '#F2F2EC',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={20} color={preset.installable ? C.primary : C.textSecondary} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.2 }}>{preset.name}</div>
          <div style={{
            display: 'inline-block', marginTop: 5, fontSize: 10, fontWeight: 700,
            letterSpacing: '.04em', textTransform: 'uppercase',
            padding: '2px 7px', borderRadius: 999,
            background: '#F2F2EC', color: C.textSecondary,
          }}>
            {CATEGORY_LABEL[preset.category] || preset.category}
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12.5, color: C.textSecondary, margin: '0 0 10px', lineHeight: 1.5, flex: 1 }}>
        {preset.description}
      </p>

      {preset.note && !preset.installable && (
        <p style={{ fontSize: 11.5, color: C.textMuted, margin: '0 0 12px', lineHeight: 1.45, fontStyle: 'italic' }}>
          {preset.note}
        </p>
      )}

      {(preset.tools || []).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
          {preset.tools.slice(0, 4).map(t => (
            <span key={t} style={{
              fontSize: 10, fontFamily: MONO, color: C.textMuted,
              padding: '2px 6px', borderRadius: 6, background: '#F7F7F2', border: `1px solid ${C.border}`,
            }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Action row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {preset.installable ? (
          <>
            <button
              onClick={onInstall}
              disabled={installing}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 13px', borderRadius: 8, border: 'none',
                background: C.primary, color: '#fff', cursor: installing ? 'wait' : 'pointer',
                fontSize: 12.5, fontFamily: FONT, fontWeight: 700, opacity: installing ? 0.7 : 1,
              }}
            >
              {installing
                ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                : <Plus size={13} />}
              {installedCount > 0 ? 'Install another' : 'Install (paused)'}
            </button>
            {installedCount > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: '#065F46', fontWeight: 600 }}>
                <Check size={13} /> {installedCount} installed
              </span>
            )}
          </>
        ) : isManager ? (
          <button
            onClick={onManager}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 13px', borderRadius: 8,
              border: `1px solid ${C.border}`, background: C.cardBg,
              color: C.text, cursor: 'pointer', fontSize: 12.5, fontFamily: FONT, fontWeight: 700,
            }}
          >
            <BarChart3 size={13} /> Run report
          </button>
        ) : isCampaign ? (
          <>
            <button
              onClick={onConfigure}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 13px', borderRadius: 8,
                border: `1px solid ${C.border}`, background: C.cardBg,
                color: C.text, cursor: 'pointer', fontSize: 12.5, fontFamily: FONT, fontWeight: 700,
              }}
            >
              <Settings2 size={13} /> Configure
            </button>
            {chip && (
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '.03em',
                padding: '5px 10px', borderRadius: 999, background: chip.bg, color: chip.color,
              }}>
                {chip.label}
              </span>
            )}
          </>
        ) : chip ? (
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '.03em',
            padding: '5px 10px', borderRadius: 999, background: chip.bg, color: chip.color,
          }}>
            {chip.label}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------- Manager report modal --------------------------- */

function ManagerReportModal({ onClose }) {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (d) => {
    setLoading(true);
    setError('');
    try {
      setData(await api.agents.managerReport(d));
    } catch (e) {
      setError(e?.message || 'Failed to build report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  const m = data?.metrics;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto',
          background: C.cardBg, borderRadius: 16, border: `1px solid ${C.border}`,
          boxShadow: C.shadowMd, fontFamily: FONT,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <BarChart3 size={17} color={C.primary} />
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>Manager report</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
            {[{ v: 7, l: 'This week' }, { v: 30, l: 'Last 30 days' }].map(opt => (
              <button
                key={opt.v}
                onClick={() => setDays(opt.v)}
                style={{
                  padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                  fontSize: 12.5, fontFamily: FONT, fontWeight: 600,
                  border: `1px solid ${days === opt.v ? C.primary : C.border}`,
                  background: days === opt.v ? '#FEF1F1' : C.cardBg,
                  color: days === opt.v ? C.primary : C.text,
                }}
              >
                {opt.l}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, gap: 8, color: C.textMuted, fontSize: 13 }}>
              <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Crunching the numbers…
            </div>
          ) : error ? (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 13 }}>
              {error}
            </div>
          ) : m ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 18 }}>
                <Tile label="Leads" value={m.leads} />
                <Tile label="Not contacted" value={m.notContacted} accent={m.notContacted > 0 ? '#B45309' : null} />
                <Tile label="High intent" value={m.hasLeadScoreField ? m.highIntent : '—'} />
                <Tile label="Likely to close" value={m.likelyToClose} accent={m.likelyToClose > 0 ? '#065F46' : null} />
              </div>
              <pre style={{
                whiteSpace: 'pre-wrap', fontFamily: FONT, fontSize: 13, lineHeight: 1.6,
                color: C.text, background: '#F7F7F2', border: `1px solid ${C.border}`,
                borderRadius: 10, padding: 14, margin: 0,
              }}>
                {data.digest}
              </pre>
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 10, fontFamily: MONO }}>
                {m.msgsIn} in · {m.msgsOut} out · generated {new Date(m.generatedAt).toLocaleString()}
              </div>
            </>
          ) : null}

          <WeeklyDeliverySection />
        </div>
      </div>
    </div>
  );
}

const DAYS = [
  { v: 1, l: 'Monday' }, { v: 2, l: 'Tuesday' }, { v: 3, l: 'Wednesday' },
  { v: 4, l: 'Thursday' }, { v: 5, l: 'Friday' }, { v: 6, l: 'Saturday' }, { v: 7, l: 'Sunday' },
];

// Weekly auto-delivery config, shown under the on-demand report.
function WeeklyDeliverySection() {
  const [sched, setSched] = useState(null);
  const [waAccounts, setWaAccounts] = useState([]);
  const [recipientsText, setRecipientsText] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [s, accts] = await Promise.all([
          api.agents.managerSchedule(),
          api.whatsappAccounts.list().catch(() => []),
        ]);
        setSched(s);
        setRecipientsText((s?.recipients || []).join(', '));
        setWaAccounts(accts);
      } catch (e) {
        setError(e?.message || 'Failed to load schedule');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (k, v) => { setSched(s => ({ ...s, [k]: v })); setSaved(false); };

  const save = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      const recipients = recipientsText.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
      const updated = await api.agents.updateManagerSchedule({
        enabled: sched.enabled,
        dayOfWeek: Number(sched.dayOfWeek),
        hour: Number(sched.hour),
        windowDays: Number(sched.windowDays),
        waAccountId: sched.waAccountId || null,
        recipients,
      });
      setSched(updated);
      setRecipientsText((updated.recipients || []).join(', '));
      setSaved(true);
    } catch (e) {
      setError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !sched) return null;

  return (
    <div style={{ marginTop: 20, paddingTop: 18, borderTop: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <CalendarClock size={15} color={C.primary} />
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text }}>Weekly auto-delivery</div>
      </div>
      <p style={{ fontSize: 12, color: C.textSecondary, margin: '0 0 14px', lineHeight: 1.5 }}>
        Send this report to your team automatically on WhatsApp each week. The report is always saved here even if a WhatsApp send doesn’t go through.
      </p>

      {error && <div style={{ padding: '9px 12px', marginBottom: 12, borderRadius: 8, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 12.5 }}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '11px 13px', marginBottom: 14, borderRadius: 10, background: sched.enabled ? '#ECFDF5' : '#F7F7F2', border: `1px solid ${sched.enabled ? '#A7F3D0' : C.border}` }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{sched.enabled ? 'On — sending weekly' : 'Off'}</div>
        <button onClick={() => set('enabled', !sched.enabled)} style={{ width: 44, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer', background: sched.enabled ? '#059669' : '#CBD5E1', position: 'relative', flexShrink: 0 }}>
          <span style={{ position: 'absolute', top: 3, left: sched.enabled ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <SmallField label="Day">
          <select value={sched.dayOfWeek} onChange={e => set('dayOfWeek', e.target.value)} style={miniInput}>
            {DAYS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
          </select>
        </SmallField>
        <SmallField label="Hour (IST, 0–23)">
          <input type="number" value={sched.hour} onChange={e => set('hour', e.target.value)} style={miniInput} />
        </SmallField>
      </div>

      <div style={{ marginBottom: 12 }}>
        <SmallField label="Sending WhatsApp number">
          <select value={sched.waAccountId || ''} onChange={e => set('waAccountId', e.target.value)} style={miniInput}>
            <option value="">Select a number…</option>
            {waAccounts.map(a => <option key={a.id} value={a.id}>{a.displayName || a.displayPhoneNumber}</option>)}
          </select>
        </SmallField>
      </div>

      <div style={{ marginBottom: 14 }}>
        <SmallField label="Recipients (WhatsApp numbers, comma-separated)">
          <input value={recipientsText} onChange={e => { setRecipientsText(e.target.value); setSaved(false); }} placeholder="919876543210, 919812345678" style={miniInput} />
        </SmallField>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={save} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 8, border: 'none', background: C.primary, color: '#fff', cursor: saving ? 'wait' : 'pointer', fontSize: 13, fontFamily: FONT, fontWeight: 700, opacity: saving ? 0.7 : 1 }}>
          {saving && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />} Save schedule
        </button>
        {saved && <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#065F46', fontWeight: 600 }}><Check size={14} /> Saved</span>}
        {sched.lastRun && <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textMuted, fontFamily: MONO }}>last sent {sched.lastRun.periodDate} → {sched.lastRun.deliveredTo} recipient(s)</span>}
      </div>
    </div>
  );
}

const miniInput = {
  width: '100%', padding: '8px 10px', borderRadius: 8, border: `1.5px solid ${C.border}`,
  fontSize: 13, fontFamily: FONT, outline: 'none', background: C.cardBg, color: C.text, boxSizing: 'border-box',
};
function SmallField({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      {children}
    </label>
  );
}

function Tile({ label, value, accent }) {
  return (
    <div style={{ padding: '12px 14px', borderRadius: 10, background: '#F7F7F2', border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent || C.text, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 5, fontWeight: 600 }}>{label}</div>
    </div>
  );
}
