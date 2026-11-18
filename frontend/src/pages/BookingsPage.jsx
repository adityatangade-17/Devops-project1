import { useState, useEffect, useCallback } from 'react';
import {
  Plus, X, Loader2, Trash2, Calendar, Users, ListChecks, Link2, Check,
  Video, ExternalLink, CalendarClock, Wallet,
} from 'lucide-react';
import { api } from '../api.js';
import { C, FONT } from '../constants.js';

/* --------------------------------- helpers -------------------------------- */
const WEEKDAYS = [
  ['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['7', 'Sun'],
];
const fmtDateTime = (iso, tz) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: tz || undefined, weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return new Date(iso).toLocaleString(); }
};
const bookingBaseUrl = (slug) => `${window.location.origin}/book.html?service=${encodeURIComponent(slug)}`;
const money = (minor) => `₹${Math.round((minor || 0) / 100).toLocaleString('en-IN')}`;

/* ============================== main page ================================= */
export default function BookingsPage({ user }) {
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState('bookings');

  return (
    <div style={{ padding: 24, fontFamily: FONT, minHeight: '100%' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: C.text, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <CalendarClock size={22} /> Bookings
        </h1>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, borderBottom: `1px solid ${C.border}` }}>
        <Tab active={tab === 'bookings'} onClick={() => setTab('bookings')} Icon={Calendar} label="Appointments" />
        <Tab active={tab === 'services'} onClick={() => setTab('services')} Icon={ListChecks} label="Services & pages" />
        <Tab active={tab === 'consultants'} onClick={() => setTab('consultants')} Icon={Users} label="Consultants" />
        <Tab active={tab === 'payouts'} onClick={() => setTab('payouts')} Icon={Wallet} label="Payouts" />
      </div>

      {!isAdmin && (
        <div style={{ padding: 16, background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 10, color: '#9A3412', fontSize: 13, marginBottom: 16 }}>
          You have read-only access. Ask an admin to change booking configuration.
        </div>
      )}

      {tab === 'bookings' && <BookingsTab isAdmin={isAdmin} />}
      {tab === 'services' && <ServicesTab isAdmin={isAdmin} />}
      {tab === 'consultants' && <ConsultantsTab isAdmin={isAdmin} />}
      {tab === 'payouts' && <PayoutsTab isAdmin={isAdmin} />}
    </div>
  );
}

/* =============================== Payouts tab ============================= */
function PayoutsTab({ isAdmin }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api.booking.payouts()); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const pay = async (c) => {
    if (!window.confirm(`Pay out ${money(c.availableMinor)} to ${c.name}? (test mode — no real transfer)`)) return;
    try { await api.booking.runPayout(c.id); load(); }
    catch (err) { alert(err.message || 'Payout failed'); }
  };

  if (loading) return <Loading />;
  const consultants = data?.consultants || [];
  const payouts = data?.payouts || [];
  return (
    <div>
      <div style={{ padding: 12, background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 10, color: '#9A3412', fontSize: 12.5, marginBottom: 16 }}>
        Test mode: payouts settle instantly with a mock provider — no real money moves. A regulated payout provider + KYC are required before going live.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>
              <th style={th}>Consultant</th><th style={th}>Pending</th><th style={th}>Available</th><th style={th}>Paid out</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {consultants.length === 0 ? (
              <tr><td colSpan={5} style={{ ...td, color: C.textMuted, textAlign: 'center', padding: 24 }}>No consultants yet.</td></tr>
            ) : consultants.map(c => (
              <tr key={c.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ ...td, fontWeight: 600 }}>{c.name}</td>
                <td style={td}>{money(c.pendingMinor)}</td>
                <td style={{ ...td, fontWeight: 700, color: c.availableMinor > 0 ? C.green : C.text }}>{money(c.availableMinor)}</td>
                <td style={td}>{money(c.paidMinor)}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {isAdmin && c.availableMinor > 0 && <button onClick={() => pay(c)} style={primaryBtnStyle}>Pay out</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {payouts.length > 0 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, margin: '24px 0 10px' }}>Recent payouts</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {payouts.map(p => (
              <div key={p.id} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                <span style={{ fontSize: 13 }}>{p.consultantName} · <span style={{ color: C.textMuted }}>{new Date(p.paidAt || p.createdAt).toLocaleDateString('en-IN')}</span></span>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: C.textMuted }}>{p.provider}</span>
                  <span style={{ fontWeight: 700 }}>{money(p.amountMinor)}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
const th = { padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' };
const td = { padding: '10px', color: C.text };

function Tab({ active, onClick, Icon, label }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 7, padding: '10px 14px', background: 'transparent',
      border: 'none', borderBottom: `2px solid ${active ? C.primary : 'transparent'}`,
      color: active ? C.text : C.textSecondary, fontWeight: active ? 700 : 600, fontSize: 14,
      cursor: 'pointer', fontFamily: FONT, marginBottom: -1,
    }}><Icon size={16} /> {label}</button>
  );
}

/* ============================ Appointments tab =========================== */
function BookingsTab({ isAdmin }) {
  const [status, setStatus] = useState('confirmed');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [consultants, setConsultants] = useState([]);
  const [reassignFor, setReassignFor] = useState(null); // booking id showing the picker

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.booking.bookings(status)); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (isAdmin) api.booking.consultants().then(setConsultants).catch(() => {}); }, [isAdmin]);

  const act = async (b, fn, label) => {
    if (label && !window.confirm(label)) return;
    try { await fn(); load(); }
    catch (err) { alert(err.message || 'Action failed'); }
  };
  const reassign = async (b, consultantId) => {
    setReassignFor(null);
    if (!consultantId) return;
    try { await api.booking.reassignBooking(b.id, Number(consultantId)); load(); }
    catch (err) { alert(err.message || 'Reassign failed'); }
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['confirmed', 'completed', 'no_show', 'cancelled'].map(s => (
          <button key={s} onClick={() => setStatus(s)} style={{
            padding: '6px 12px', borderRadius: 99, border: `1px solid ${status === s ? C.primary : C.border}`,
            background: status === s ? C.primary : 'var(--c-cardBg,#fff)', color: status === s ? '#fff' : C.textSecondary,
            fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, textTransform: 'capitalize',
          }}>{s.replace('_', ' ')}</button>
        ))}
      </div>

      {loading ? <Loading /> : rows.length === 0 ? (
        <Empty text="No appointments here yet." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(b => (
            <div key={b.id} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{b.visitorName}</div>
                  <div style={{ fontSize: 13, color: C.textSecondary, marginTop: 2 }}>{b.serviceName} · with {b.consultantName}</div>
                  <div style={{ fontSize: 13, color: C.text, marginTop: 4, fontWeight: 600 }}>{fmtDateTime(b.startsAt, b.timeZone)}</div>
                  <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
                    {b.visitorEmail || ''}{b.visitorEmail && b.visitorPhone ? ' · ' : ''}{b.visitorPhone || ''}
                  </div>
                  {b.notes && <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 6, fontStyle: 'italic' }}>“{b.notes}”</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                  <StatusBadge status={b.status} />
                  {b.paymentStatus && b.paymentStatus !== 'not_required' && <PaymentBadge b={b} />}
                  {b.meetingUrl && (
                    <a href={b.meetingUrl} target="_blank" rel="noreferrer" style={{ ...ghostBtnStyle, textDecoration: 'none', color: C.primary }}>
                      <Video size={14} /> Join Meet
                    </a>
                  )}
                  {isAdmin && b.status === 'confirmed' && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button onClick={() => act(b, () => api.booking.setBookingStatus(b.id, 'completed'))} style={smallBtn}>Complete</button>
                      <button onClick={() => act(b, () => api.booking.setBookingStatus(b.id, 'no_show'))} style={smallBtn}>No-show</button>
                      <button onClick={() => setReassignFor(reassignFor === b.id ? null : b.id)} style={smallBtn}>Reassign</button>
                      <button onClick={() => act(b, () => api.booking.cancelBooking(b.id), `Cancel ${b.visitorName}'s booking?`)} style={{ ...smallBtn, color: C.primary }}>Cancel</button>
                    </div>
                  )}
                  {isAdmin && reassignFor === b.id && (() => {
                    // pg returns bigint ids as strings, so compare as strings.
                    const others = consultants.filter(c => c.active && String(c.id) !== String(b.consultantId));
                    return others.length === 0 ? (
                      <div style={{ fontSize: 11.5, color: C.textMuted, maxWidth: 200, textAlign: 'right' }}>
                        No other active consultant to move to. Add one under the Consultants tab.
                      </div>
                    ) : (
                      <select autoFocus defaultValue="" onChange={e => reassign(b, e.target.value)}
                        style={{ ...smallBtn, cursor: 'pointer', maxWidth: 200 }}>
                        <option value="" disabled>Move to consultant…</option>
                        {others.map(c => (
                          <option key={c.id} value={c.id}>{c.displayName}</option>
                        ))}
                      </select>
                    );
                  })()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    confirmed: ['#166534', '#DCFCE7'], completed: ['#1E3A8A', '#DBEAFE'],
    no_show: ['#9A3412', '#FFEDD5'], cancelled: ['#991B1B', '#FEE2E2'],
  };
  const [fg, bg] = map[status] || ['#334155', '#E2E8F0'];
  return <span style={{ fontSize: 11, fontWeight: 700, color: fg, background: bg, borderRadius: 99, padding: '3px 10px', textTransform: 'capitalize' }}>{status.replace('_', ' ')}</span>;
}

function PaymentBadge({ b }) {
  const amt = `₹${Math.round((b.amountMinor || 0) / 100).toLocaleString('en-IN')}`;
  const map = {
    paid: ['#166534', '#DCFCE7', `Paid ${amt}`],
    due: ['#92400E', '#FEF3C7', `Due ${amt}`],
    pending: ['#1E3A8A', '#DBEAFE', 'Payment pending'],
    failed: ['#991B1B', '#FEE2E2', 'Payment failed'],
    refunded: ['#334155', '#E2E8F0', 'Refunded'],
  };
  const [fg, bg, label] = map[b.paymentStatus] || ['#334155', '#E2E8F0', b.paymentStatus];
  return <span style={{ fontSize: 11, fontWeight: 700, color: fg, background: bg, borderRadius: 99, padding: '3px 10px' }}>{label}</span>;
}

/* ============================== Services tab ============================= */
function ServicesTab({ isAdmin }) {
  const [services, setServices] = useState([]);
  const [consultants, setConsultants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // { service|null }
  const [copied, setCopied] = useState(null);
  const [copiedEmbed, setCopiedEmbed] = useState(null);

  const [accounts, setAccounts] = useState([]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, a] = await Promise.all([api.booking.services(), api.booking.consultants(), api.whatsappAccounts.list().catch(() => [])]);
      setServices(s); setConsultants(c); setAccounts(a);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleActive = async (s) => {
    try { await api.booking.updateService(s.id, { active: !s.active }); load(); }
    catch (err) { alert(err.message || 'Could not update'); }
  };
  const copyLink = (s) => {
    navigator.clipboard?.writeText(bookingBaseUrl(s.slug));
    setCopied(s.id); setTimeout(() => setCopied(null), 1500);
  };
  const copyEmbed = (s) => {
    const snippet = `<div data-forgechat-booking-page="${s.slug}"></div>\n<script async src="${window.location.origin}/booking-widget.js"></script>`;
    navigator.clipboard?.writeText(snippet);
    setCopiedEmbed(s.id); setTimeout(() => setCopiedEmbed(null), 1500);
  };

  if (loading) return <Loading />;
  return (
    <div>
      {isAdmin && (
        <button onClick={() => setModal({ service: null })} style={{ ...primaryBtnStyle, marginBottom: 14 }}>
          <Plus size={15} /> New service
        </button>
      )}
      {services.length === 0 ? <Empty text="No services yet. Create one to publish a booking page." /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {services.map(s => (
            <div key={s.id} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{s.name}</div>
                <span style={{ fontSize: 11, fontWeight: 700, color: s.active ? '#166534' : '#64748B', background: s.active ? '#DCFCE7' : '#F1F5F9', borderRadius: 99, padding: '3px 10px' }}>{s.active ? 'Live' : 'Draft'}</span>
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4, fontFamily: 'monospace' }}>/{s.slug}</div>
              <div style={{ fontSize: 11.5, color: C.textSecondary, marginTop: 2 }}>🏢 {s.waNumber ? `Office +${s.waNumber}` : 'Shared (all offices)'}</div>
              <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 8 }}>
                {s.durationMinutes} min · {s.assignmentPolicy === 'round_robin' ? 'Round-robin' : 'Single host'} · Google Meet
                {s.paymentPolicy && s.paymentPolicy !== 'free'
                  ? ` · ₹${Math.round((s.priceMinor || 0) / 100).toLocaleString('en-IN')}${s.paymentPolicy === 'pay_later' ? ' (pay later)' : ''}`
                  : ' · Free'}
              </div>
              <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>
                {s.consultants.length} consultant{s.consultants.length === 1 ? '' : 's'}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={() => copyLink(s)} style={ghostBtnStyle}>
                  {copied === s.id ? <><Check size={14} /> Copied</> : <><Link2 size={14} /> Copy link</>}
                </button>
                <button onClick={() => copyEmbed(s)} style={ghostBtnStyle} title="Embed snippet for a website">
                  {copiedEmbed === s.id ? <><Check size={14} /> Copied</> : <>{'</>'} Embed</>}
                </button>
                <a href={bookingBaseUrl(s.slug)} target="_blank" rel="noreferrer" style={{ ...ghostBtnStyle, textDecoration: 'none', color: C.text }}>
                  <ExternalLink size={14} /> Preview
                </a>
                {isAdmin && <button onClick={() => setModal({ service: s })} style={ghostBtnStyle}>Edit</button>}
                {isAdmin && <button onClick={() => toggleActive(s)} style={ghostBtnStyle}>{s.active ? 'Unpublish' : 'Publish'}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {modal && (
        <ServiceModal
          service={modal.service}
          consultants={consultants}
          accounts={accounts}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

function ServiceModal({ service, consultants, accounts = [], onClose, onSaved }) {
  const editing = !!service;
  const [form, setForm] = useState(() => ({
    name: service?.name || '',
    slug: service?.slug || '',
    waNumber: service?.waNumber || '',
    description: service?.description || '',
    durationMinutes: service?.durationMinutes ?? 30,
    bufferBeforeMinutes: service?.bufferBeforeMinutes ?? 0,
    bufferAfterMinutes: service?.bufferAfterMinutes ?? 10,
    minimumNoticeMinutes: service?.minimumNoticeMinutes ?? 120,
    bookingHorizonDays: service?.bookingHorizonDays ?? 30,
    slotGranularityMinutes: service?.slotGranularityMinutes ?? 30,
    assignmentPolicy: service?.assignmentPolicy || 'round_robin',
    paymentPolicy: service?.paymentPolicy || 'free',
    price: service?.priceMinor ? service.priceMinor / 100 : '',
    deposit: service?.depositMinor ? service.depositMinor / 100 : '',
  }));
  const [selected, setSelected] = useState(() => new Set((service?.consultants || []).map(c => c.id)));
  const [saving, setSaving] = useState(false);

  const toggle = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = async () => {
    if (!form.name.trim()) { alert('Service name is required'); return; }
    setSaving(true);
    try {
      let id = service?.id;
      const payload = {
        ...form,
        durationMinutes: Number(form.durationMinutes),
        priceMinor: Math.round((Number(form.price) || 0) * 100),
        depositMinor: Math.round((Number(form.deposit) || 0) * 100),
        currency: 'INR',
      };
      if (editing) await api.booking.updateService(id, payload);
      else { const created = await api.booking.createService(payload); id = created.id; }
      await api.booking.setServiceConsultants(id, [...selected]);
      onSaved();
    } catch (err) { alert(err.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title={editing ? 'Edit service' : 'New service'} width={560} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Name"><input style={inp} value={form.name} autoFocus onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Project consultation" /></Field>
        <Field label="URL slug (optional — derived from name)"><input style={inp} value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder="project-consultation" /></Field>
        <Field label="Description"><textarea style={{ ...inp, minHeight: 54, resize: 'vertical' }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Shown on the booking page" /></Field>
        <Field label="Office (WhatsApp number)">
          <select style={inp} value={form.waNumber} onChange={e => setForm({ ...form, waNumber: e.target.value })}>
            <option value="">All offices (shared)</option>
            {accounts.map(a => {
              const num = String(a.displayPhoneNumber || '').replace(/\D/g, '');
              return num ? <option key={a.id} value={num}>{a.displayName || 'WhatsApp'} · +{num}</option> : null;
            })}
          </select>
          <p style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>Assign this service to an office so only that office’s team sees its bookings. “Shared” = visible to admins only.</p>
        </Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Duration (min)" style={{ flex: 1 }}><input style={inp} type="number" min="5" value={form.durationMinutes} onChange={e => setForm({ ...form, durationMinutes: e.target.value })} /></Field>
          <Field label="Slot step (min)" style={{ flex: 1 }}><input style={inp} type="number" min="5" value={form.slotGranularityMinutes} onChange={e => setForm({ ...form, slotGranularityMinutes: e.target.value })} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Buffer before (min)" style={{ flex: 1 }}><input style={inp} type="number" min="0" value={form.bufferBeforeMinutes} onChange={e => setForm({ ...form, bufferBeforeMinutes: e.target.value })} /></Field>
          <Field label="Buffer after (min)" style={{ flex: 1 }}><input style={inp} type="number" min="0" value={form.bufferAfterMinutes} onChange={e => setForm({ ...form, bufferAfterMinutes: e.target.value })} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Min notice (min)" style={{ flex: 1 }}><input style={inp} type="number" min="0" value={form.minimumNoticeMinutes} onChange={e => setForm({ ...form, minimumNoticeMinutes: e.target.value })} /></Field>
          <Field label="Horizon (days)" style={{ flex: 1 }}><input style={inp} type="number" min="1" value={form.bookingHorizonDays} onChange={e => setForm({ ...form, bookingHorizonDays: e.target.value })} /></Field>
          <Field label="Assignment" style={{ flex: 1 }}>
            <select style={inp} value={form.assignmentPolicy} onChange={e => setForm({ ...form, assignmentPolicy: e.target.value })}>
              <option value="round_robin">Round-robin</option>
              <option value="single">Single host</option>
            </select>
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Field label="Payment" style={{ flex: 2, minWidth: 200 }}>
            <select style={inp} value={form.paymentPolicy} onChange={e => setForm({ ...form, paymentPolicy: e.target.value })}>
              <option value="free">Free</option>
              <option value="full_payment_required">Paid — full payment</option>
              <option value="deposit_required">Paid — deposit</option>
              <option value="pay_later">Pay later (at consultation)</option>
              <option value="manual_approval">Request → manual approval</option>
            </select>
          </Field>
          {form.paymentPolicy !== 'free' && (
            <Field label="Price (₹)" style={{ flex: 1, minWidth: 110 }}>
              <input style={inp} type="number" min="0" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="0" />
            </Field>
          )}
          {form.paymentPolicy === 'deposit_required' && (
            <Field label="Deposit (₹)" style={{ flex: 1, minWidth: 110 }}>
              <input style={inp} type="number" min="0" value={form.deposit} onChange={e => setForm({ ...form, deposit: e.target.value })} placeholder="0" />
            </Field>
          )}
        </div>
        {form.paymentPolicy !== 'free' && (
          <p style={{ fontSize: 11, color: C.textMuted, marginTop: -4 }}>
            Until a real payment provider is connected, paid bookings settle in <b>test mode</b> (no real charge). Pay-later records the amount as due.
          </p>
        )}

        <Field label="Eligible consultants">
          {consultants.length === 0 ? (
            <div style={{ fontSize: 12, color: C.textMuted }}>Add consultants first (Consultants tab).</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {consultants.map(c => (
                <button key={c.id} onClick={() => toggle(c.id)} style={{
                  padding: '6px 12px', borderRadius: 99, cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${selected.has(c.id) ? C.primary : C.border}`,
                  background: selected.has(c.id) ? C.primary : 'var(--c-cardBg,#fff)', color: selected.has(c.id) ? '#fff' : C.textSecondary,
                }}>{c.displayName}{c.calendarConnected ? '' : ' (mock cal)'}</button>
              ))}
            </div>
          )}
          <p style={{ fontSize: 11, color: C.textMuted, marginTop: 8 }}>A service must have at least one consultant before it can go Live.</p>
        </Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        <button onClick={save} disabled={saving} style={primaryBtnStyle}>{saving && <Loader2 size={14} className="spin" />} Save</button>
      </div>
    </ModalShell>
  );
}

/* ============================= Consultants tab ========================== */
function ConsultantsTab({ isAdmin }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [users, setUsers] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.booking.consultants()); }
    catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (isAdmin) api.users.list().then(setUsers).catch(() => setUsers([])); }, [isAdmin]);

  const del = async (c) => {
    if (!window.confirm(`Delete consultant "${c.displayName}"?`)) return;
    try { await api.booking.deleteConsultant(c.id); load(); }
    catch (err) { alert(err.message || 'Delete failed'); }
  };

  if (loading) return <Loading />;
  return (
    <div>
      {isAdmin && (
        <button onClick={() => setModal({ consultant: null })} style={{ ...primaryBtnStyle, marginBottom: 14 }}>
          <Plus size={15} /> New consultant
        </button>
      )}
      {rows.length === 0 ? <Empty text="No consultants yet." /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {rows.map(c => (
            <div key={c.id} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{c.displayName}</div>
                <span style={{ fontSize: 11, fontWeight: 700, color: c.active ? '#166534' : '#64748B', background: c.active ? '#DCFCE7' : '#F1F5F9', borderRadius: 99, padding: '3px 10px' }}>{c.active ? 'Active' : 'Off'}</span>
              </div>
              <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 4 }}>{c.email || 'no email'}</div>
              <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>{c.timeZone}</div>
              <div style={{ marginTop: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: c.calendarConnected ? '#1E3A8A' : '#92400E', background: c.calendarConnected ? '#DBEAFE' : '#FEF3C7', borderRadius: 99, padding: '2px 8px' }}>
                  {c.calendarConnected ? 'Google Calendar linked' : 'Mock calendar (always free)'}
                </span>
              </div>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={() => setModal({ consultant: c })} style={ghostBtnStyle}>Edit</button>
                  <button onClick={() => del(c)} style={{ ...ghostBtnStyle, color: C.primary }}><Trash2 size={14} /> Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {modal && <ConsultantModal consultant={modal.consultant} users={users} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
    </div>
  );
}

function defaultHours() {
  return { '1': [['09:00', '17:00']], '2': [['09:00', '17:00']], '3': [['09:00', '17:00']], '4': [['09:00', '17:00']], '5': [['09:00', '17:00']] };
}
function ConsultantModal({ consultant, users = [], onClose, onSaved }) {
  const editing = !!consultant;
  const [form, setForm] = useState(() => ({
    displayName: consultant?.displayName || '',
    email: consultant?.email || '',
    userId: consultant?.userId || '',
    timeZone: consultant?.timeZone || 'Asia/Kolkata',
    active: consultant?.active ?? true,
    googleCredentialId: consultant?.googleCredentialId || '',
    commissionType: consultant?.commissionType || 'none',
    commissionValue: consultant?.commissionType === 'percentage'
      ? (consultant?.commissionBps || 0) / 100
      : consultant?.commissionType === 'fixed'
        ? (consultant?.commissionFixedMinor || 0) / 100
        : '',
  }));
  const [googleAccounts, setGoogleAccounts] = useState([]);
  useEffect(() => { api.booking.googleAccounts().then(setGoogleAccounts).catch(() => setGoogleAccounts([])); }, []);
  const connectCalendar = async () => {
    try {
      const { authUrl } = await api.booking.googleAuthorize();
      window.location.href = authUrl; // full-page consent; returns to Settings
    } catch (err) { alert(err.message || 'Could not start Google connect'); }
  };
  // Simple single-window-per-day editor.
  const [hours, setHours] = useState(() => {
    const src = consultant?.workingHours || defaultHours();
    const map = {};
    for (const [d] of WEEKDAYS) {
      const w = src[d];
      map[d] = w && w[0] ? { on: true, start: w[0][0], end: w[0][1] } : { on: false, start: '09:00', end: '17:00' };
    }
    return map;
  });
  const [saving, setSaving] = useState(false);

  const setDay = (d, patch) => setHours(prev => ({ ...prev, [d]: { ...prev[d], ...patch } }));

  const save = async () => {
    if (!form.displayName.trim()) { alert('Name is required'); return; }
    const workingHours = {};
    for (const [d] of WEEKDAYS) if (hours[d].on) workingHours[d] = [[hours[d].start, hours[d].end]];
    const commission = form.commissionType === 'percentage'
      ? { commissionType: 'percentage', commissionBps: Math.round((Number(form.commissionValue) || 0) * 100), commissionFixedMinor: 0 }
      : form.commissionType === 'fixed'
        ? { commissionType: 'fixed', commissionFixedMinor: Math.round((Number(form.commissionValue) || 0) * 100), commissionBps: 0 }
        : { commissionType: 'none', commissionBps: 0, commissionFixedMinor: 0 };
    setSaving(true);
    try {
      const payload = { ...form, workingHours, ...commission };
      if (editing) await api.booking.updateConsultant(consultant.id, payload);
      else await api.booking.createConsultant(payload);
      onSaved();
    } catch (err) { alert(err.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title={editing ? 'Edit consultant' : 'New consultant'} width={520} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="User account (this consultant's login)">
          <select style={inp} value={form.userId} onChange={e => {
            const uid = e.target.value;
            const u = users.find(x => String(x.id) === String(uid));
            setForm(f => ({ ...f, userId: uid, displayName: f.displayName || (u?.displayName || ''), email: f.email || (u?.email || '') }));
          }}>
            <option value="">— Select a user —</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.displayName || u.username} ({u.email})</option>)}
          </select>
          <p style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>A consultant must be a user — when they’re booked with a customer, that customer’s chat is shared with them automatically. No user yet? Create one under Settings → Users.</p>
        </Field>
        <Field label="Display name"><input style={inp} value={form.displayName} autoFocus onChange={e => setForm({ ...form, displayName: e.target.value })} placeholder="e.g. Priya Sharma" /></Field>
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Workspace email" style={{ flex: 2 }}><input style={inp} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="priya@company.com" /></Field>
          <Field label="Time zone" style={{ flex: 2 }}><input style={inp} value={form.timeZone} onChange={e => setForm({ ...form, timeZone: e.target.value })} placeholder="Asia/Kolkata" /></Field>
        </div>
        <Field label="Working hours">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {WEEKDAYS.map(([d, label]) => (
              <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, width: 70, fontSize: 13, color: C.text }}>
                  <input type="checkbox" checked={hours[d].on} onChange={e => setDay(d, { on: e.target.checked })} /> {label}
                </label>
                <input type="time" style={{ ...inp, width: 120, opacity: hours[d].on ? 1 : 0.4 }} value={hours[d].start} disabled={!hours[d].on} onChange={e => setDay(d, { start: e.target.value })} />
                <span style={{ color: C.textMuted }}>–</span>
                <input type="time" style={{ ...inp, width: 120, opacity: hours[d].on ? 1 : 0.4 }} value={hours[d].end} disabled={!hours[d].on} onChange={e => setDay(d, { end: e.target.value })} />
              </div>
            ))}
          </div>
        </Field>
        <Field label="Google Calendar">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select style={{ ...inp, flex: 1, minWidth: 180 }} value={form.googleCredentialId}
              onChange={e => setForm({ ...form, googleCredentialId: e.target.value })}>
              <option value="">Mock calendar (always free)</option>
              {googleAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.label}{a.healthy ? '' : ' (needs reconnect)'}</option>
              ))}
            </select>
            <button type="button" onClick={connectCalendar} style={ghostBtnStyle}>+ Connect a Google account</button>
          </div>
        </Field>
        <Field label="Commission (payout per paid booking)">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select style={{ ...inp, flex: 1 }} value={form.commissionType} onChange={e => setForm({ ...form, commissionType: e.target.value })}>
              <option value="none">None</option>
              <option value="percentage">Percentage of payment</option>
              <option value="fixed">Fixed amount</option>
            </select>
            {form.commissionType !== 'none' && (
              <input style={{ ...inp, width: 120 }} type="number" min="0" value={form.commissionValue}
                onChange={e => setForm({ ...form, commissionValue: e.target.value })}
                placeholder={form.commissionType === 'percentage' ? '%' : '₹'} />
            )}
            {form.commissionType !== 'none' && <span style={{ fontSize: 13, color: C.textMuted }}>{form.commissionType === 'percentage' ? '%' : '₹'}</span>}
          </div>
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.text }}>
          <input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} /> Active (available for bookings)
        </label>
        <p style={{ fontSize: 11, color: C.textMuted }}>
          Link a connected Google account to use that consultant’s real calendar (free/busy + Meet links).
          With “Mock calendar”, availability treats them as always free apart from existing bookings.
          Connecting opens Google’s consent screen; you’ll return to Settings, then pick the account here.
        </p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <button onClick={onClose} style={ghostBtnStyle}>Cancel</button>
        <button onClick={save} disabled={saving} style={primaryBtnStyle}>{saving && <Loader2 size={14} className="spin" />} Save</button>
      </div>
    </ModalShell>
  );
}

/* ----------------------------- small primitives --------------------------- */
function Loading() { return <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontFamily: FONT }}><Loader2 size={18} className="spin" /></div>; }
function Empty({ text }) { return <div style={{ padding: '48px 24px', textAlign: 'center', color: C.textMuted, fontSize: 13 }}>{text}</div>; }
function Field({ label, children, style }) {
  return (
    <div style={style}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}
function ModalShell({ title, width = 480, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--c-cardBg, #fff)', borderRadius: 14, width, maxWidth: '94vw', maxHeight: '92vh', overflow: 'auto', boxShadow: C.shadowLg, padding: 22, fontFamily: FONT }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: C.textMuted }}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* --------------------------------- styles --------------------------------- */
const cardStyle = { background: 'var(--c-cardBg, #fff)', border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 };
const inp = { width: '100%', padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13, fontFamily: FONT, outline: 'none', background: 'var(--c-cardBg, #fff)', color: C.text, boxSizing: 'border-box' };
const primaryBtnStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: C.primary, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
const ghostBtnStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: 'var(--c-cardBg, #fff)', color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
const smallBtn = { padding: '5px 10px', background: 'var(--c-cardBg,#fff)', color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: FONT };
