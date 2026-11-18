import { useState, useEffect } from 'react';
import { Search, User, UserCheck } from 'lucide-react';
import { usePolling } from '../hooks/usePolling.js';
import { api } from '../api.js';
import { C, FONT, relativeTime, maskPhone, darkenColor } from '../constants.js';
import TagMultiSelect from './TagMultiSelect.jsx';
import SearchableSelect from './SearchableSelect.jsx';

const ROLE_LABELS = {
  admin: 'Admin',
  team_lead: 'Team lead',
  bda_sales: 'Sales',
  consultant: 'Consultant',
  viewer: 'Viewer',
};

export default function ContactList({ waNumber, width = 380, selectedContact, onSelectContact, refreshKey, user }) {
  const [search, setSearch] = useState('');
  const [categories, setCategories] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [filterTagIds, setFilterTagIds] = useState([]);
  const [conversationFilter, setConversationFilter] = useState('all');
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [bulkAssignedUserId, setBulkAssignedUserId] = useState('');
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [waName, setWaName] = useState(null); // saved display name for this business number
  const [selectFields, setSelectFields] = useState([]); // dropdown custom fields (e.g. Call Status)
  const [fieldOverrides, setFieldOverrides] = useState({}); // optimistic { "phone:fieldId": value }
  const [openStatusFor, setOpenStatusFor] = useState(null); // contact_number whose status menu is open
  // How far back to pull the chat list. 'all' shows every contact that ever
  // messaged this number (e.g. a full broadcast audience), not just the recently
  // active slice. Narrow it to speed up very large lists.
  const [timeRange, setTimeRange] = useState('all');

  // Resolve the saved display name for this WhatsApp number (shown in header).
  useEffect(() => {
    let alive = true;
    setWaName(null);
    api.numbers().then(nums => {
      if (!alive) return;
      const m = (nums || []).find(n => n.wa_number === waNumber);
      setWaName(m?.display_name || null);
    }).catch(() => {});
    return () => { alive = false; };
  }, [waNumber]);
  // Polling refresh (every 60s — lighter on large contact lists).
  const { data, loading, refetch } = usePolling(() => api.contacts(waNumber, timeRange), 60000, [waNumber, timeRange]);
  // The single dropdown field shown inline on each row (Call Status if present).
  const statusField = selectFields.find(f => /call\s*status/i.test(f.name)) || selectFields[0] || null;

  // Tag taxonomy for the filter dropdown.
  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {});
    api.tags.list().then(setAllTags).catch(() => {});
    // Dropdown custom fields (Call Status, Lead Quality, …) for inline quick-set.
    api.contactFields.list()
      .then(fields => setSelectFields((fields || []).filter(f => f.field_type === 'select')))
      .catch(() => {});
    if (user?.role === 'admin') {
      api.users.list().then(setAssignableUsers).catch(() => setAssignableUsers([]));
    }
  }, [user]);

  // Quick-set a dropdown field straight from the chat row (no need to open the chat).
  const setContactField = async (contact, fieldId, value) => {
    const key = `${contact.contact_number}:${fieldId}`;
    setFieldOverrides(prev => ({ ...prev, [key]: value }));
    try {
      await api.saveContact(
        waNumber,
        contact.contact_number,
        '',                                   // blank name = keep existing
        contact.tags || [],                   // preserve tags
        { ...(contact.custom_fields || {}), [fieldId]: value }
      );
      refetch();
    } catch (err) {
      // Roll back the optimistic value on failure
      setFieldOverrides(prev => { const n = { ...prev }; delete n[key]; return n; });
      alert('Could not save: ' + (err.message || 'unknown error'));
    }
  };

  useEffect(() => {
    if (refreshKey) refetch();
  }, [refreshKey, refetch]);

  const tagMatchedContacts = (data || []).filter(c => {
    if (filterTagIds.length === 0) return true;
    const ids = (c.tags || []).map(t => String(t.id));
    return filterTagIds.every(id => ids.includes(String(id)));
  });

  const contacts = tagMatchedContacts.filter(c => {
    const matchesSearch = !search || c.contact_number.includes(search) || (c.name && c.name.toLowerCase().includes(search.toLowerCase()));
    if (!matchesSearch) return false;
    if (conversationFilter === 'unread' && (Number(c.unread_count) || 0) === 0) return false;
    return true;
  });

  const getDisplayName = (c) => c.name || `+${maskPhone(c.contact_number)}`;

  const handleBulkAssign = async () => {
    if (user?.role !== 'admin' || filterTagIds.length === 0 || tagMatchedContacts.length === 0) return;
    const contactNumbers = tagMatchedContacts.map(c => c.contact_number);
    const assignedUserId = bulkAssignedUserId === '__unassigned__' ? null : bulkAssignedUserId;
    if (assignedUserId === '') return;

    setBulkAssigning(true);
    try {
      let updated = 0;
      for (let i = 0; i < contactNumbers.length; i += 5000) {
        const result = await api.bulkAssignContacts(waNumber, contactNumbers.slice(i, i + 5000), assignedUserId);
        updated += Number(result.updated) || 0;
      }
      const assignee = assignedUserId == null
        ? 'Unassigned'
        : (assignableUsers.find(u => String(u.id) === String(assignedUserId))?.displayName || 'the selected consultant');
      await refetch();
      alert(`${updated} lead${updated === 1 ? '' : 's'} ${assignedUserId == null ? 'unassigned' : `assigned to ${assignee}`}.`);
    } catch (err) {
      alert(`Failed to assign leads: ${err.message || 'unknown error'}`);
    } finally {
      setBulkAssigning(false);
    }
  };

  const getInitials = (name) => {
    if (!name) return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  return (
    <div style={{
      width, minWidth: width,
      background: 'var(--c-cardBg)',
      borderRight: `1px solid ${C.borderDark}`,
      display: 'flex', flexDirection: 'column',
      flexShrink: 0, height: '100%', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--c-chatPanel)',
        borderBottom: `1px solid ${C.borderDark}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {waName || maskPhone(waNumber) || 'Contacts'}
          </span>
          <span style={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
            {contacts.length} contacts
          </span>
        </div>
        {/* Time-range: how far back to load the chat list. Defaults to All time
            so a full broadcast audience is visible, not just recent chats. */}
        <select
          value={timeRange}
          onChange={e => setTimeRange(e.target.value)}
          title="How far back to load chats"
          style={{
            fontSize: 12, fontFamily: FONT, color: C.text, cursor: 'pointer',
            background: 'var(--c-cardBg)', border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '5px 8px', outline: 'none', flexShrink: 0,
          }}
        >
          <option value="all">All time</option>
          <option value="1y">Last year</option>
          <option value="90d">Last 90 days</option>
          <option value="30d">Last 30 days</option>
          <option value="7d">Last 7 days</option>
          <option value="24h">Last 24 hours</option>
        </select>
      </div>

      {/* Search + conversation/tag filters */}
      <div style={{ padding: '8px 12px', background: 'var(--c-cardBg)', borderBottom: `1px solid ${C.borderDark}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--c-chatPanel)', borderRadius: 8,
          padding: '6px 12px',
        }}>
          <Search size={16} color={C.textMuted} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by phone..."
            style={{
              flex: 1, border: 'none', background: 'transparent',
              fontSize: 14, fontFamily: FONT, outline: 'none', color: C.text,
            }}
          />
        </div>
        <div
          role="group"
          aria-label="Conversation filter"
          style={{ display: 'flex', alignItems: 'center', gap: 4 }}
        >
          {[
            ['all', 'All'],
            ['unread', 'Unread'],
          ].map(([value, label]) => {
            const active = conversationFilter === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setConversationFilter(value)}
                style={{
                  border: `1px solid ${active ? C.primary : C.border}`,
                  borderRadius: 999,
                  padding: '5px 11px',
                  background: active ? C.primaryLight : 'var(--c-cardBg)',
                  color: active ? C.primary : C.textSecondary,
                  fontSize: 12,
                  fontFamily: FONT,
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <TagMultiSelect
          categories={categories}
          tags={allTags}
          selectedIds={filterTagIds}
          onChange={setFilterTagIds}
          minWidth="100%"
          placeholder="Filter by tag (all selected)"
        />
        {filterTagIds.length > 1 && (
          <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FONT }}>
            Showing leads that have all {filterTagIds.length} selected tags.
          </div>
        )}
        {user?.role === 'admin' && filterTagIds.length > 0 && (
          <div
            aria-label="Bulk assignment by tag"
            style={{ padding: 8, border: `1px solid ${C.border}`, borderRadius: 8, background: 'var(--c-chatPanel)', display: 'flex', flexDirection: 'column', gap: 7 }}
          >
            <div style={{ fontSize: 11, color: C.textSecondary, fontFamily: FONT }}>
              {tagMatchedContacts.length} lead{tagMatchedContacts.length === 1 ? '' : 's'} have the selected tag{filterTagIds.length === 1 ? '' : 's'}
            </div>
            <SearchableSelect
              value={bulkAssignedUserId}
              onChange={setBulkAssignedUserId}
              disabled={bulkAssigning || tagMatchedContacts.length === 0}
              options={[
                { value: '__unassigned__', label: 'Unassigned' },
                ...assignableUsers.filter(u => u.isActive !== false).map(u => ({
                  value: String(u.id),
                  label: u.displayName || u.username,
                  sublabel: ROLE_LABELS[u.role] || u.role,
                })),
              ]}
              placeholder="Choose consultant…"
              searchPlaceholder="Search consultants…"
              triggerStyle={{ paddingTop: 8, paddingBottom: 8 }}
            />
            <button
              type="button"
              onClick={handleBulkAssign}
              disabled={bulkAssigning || tagMatchedContacts.length === 0 || bulkAssignedUserId === ''}
              style={{
                border: 'none', borderRadius: 8, padding: '8px 10px', fontFamily: FONT,
                fontSize: 12, fontWeight: 700, color: '#fff',
                background: (bulkAssigning || tagMatchedContacts.length === 0 || bulkAssignedUserId === '') ? '#9CA3AF' : C.primary,
                cursor: (bulkAssigning || tagMatchedContacts.length === 0 || bulkAssignedUserId === '') ? 'not-allowed' : 'pointer',
              }}
            >
              {bulkAssigning ? 'Assigning…' : `Assign ${tagMatchedContacts.length} matching lead${tagMatchedContacts.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}
      </div>

      {/* Contact list */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--c-cardBg)' }}>
        {loading && !data && (
          <div style={{ padding: 30, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
            Loading chats...
          </div>
        )}

        {contacts.map(c => {
          const isActive = selectedContact === c.contact_number;
          const contactTags = c.tags || [];
          const displayName = getDisplayName(c);
          const unread = Number(c.unread_count) || 0;

          return (
            <div
              key={c.contact_number}
              role="button"
              tabIndex={0}
              onClick={() => onSelectContact(c.contact_number)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 16px',
                borderBottom: `1px solid ${C.border}`,
                cursor: 'pointer',
                background: isActive ? C.primaryLight : C.cardBg,
                fontFamily: FONT,
                textAlign: 'left',
                transition: 'background .1s',
                position: 'relative',
                boxSizing: 'border-box',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = C.hover; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = C.cardBg; }}
            >
              {/* Active indicator */}
              {isActive && (
                <div style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: 4, background: C.primary,
                }} />
              )}

              {/* Avatar */}
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: isActive ? C.primary : C.primaryLight,
                color: isActive ? '#fff' : C.primary,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700, flexShrink: 0,
              }}>
                {c.name ? getInitials(c.name) : <User size={20} />}
              </div>

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    fontSize: 15, fontWeight: 700, color: c.marketing_opted_out ? '#B91C1C' : C.text,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {displayName}
                  </span>
                  <span style={{
                    fontSize: 11, color: c.message_count > 0 ? C.primary : C.textMuted,
                    flexShrink: 0, marginLeft: 8,
                  }}>
                    {relativeTime(c.last_message_time)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{
                    fontSize: 13, color: unread > 0 && !isActive ? C.text : C.textSecondary,
                    fontWeight: unread > 0 && !isActive ? 600 : 400,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0,
                  }}>
                    {c.last_message || 'No messages'}
                  </span>
                  {unread > 0 && !isActive && (
                    <span style={{
                      flexShrink: 0,
                      background: C.primary, color: '#fff',
                      borderRadius: 11, minWidth: 20, height: 20, padding: '0 6px',
                      fontSize: 12, fontWeight: 700,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: c.assigned_user_name ? C.textSecondary : C.textMuted, fontSize: 11, minWidth: 0 }}>
                  <UserCheck size={12} style={{ flexShrink: 0 }} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.assigned_user_name ? `Assigned to ${c.assigned_user_name}` : 'Unassigned'}
                  </span>
                </div>
                {contactTags.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2, alignItems: 'center' }}>
                    {contactTags.map(t => (
                      <span key={t.id} style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        alignSelf: 'flex-start',
                        padding: '2px 8px',
                        borderRadius: 999,
                        background: `${t.color}1A`,
                        color: darkenColor(t.color),
                        border: `1px solid ${t.color}33`,
                        fontSize: 10,
                        fontWeight: 600,
                        lineHeight: 1.5,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.color, flexShrink: 0 }} />
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Lightweight Call Status pill — opens a small menu on click only
                    (avoids rendering a heavy native <select> for every row). */}
                {statusField && (() => {
                  const key = `${c.contact_number}:${statusField.id}`;
                  const val = fieldOverrides[key] ?? (c.custom_fields || {})[statusField.id] ?? '';
                  const isOpen = openStatusFor === c.contact_number;
                  return (
                    <div style={{ marginTop: 4, position: 'relative' }}>
                      <span
                        role="button"
                        onClick={e => { e.stopPropagation(); setOpenStatusFor(isOpen ? null : c.contact_number); }}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 11, fontFamily: FONT, padding: '3px 9px', borderRadius: 999,
                          border: `1px solid ${val ? C.primary : C.border}`,
                          background: val ? C.primaryLight : 'var(--c-cardBg)',
                          color: val ? C.primary : C.textSecondary,
                          fontWeight: val ? 700 : 500, cursor: 'pointer',
                        }}
                      >
                        {val || `${statusField.name}…`} ▾
                      </span>
                      {isOpen && (
                        <div
                          onClick={e => e.stopPropagation()}
                          style={{
                            position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 20,
                            background: 'var(--c-cardBg)', border: `1px solid ${C.border}`,
                            borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,.15)', minWidth: 150, padding: 4,
                          }}
                        >
                          {['', ...(Array.isArray(statusField.options) ? statusField.options : [])].map(opt => (
                            <div
                              key={opt || '__none'}
                              onClick={e => { e.stopPropagation(); setOpenStatusFor(null); setContactField(c, statusField.id, opt); }}
                              style={{
                                padding: '6px 10px', borderRadius: 6, fontSize: 12, fontFamily: FONT,
                                cursor: 'pointer', color: opt ? C.text : C.textMuted,
                                background: opt === val ? C.primaryLight : 'transparent',
                              }}
                              onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = opt === val ? C.primaryLight : 'transparent'; }}
                            >
                              {opt || 'Clear'}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })},

        {contacts.length === 0 && !loading && (
          <div style={{ padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 13 }}>
            No chats found
          </div>
        )}
      </div>
    </div>
  );
}
