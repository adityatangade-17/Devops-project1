import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles, Building2, MessageCircle, Users, Package, Bot, Rocket,
  Plus, Trash2, Check, CheckCircle2, ArrowRight, ArrowLeft, Loader2,
  ExternalLink, PartyPopper, Wifi, WifiOff,
} from 'lucide-react';
import { api } from '../api.js';
import { C, FONT } from '../constants.js';
import { Button, Card, Badge, StatusDot, EmptyState } from '../ui.jsx';

// Guided workspace activation — walks a new admin from an empty workspace to a
// live one: business → WhatsApp → team → offerings → AI assistants → launch.
// Everything saves as you go and resumes from the furthest step reached. The
// captured business profile powers the AI-assistant generation (the "wow" step).

const STEPS = [
  { key: 'welcome', label: 'Welcome', Icon: Sparkles },
  { key: 'business', label: 'Your business', Icon: Building2 },
  { key: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle },
  { key: 'team', label: 'Your team', Icon: Users },
  { key: 'products', label: 'What you offer', Icon: Package },
  { key: 'ai', label: 'AI assistants', Icon: Bot },
  { key: 'launch', label: 'Launch', Icon: Rocket },
];

const BUSINESS_TYPES = ['Manufacturer', 'Importer', 'Trader / Distributor', 'Service provider', 'Consultancy', 'E-commerce', 'Other'];
const TEAM_SIZES = ['Just me', '2–10', '11–50', '51–200', '200+'];
const ROLES = [{ v: 'admin', l: 'Admin' }, { v: 'team_lead', l: 'Team Lead' }, { v: 'bda_sales', l: 'Sales' }, { v: 'consultant', l: 'Consultant' }];

export default function VentureSetupWizard({ navigate, onDone }) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [launched, setLaunched] = useState(false);

  const [profile, setProfile] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [offices, setOffices] = useState([]);
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [agents, setAgents] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, acc, off, us, pr, ag] = await Promise.all([
        api.venture.profile(),
        api.whatsappAccounts.list().catch(() => []),
        api.venture.offices().catch(() => []),
        api.users.list().catch(() => []),
        api.venture.products().catch(() => []),
        api.agents.list().catch(() => []),
      ]);
      setProfile(p); setAccounts(acc); setOffices(off); setUsers(us); setProducts(pr); setAgents(ag);
      if (p.setupStep) setStep(Math.min(p.setupStep, STEPS.length - 1));
    } catch (e) { setError(e?.message || 'Failed to load setup'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const setP = (k, v) => setProfile(p => ({ ...p, [k]: v }));
  const persist = async (extra = {}) => {
    const saved = await api.venture.saveProfile({ ...profile, setupStep: Math.max(profile.setupStep || 0, step + 1), ...extra });
    setProfile(saved); return saved;
  };

  const next = async () => {
    setError(''); setSaving(true);
    try {
      if (STEPS[step].key === 'business' && !String(profile.companyName || '').trim()) { setError('Please enter your company name.'); setSaving(false); return; }
      await persist();
      if (step < STEPS.length - 1) setStep(step + 1);
    } catch (e) { setError(e?.message || 'Could not save'); }
    finally { setSaving(false); }
  };
  const back = () => { setError(''); if (step > 0) setStep(step - 1); };

  const launch = async () => {
    setSaving(true); setError('');
    try { await persist({ setupCompleted: true, setupStep: STEPS.length }); setLaunched(true); }
    catch (e) { setError(e?.message || 'Could not launch'); }
    finally { setSaving(false); }
  };

  if (loading || !profile) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: C.textMuted }}><Loader2 size={20} style={{ animation: 'ui-spin 1s linear infinite' }} /></div>;
  }
  if (launched) return <LaunchSuccess company={profile.companyName} onDone={onDone} navigate={navigate} />;

  const current = STEPS[step];
  const isWelcome = current.key === 'welcome';
  const readiness = computeReadiness(profile, accounts, users, products, agents);

  return (
    <div style={{ height: '100%', overflow: 'auto', background: C.pageBg, fontFamily: FONT }}>
      <div style={{ maxWidth: 940, margin: '0 auto', padding: '26px 22px 64px', display: 'flex', gap: 30, alignItems: 'flex-start' }}>
        {/* Rail */}
        <aside style={{ width: 208, flexShrink: 0, position: 'sticky', top: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Rocket size={17} color={C.primary} />
            <div style={{ fontSize: 14.5, fontWeight: 800, color: C.text }}>Workspace setup</div>
          </div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 16 }}>{readiness.pct}% ready · ~5 min</div>
          <div style={{ height: 5, borderRadius: 999, background: C.border, marginBottom: 18, overflow: 'hidden' }}>
            <div style={{ width: `${readiness.pct}%`, height: '100%', background: C.primary, transition: 'width .6s cubic-bezier(.16,1,.3,1)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {STEPS.map((s, i) => {
              const done = i < step, active = i === step;
              return (
                <button key={s.key} onClick={() => i <= step && setStep(i)} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', borderRadius: 10, border: 'none',
                  cursor: i <= step ? 'pointer' : 'default', textAlign: 'left', width: '100%',
                  background: active ? C.primary : 'transparent', color: active ? '#fff' : done ? C.text : C.textMuted,
                  fontFamily: FONT, fontSize: 13, fontWeight: 600,
                }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, background: active ? 'rgba(255,255,255,.22)' : done ? C.successBg : C.surfaceAlt, color: active ? '#fff' : done ? C.success : C.textMuted, border: active ? 'none' : `1px solid ${C.border}` }}>
                    {done ? <Check size={12} /> : i + 1}
                  </span>
                  {s.label}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Content */}
        <main style={{ flex: 1, minWidth: 0 }}>
          {!isWelcome && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <current.Icon size={20} color={C.primary} />
                <h1 style={{ fontSize: 21, fontWeight: 800, color: C.text, margin: 0, letterSpacing: '-.02em' }}>{HEAD[current.key].title}</h1>
              </div>
              <p style={{ fontSize: 13.5, color: C.textSecondary, margin: '8px 0 0', lineHeight: 1.55, maxWidth: 560 }}>{HEAD[current.key].sub}</p>
            </div>
          )}

          {error && <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}33`, fontSize: 13 }}>{error}</div>}

          {current.key === 'welcome' && <WelcomeStep company={profile.companyName} onStart={() => setStep(1)} />}
          {current.key !== 'welcome' && (
            <Card pad={22}>
              {current.key === 'business' && <BusinessStep profile={profile} setP={setP} />}
              {current.key === 'whatsapp' && <WhatsAppStep accounts={accounts} offices={offices} setOffices={setOffices} navigate={navigate} />}
              {current.key === 'team' && <TeamStep users={users} setUsers={setUsers} accounts={accounts} />}
              {current.key === 'products' && <ProductsStep products={products} setProducts={setProducts} />}
              {current.key === 'ai' && <AIStep profile={profile} products={products} agents={agents} setAgents={setAgents} navigate={navigate} />}
              {current.key === 'launch' && <LaunchStep readiness={readiness} navigate={navigate} />}
            </Card>
          )}

          {!isWelcome && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
              <Button variant="subtle" size="lg" icon={ArrowLeft} onClick={back}>Back</Button>
              {current.key !== 'launch'
                ? <Button size="lg" loading={saving} iconRight={ArrowRight} onClick={next}>Save &amp; continue</Button>
                : <Button size="lg" loading={saving} icon={Rocket} onClick={launch}>Launch workspace</Button>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/* ------------------------------ readiness -------------------------------- */
function computeReadiness(profile, accounts, users, products, agents) {
  const items = [
    { key: 'business', label: 'Business profile', done: !!(profile?.companyName && profile?.description) },
    { key: 'whatsapp', label: 'WhatsApp connected', done: (accounts?.length || 0) > 0 },
    { key: 'team', label: 'Team invited', done: (users?.length || 0) > 1 },
    { key: 'products', label: 'Products / services added', done: (products?.length || 0) > 0 },
    { key: 'ai', label: 'AI assistant added', done: (agents?.length || 0) > 0 },
  ];
  const doneN = items.filter(i => i.done).length;
  return { items, pct: Math.round((doneN / items.length) * 100), allDone: doneN === items.length };
}

const HEAD = {
  business: { title: 'Tell us about your business', sub: 'This is also what your AI assistants use to represent you accurately to customers.' },
  whatsapp: { title: 'Connect your WhatsApp', sub: 'Link the WhatsApp Business number your customers already message. Every message then lands in your shared inbox.' },
  team: { title: 'Add your team', sub: 'Invite the people who’ll use the workspace and set what each of them can see.' },
  products: { title: 'What you offer', sub: 'List your products and services so your AI knows what to talk about and pitch.' },
  ai: { title: 'Your AI assistants', sub: 'From everything you’ve told us, AI can draft assistants tailored to your business — you review and keep the ones you want.' },
  launch: { title: 'You’re almost ready', sub: 'A quick check, then go live.' },
};

/* -------------------------------- steps ---------------------------------- */
function WelcomeStep({ company, onStart }) {
  return (
    <div style={{ background: C.headerBg, borderRadius: 20, padding: '44px 40px', color: '#fff', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '-30%', right: '-8%', width: '48%', height: '120%', background: 'radial-gradient(circle,rgba(229,72,77,.28),transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', maxWidth: 520 }}>
        <span style={{ display: 'inline-grid', placeItems: 'center', width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,.1)', marginBottom: 20 }}><Sparkles size={24} /></span>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.03em', lineHeight: 1.1, margin: '0 0 14px' }}>Let’s get {company ? company : 'your workspace'} ready</h1>
        <p style={{ fontSize: 15.5, color: 'rgba(255,255,255,.75)', lineHeight: 1.6, margin: '0 0 26px' }}>
          In about five minutes we’ll set up your business profile, connect WhatsApp, add your team, and even have AI prepare assistants tuned to what you do. You can pause and come back any time.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
          {['Connect the number your customers already use', 'Invite your team and set their access', 'Let AI build assistants for your business', 'Go live — everything in one place'].map(t => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'rgba(255,255,255,.86)' }}>
              <CheckCircle2 size={17} color="#25D366" /> {t}
            </div>
          ))}
        </div>
        <Button size="lg" icon={ArrowRight} onClick={onStart}>Let’s begin</Button>
      </div>
    </div>
  );
}

function BusinessStep({ profile, setP }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Field label="Company name *"><input style={inp} value={profile.companyName} onChange={e => setP('companyName', e.target.value)} placeholder="e.g. SpiderChat" /></Field>
      <div style={grid2}>
        <Field label="Legal / registered name"><input style={inp} value={profile.legalName} onChange={e => setP('legalName', e.target.value)} /></Field>
        <Field label="GST number"><input style={inp} value={profile.gstNumber} onChange={e => setP('gstNumber', e.target.value)} placeholder="22AAAAA0000A1Z5" /></Field>
      </div>
      <div style={grid2}>
        <Field label="Type of business"><select style={inp} value={profile.businessType} onChange={e => setP('businessType', e.target.value)}><option value="">Select…</option>{BUSINESS_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
      <Field label="Sector / industry"><input style={inp} value={profile.sector} onChange={e => setP('sector', e.target.value)} placeholder="e.g. Education or technology" /></Field>
      </div>
      <Field label="What does your business do?" hint="A clear description here makes your AI assistants noticeably better."><textarea rows={3} style={{ ...inp, resize: 'vertical' }} value={profile.description} onChange={e => setP('description', e.target.value)} placeholder="Describe your products/services, who your customers are, and how you help them." /></Field>
      <div style={grid2}>
        <Field label="Website"><input style={inp} value={profile.website} onChange={e => setP('website', e.target.value)} placeholder="https://…" /></Field>
        <Field label="Team size"><select style={inp} value={profile.teamSize} onChange={e => setP('teamSize', e.target.value)}><option value="">Select…</option>{TEAM_SIZES.map(t => <option key={t}>{t}</option>)}</select></Field>
      </div>
    </div>
  );
}

function WhatsAppStep({ accounts, offices, setOffices, navigate }) {
  const [form, setForm] = useState({ name: '', city: '', phone: '', waAccountId: '' });
  const [busy, setBusy] = useState(false);
  const add = async () => { if (!form.name.trim()) return; setBusy(true); try { const o = await api.venture.addOffice(form); setOffices(x => [...x, o]); setForm({ name: '', city: '', phone: '', waAccountId: '' }); } catch (e) { alert(e.message); } finally { setBusy(false); } };
  const del = async (o) => { try { await api.venture.removeOffice(o.id); setOffices(x => x.filter(i => i.id !== o.id)); } catch (e) { alert(e.message); } };
  const connected = accounts.length > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12, background: connected ? C.successBg : C.warningBg, border: `1px solid ${connected ? C.success : C.warning}33` }}>
        <span style={{ width: 40, height: 40, borderRadius: 11, display: 'grid', placeItems: 'center', background: '#fff', color: connected ? C.success : C.warning, flexShrink: 0 }}>{connected ? <Wifi size={20} /> : <WifiOff size={20} />}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: connected ? C.success : C.warning }}>{connected ? `${accounts.length} number${accounts.length === 1 ? '' : 's'} connected` : 'No WhatsApp number connected yet'}</div>
          <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 2 }}>{connected ? 'Incoming messages will appear in your shared inbox.' : 'Connect the number your customers already message you on.'}</div>
        </div>
        <Button variant={connected ? 'subtle' : 'primary'} size="md" iconRight={ExternalLink} onClick={() => navigate('admin-settings/whatsapp-accounts')}>{connected ? 'Manage' : 'Connect'}</Button>
      </div>

      {connected && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {accounts.map(a => <Badge key={a.id} tone="success" icon={StatusDotIcon}>{a.displayName || a.displayPhoneNumber}</Badge>)}
        </div>
      )}

      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>Offices / branches <span style={{ color: C.textMuted, fontWeight: 500 }}>(optional)</span></div>
        {offices.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
            {offices.map(o => (
              <Row key={o.id} onDelete={() => del(o)}><b>{o.name}</b>{o.city ? ` · ${o.city}` : ''}{o.phone ? ` · ${o.phone}` : ''}</Row>
            ))}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
          <Field label="Office name"><input style={inp} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Head Office" /></Field>
          <Field label="City"><input style={inp} value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></Field>
          <Field label="WhatsApp number"><select style={inp} value={form.waAccountId} onChange={e => setForm({ ...form, waAccountId: e.target.value })}><option value="">—</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.displayName || a.displayPhoneNumber}</option>)}</select></Field>
          <Button size="md" icon={Plus} loading={busy} onClick={add} />
        </div>
      </div>
    </div>
  );
}

function TeamStep({ users, setUsers, accounts }) {
  const [form, setForm] = useState({ displayName: '', email: '', role: 'bda_sales', waNumber: '' });
  const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const add = async () => {
    if (!form.displayName.trim() || !form.email.trim()) { setNote('Name and email are required.'); return; }
    setBusy(true); setNote('');
    try {
      const res = await api.users.create({ username: form.email.trim(), email: form.email.trim(), displayName: form.displayName.trim(), role: form.role, assignedWaNumbers: form.waNumber ? [form.waNumber] : [] });
      setUsers(x => [...x, res]);
      setNote(res.generatedPassword ? `Added. Temporary password: ${res.generatedPassword}` : 'Team member added.');
      setForm({ displayName: '', email: '', role: 'bda_sales', waNumber: '' });
    } catch (e) { setNote(e.message || 'Could not add user'); } finally { setBusy(false); }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>Team ({users.length})</div>
        {users.length === 0 ? <div style={{ fontSize: 12.5, color: C.textMuted }}>No users yet.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {users.map(u => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: C.text, padding: '7px 11px', background: C.surfaceAlt, borderRadius: 9, border: `1px solid ${C.border}` }}>
                <b style={{ minWidth: 0 }}>{u.displayName || u.username}</b>
                <span style={{ color: C.textMuted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</span>
                <Badge tone={u.role === 'admin' ? 'primary' : 'neutral'}>{String(u.role || '').replace('_', ' ')}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.4fr 1fr 1.1fr auto', gap: 8, alignItems: 'end' }}>
        <Field label="Full name"><input style={inp} value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} /></Field>
        <Field label="Email"><input style={inp} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Role" hint={ROLE_HINT[form.role]}><select style={inp} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{ROLES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}</select></Field>
        <Field label="Number"><select style={inp} value={form.waNumber} onChange={e => setForm({ ...form, waNumber: e.target.value })}><option value="">—</option>{accounts.map(a => <option key={a.id} value={a.displayPhoneNumber}>{a.displayName || a.displayPhoneNumber}</option>)}</select></Field>
        <Button size="md" icon={Plus} loading={busy} onClick={add} />
      </div>
      {note && <div style={{ fontSize: 12.5, fontWeight: 600, color: note.startsWith('Added') || note.includes('password') ? C.success : C.danger }}>{note}</div>}
    </div>
  );
}
const ROLE_HINT = { admin: 'Full access', team_lead: 'Manages their team’s work', bda_sales: 'Works their own leads', consultant: 'Takes bookings & follow-ups' };

function ProductsStep({ products, setProducts }) {
  const [form, setForm] = useState({ name: '', kind: 'service', priceText: '', description: '' });
  const [busy, setBusy] = useState(false);
  const add = async () => { if (!form.name.trim()) return; setBusy(true); try { const p = await api.venture.addProduct(form); setProducts(x => [...x, p]); setForm({ name: '', kind: 'service', priceText: '', description: '' }); } catch (e) { alert(e.message); } finally { setBusy(false); } };
  const del = async (p) => { try { await api.venture.removeProduct(p.id); setProducts(x => x.filter(i => i.id !== p.id)); } catch (e) { alert(e.message); } };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {products.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {products.map(p => (
            <Row key={p.id} onDelete={() => del(p)}>
              <Badge tone="ai" style={{ marginRight: 8 }}>{p.kind}</Badge><b>{p.name}</b>{p.priceText ? ` · ${p.priceText}` : ''}
            </Row>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr .9fr 1fr auto', gap: 8, alignItems: 'end' }}>
        <Field label="Name"><input style={inp} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Project consultation" /></Field>
        <Field label="Type"><select style={inp} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="service">Service</option><option value="product">Product</option></select></Field>
        <Field label="Price (optional)"><input style={inp} value={form.priceText} onChange={e => setForm({ ...form, priceText: e.target.value })} placeholder="₹5,000 / year" /></Field>
        <Button size="md" icon={Plus} loading={busy} onClick={add} />
      </div>
    </div>
  );
}

function AIStep({ profile, products, agents, setAgents, navigate }) {
  const [phase, setPhase] = useState(agents.length > 0 ? 'have' : 'intro'); // intro | loading | review | done | have
  const [drafted, setDrafted] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState('');
  const ready = !!(profile.companyName && String(profile.description || '').trim());

  const generate = async () => {
    setPhase('loading'); setErr('');
    try {
      const res = await api.agents.generate();
      setDrafted(res.agents || []); setPicked(new Set((res.agents || []).map((_, i) => i))); setMeta(res);
      setPhase('review');
    } catch (e) { setErr(e?.message || 'Could not generate assistants'); setPhase('intro'); }
  };
  const toggle = (i) => setPicked(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const create = async () => {
    const chosen = drafted.filter((_, i) => picked.has(i));
    if (chosen.length === 0) { setErr('Select at least one assistant.'); return; }
    setPhase('loading'); setErr('');
    try { const { created } = await api.agents.installGenerated(chosen); setAgents(a => [...a, ...(created || [])]); setPhase('done'); }
    catch (e) { setErr(e?.message || 'Could not create assistants'); setPhase('review'); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {err && <div style={{ padding: '9px 13px', borderRadius: 9, background: C.dangerBg, color: C.danger, fontSize: 12.5 }}>{err}</div>}

      {phase === 'have' && (
        <EmptyState icon={Bot} title="You already have assistants" body={`${agents.length} AI assistant${agents.length === 1 ? '' : 's'} set up. Manage or add more from the AI Agents page.`}
          action={<Button variant="subtle" iconRight={ExternalLink} onClick={() => navigate('ai-agent-builder')}>Open AI Agents</Button>} />
      )}

      {phase === 'intro' && (
        <>
          <div style={{ display: 'flex', gap: 14, padding: '16px 18px', borderRadius: 14, background: C.aiBg, border: `1px solid ${C.ai}22` }}>
            <span style={{ width: 42, height: 42, borderRadius: 12, background: '#fff', display: 'grid', placeItems: 'center', color: C.ai, flexShrink: 0 }}><Sparkles size={20} /></span>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: C.text }}>We’ve learned how your business works</div>
              <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 3, lineHeight: 1.5 }}>Let AI draft WhatsApp assistants tailored to {profile.companyName || 'your business'}. They’re created paused, so you review and switch on only what you want.</div>
            </div>
          </div>
          {!ready
            ? <div style={{ fontSize: 13, color: C.warning }}>Add a company name and description in the earlier step so AI can represent you accurately.</div>
            : <Button size="lg" icon={Sparkles} onClick={generate} style={{ alignSelf: 'flex-start' }}>Prepare my assistants</Button>}
        </>
      )}

      {phase === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '40px 0', color: C.textMuted }}>
          <Loader2 size={24} style={{ animation: 'ui-spin 1s linear infinite', color: C.ai }} />
          <div style={{ fontSize: 13.5 }}>Designing assistants for your business…</div>
        </div>
      )}

      {phase === 'review' && (
        <>
          {meta && <div style={{ fontSize: 12, color: C.textMuted }}>For {meta.company} · {meta.modelUsed}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {drafted.map((a, i) => (
              <div key={i} style={{ display: 'flex', gap: 11, padding: '13px 15px', borderRadius: 12, border: `1px solid ${picked.has(i) ? C.ai : C.border}`, background: picked.has(i) ? C.aiBg : C.cardBg }}>
                <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} style={{ marginTop: 3, cursor: 'pointer' }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{a.name}</div>
                  <div style={{ fontSize: 12.5, color: C.textSecondary, marginTop: 2, lineHeight: 1.45 }}>{a.description}</div>
                </div>
              </div>
            ))}
          </div>
          <Button size="lg" icon={Check} onClick={create} style={{ alignSelf: 'flex-start' }}>Create {picked.size} assistant{picked.size === 1 ? '' : 's'}</Button>
        </>
      )}

      {phase === 'done' && (
        <EmptyState icon={CheckCircle2} title="Your assistants are ready" body="They’re paused so nothing goes live until you activate them. You can review and switch them on from AI Agents any time."
          action={<Button variant="subtle" iconRight={ExternalLink} onClick={() => navigate('ai-agent-builder')}>Review in AI Agents</Button>} />
      )}
    </div>
  );
}

function LaunchStep({ readiness, navigate }) {
  const FIX = { business: 'business', whatsapp: 'admin-settings/whatsapp-accounts', team: 'team', products: 'products', ai: 'ai-agent-builder' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 34, fontWeight: 800, color: readiness.allDone ? C.success : C.text, fontFamily: FONT }}>{readiness.pct}%</div>
        <div style={{ fontSize: 13.5, color: C.textSecondary }}>{readiness.allDone ? 'Everything’s in place — you’re ready to launch.' : 'You can launch now and finish the rest any time.'}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {readiness.items.map(it => (
          <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 14px', borderRadius: 10, background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
            <StatusDot tone={it.done ? 'success' : 'warning'} size={9} />
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: it.done ? C.text : C.textSecondary }}>{it.label}</span>
            {it.done
              ? <Badge tone="success" icon={Check}>Done</Badge>
              : <button onClick={() => navigate('venture-setup')} style={{ background: 'none', border: 'none', color: C.primary, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, fontFamily: FONT }}>Fix this</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function LaunchSuccess({ company, onDone }) {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: C.pageBg, fontFamily: FONT, padding: 24 }}>
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <span style={{ display: 'inline-grid', placeItems: 'center', width: 72, height: 72, borderRadius: 20, background: C.successBg, color: C.success, marginBottom: 22 }}><PartyPopper size={34} /></span>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.02em', color: C.text, margin: '0 0 12px' }}>{company || 'Your workspace'} is ready 🎉</h1>
        <p style={{ fontSize: 15, color: C.textSecondary, lineHeight: 1.6, margin: '0 auto 28px', maxWidth: 400 }}>
          Your team can now manage conversations, leads, AI assistants, bookings, follow-ups and automations — all from one place.
        </p>
        <Button size="lg" icon={ArrowRight} onClick={onDone}>Go to workspace</Button>
      </div>
    </div>
  );
}

/* --------------------------------- bits ---------------------------------- */
const inp = { width: '100%', padding: '9px 11px', borderRadius: 8, border: `1.5px solid ${C.border}`, fontSize: 13.5, fontFamily: FONT, outline: 'none', background: C.cardBg, color: C.text, boxSizing: 'border-box' };
const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 };
function Field({ label, hint, children }) {
  return <label style={{ display: 'block' }}><div style={{ fontSize: 11, fontWeight: 700, color: C.textSecondary, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>{children}{hint && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>}</label>;
}
function Row({ children, onDelete }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', background: C.surfaceAlt, borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 13, color: C.text }}>
    <span style={{ minWidth: 0 }}>{children}</span>
    <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, flexShrink: 0 }}><Trash2 size={14} /></button>
  </div>;
}
function StatusDotIcon() { return <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.success, display: 'inline-block' }} />; }
