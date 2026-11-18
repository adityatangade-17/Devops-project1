import { useState, useEffect, useCallback } from 'react';
import {
  ListChecks, Plus, Loader2, Check, Trash2, MessageSquare, X,
  Bot, ArrowRightLeft, User, Clock, Flag,
} from 'lucide-react';
import { api } from '../api.js';
import { C, FONT, MONO } from '../constants.js';

const PRIORITY_COLOR = { high: '#B23B2E', normal: '#4B45A6', low: '#6B7280' };
const SOURCE_META = {
  ai: { label: 'AI', Icon: Bot, color: '#4B45A6' },
  handoff: { label: 'Handover', Icon: ArrowRightLeft, color: '#B45309' },
  manual: { label: 'Manual', Icon: User, color: '#6B7280' },
  system: { label: 'System', Icon: Clock, color: '#6B7280' },
};

function fmtDue(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const now = new Date();
  const overdue = d < now;
  const sameDay = d.toDateString() === now.toDateString();
  const label = sameDay
    ? `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return { label, overdue };
}

export default function TasksPage({ user, onNavigate }) {
  const [tasks, setTasks] = useState([]);
  const [people, setPeople] = useState([]);
  const [status, setStatus] = useState('open');
  const [scope, setScope] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // task object or 'new'

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = {};
      if (status !== 'all') params.status = status;
      if (scope === 'mine') params.scope = 'mine';
      const [t, p] = await Promise.all([
        api.tasks.list(params),
        api.users.presence().catch(() => []),
      ]);
      setTasks(t);
      setPeople(p);
    } catch (e) {
      setError(e?.message || 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [status, scope]);

  useEffect(() => { load(); }, [load]);

  const toggleDone = async (t) => {
    const next = t.status === 'done' ? 'open' : 'done';
    setTasks(ts => ts.map(x => x.id === t.id ? { ...x, status: next } : x));
    try { await api.tasks.update(t.id, { status: next }); } catch { load(); }
    if (status !== 'all') load();
  };

  const remove = async (t) => {
    if (!window.confirm('Delete this task?')) return;
    setTasks(ts => ts.filter(x => x.id !== t.id));
    try { await api.tasks.remove(t.id); } catch { load(); }
  };

  return (
    <div style={{ flex: 1, height: '100%', overflow: 'auto', background: C.pageBg, fontFamily: FONT }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 22px 60px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ListChecks size={20} color={C.primary} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: C.text, letterSpacing: '-.01em' }}>Tasks</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 1 }}>Follow-ups from your conversations — added by you, your team, or automatically by the AI.</div>
            </div>
          </div>
          <button onClick={() => setEditing('new')} style={btnPrimary}>
            <Plus size={15} /> New task
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <Segmented value={status} onChange={setStatus} options={[{ v: 'open', l: 'Open' }, { v: 'done', l: 'Done' }, { v: 'all', l: 'All' }]} />
          <Segmented value={scope} onChange={setScope} options={[{ v: 'all', l: 'Everyone' }, { v: 'mine', l: 'Assigned to me' }]} />
        </div>

        {error && <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 13, marginBottom: 14 }}>{error}</div>}

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 50, color: C.textMuted, fontSize: 13 }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading tasks…
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState onCreate={() => setEditing('new')} status={status} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {tasks.map(t => (
              <TaskRow key={t.id} task={t} onToggle={() => toggleDone(t)} onEdit={() => setEditing(t)} onDelete={() => remove(t)} onOpenChat={onNavigate} />
            ))}
          </div>
        )}
      </div>

      {editing && (
        <TaskModal
          task={editing === 'new' ? null : editing}
          people={people}
          user={user}
          onClose={(changed) => { setEditing(null); if (changed) load(); }}
        />
      )}
    </div>
  );
}

function TaskRow({ task, onToggle, onEdit, onDelete, onOpenChat }) {
  const done = task.status === 'done';
  const due = fmtDue(task.dueAt);
  const src = SOURCE_META[task.source] || SOURCE_META.manual;
  const SrcIcon = src.Icon;
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 15px',
      background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 12,
      opacity: done ? 0.62 : 1,
    }}>
      <button onClick={onToggle} title={done ? 'Mark open' : 'Mark done'} style={{
        marginTop: 1, width: 20, height: 20, borderRadius: 6, flexShrink: 0, cursor: 'pointer',
        border: `1.5px solid ${done ? '#059669' : C.border}`, background: done ? '#059669' : 'transparent',
        display: 'grid', placeItems: 'center',
      }}>
        {done && <Check size={13} color="#fff" />}
      </button>

      <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={onEdit}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text, textDecoration: done ? 'line-through' : 'none' }}>{task.title}</span>
          <span title="priority" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 700, color: PRIORITY_COLOR[task.priority] }}>
            <Flag size={10} /> {task.priority}
          </span>
        </div>
        {task.description && <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 3, lineHeight: 1.4 }}>{task.description}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, fontSize: 11, color: C.textMuted, flexWrap: 'wrap', fontFamily: MONO }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: src.color }}><SrcIcon size={11} /> {src.label}</span>
          {task.assignedUserName && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><User size={11} /> {task.assignedUserName}</span>}
          {due && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: due.overdue && !done ? '#B23B2E' : C.textMuted }}><Clock size={11} /> {due.label}</span>}
          {task.contactName || task.contactNumber ? (
            <button
              onClick={(e) => { e.stopPropagation(); if (task.waNumber && task.contactNumber) openChatSafe(onOpenChat, task); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: C.primary, fontFamily: MONO, fontSize: 11, padding: 0 }}
            >
              <MessageSquare size={11} /> {task.contactName || task.contactNumber}
            </button>
          ) : null}
        </div>
      </div>

      <button onClick={onDelete} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, display: 'flex', flexShrink: 0, padding: 4 }}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function openChatSafe(onOpenChat, task) {
  if (typeof onOpenChat === 'function') onOpenChat(`chats/${task.waNumber}/${task.contactNumber}`);
}

function TaskModal({ task, people, user, onClose }) {
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [priority, setPriority] = useState(task?.priority || 'normal');
  const [assignedUserId, setAssignedUserId] = useState(task?.assignedUserId || user?.id || '');
  const [dueLocal, setDueLocal] = useState(task?.dueAt ? toLocalInput(task.dueAt) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true); setError('');
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      assignedUserId: assignedUserId || null,
      dueAt: dueLocal ? new Date(dueLocal).toISOString() : null,
    };
    try {
      if (task) await api.tasks.update(task.id, payload);
      else await api.tasks.create(payload);
      onClose(true);
    } catch (e) {
      setError(e?.message || 'Failed to save'); setSaving(false);
    }
  };

  return (
    <div onClick={() => onClose(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: C.cardBg, borderRadius: 16, border: `1px solid ${C.border}`, boxShadow: C.shadowMd, fontFamily: FONT }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>{task ? 'Edit task' : 'New task'}</div>
          <button onClick={() => onClose(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, display: 'flex' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 13 }}>
          {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#FCEBEB', color: '#A32D2D', border: '1px solid #FBC8C8', fontSize: 12.5 }}>{error}</div>}
          <Field label="Title">
            <input value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="e.g. Call back Rajesh about pricing" style={inputStyle} />
          </Field>
          <Field label="Notes (optional)">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Priority">
              <select value={priority} onChange={e => setPriority(e.target.value)} style={inputStyle}>
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
              </select>
            </Field>
            <Field label="Due">
              <input type="datetime-local" value={dueLocal} onChange={e => setDueLocal(e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <Field label="Assign to">
            <select value={assignedUserId} onChange={e => setAssignedUserId(e.target.value)} style={inputStyle}>
              <option value="">— Unassigned —</option>
              {people.map(p => <option key={p.id} value={p.id}>{p.displayName}{p.online ? ' · online' : ''}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '0 18px 18px' }}>
          <button onClick={() => onClose(false)} style={btnGhost}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }}>
            {saving && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />} {task ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onCreate, status }) {
  return (
    <div style={{ textAlign: 'center', padding: '56px 20px', background: C.cardBg, border: `1px dashed ${C.border}`, borderRadius: 14 }}>
      <div style={{ width: 50, height: 50, borderRadius: 13, margin: '0 auto 14px', background: '#EEF0FB', display: 'grid', placeItems: 'center' }}>
        <ListChecks size={24} color={C.primary} />
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{status === 'done' ? 'No completed tasks yet' : 'No tasks here'}</div>
      <div style={{ fontSize: 13, color: C.textSecondary, margin: '6px auto 18px', maxWidth: 380, lineHeight: 1.5 }}>
        Tasks appear here automatically when the AI spots a follow-up in a chat or a conversation is handed to a person — or add one yourself.
      </div>
      <button onClick={onCreate} style={{ ...btnPrimary, margin: '0 auto' }}><Plus size={15} /> New task</button>
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', background: C.cardBg, border: `1px solid ${C.border}`, borderRadius: 9, padding: 3, gap: 2 }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{
          padding: '6px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, fontFamily: FONT,
          background: value === o.v ? C.primary : 'transparent', color: value === o.v ? '#fff' : C.textSecondary,
        }}>{o.l}</button>
      ))}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      {children}
    </label>
  );
}

function toLocalInput(iso) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

const inputStyle = { width: '100%', padding: '9px 11px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 13.5, fontFamily: FONT, outline: 'none', background: C.cardBg, color: C.text, boxSizing: 'border-box' };
const btnPrimary = { display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 15px', borderRadius: 9, border: 'none', background: C.primary, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: FONT };
const btnGhost = { padding: '9px 15px', borderRadius: 9, border: `1px solid ${C.border}`, background: C.cardBg, color: C.text, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: FONT };
