import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactList from '../ContactList.jsx';

vi.mock('../../api.js', () => ({
  api: {
    numbers: vi.fn(),
    contacts: vi.fn(),
    categories: { list: vi.fn() },
    tags: { list: vi.fn() },
    contactFields: { list: vi.fn() },
    users: { list: vi.fn() },
    bulkAssignContacts: vi.fn(),
  },
}));

import { api } from '../../api.js';

const unreadContact = {
  contact_number: '919111111111', name: 'Unread Contact', unread_count: 2,
  message_count: 1, last_message: 'Please call me', last_message_time: new Date().toISOString(), tags: [],
};
const readContact = {
  contact_number: '919222222222', name: 'Read Contact', unread_count: 0,
  message_count: 1, last_message: 'Thank you', last_message_time: new Date().toISOString(), tags: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.numbers.mockResolvedValue([]);
  api.contacts.mockResolvedValue([unreadContact, readContact]);
  api.categories.list.mockResolvedValue([]);
  api.tags.list.mockResolvedValue([]);
  api.contactFields.list.mockResolvedValue([]);
  api.users.list.mockResolvedValue([]);
  api.bulkAssignContacts.mockResolvedValue({ ok: true, updated: 1 });
});

describe('ContactList consultant assignment', () => {
  const mh = { id: 'tag-mh', name: 'MH', color: '#2563EB' };
  const importer = { id: 'tag-importer', name: 'Importer', color: '#16A34A' };
  const taggedContacts = [
    { ...unreadContact, contact_number: '919111111111', name: 'Both Tags', tags: [mh, importer], assigned_user_name: 'Asha' },
    { ...readContact, contact_number: '919222222222', name: 'MH Only', tags: [mh], assigned_user_name: null },
  ];

  it('shows the assigned consultant on each lead and matches multiple tags with AND semantics', async () => {
    const user = userEvent.setup();
    api.contacts.mockResolvedValue(taggedContacts);
    api.tags.list.mockResolvedValue([mh, importer]);
    renderList();

    expect(await screen.findByText('Assigned to Asha')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Filter by tag/ }));
    await user.click(screen.getAllByText('MH')[0]);
    await user.click(screen.getAllByText('Importer')[0]);

    expect(screen.getByText('Both Tags')).toBeInTheDocument();
    expect(screen.queryByText('MH Only')).not.toBeInTheDocument();
  });

  it('bulk assigns all leads matching the selected tag to a consultant', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    api.contacts.mockResolvedValue(taggedContacts);
    api.tags.list.mockResolvedValue([mh, importer]);
    api.users.list.mockResolvedValue([{ id: 7, displayName: 'Priya', role: 'consultant', isActive: true }]);

    render(<ContactList waNumber="919000000000" selectedContact={null} onSelectContact={() => {}} user={{ role: 'admin' }} />);
    await screen.findByText('Both Tags');
    await user.click(screen.getByRole('button', { name: /Filter by tag/ }));
    await user.click(screen.getAllByText('Importer')[0]);
    await user.click(screen.getByRole('button', { name: 'Choose consultant…' }));
    await user.click(screen.getByText('Priya'));
    await user.click(screen.getByRole('button', { name: 'Assign 1 matching lead' }));

    await waitFor(() => expect(api.bulkAssignContacts).toHaveBeenCalledWith(
      '919000000000',
      ['919111111111'],
      '7',
    ));
  });
});

function renderList() {
  return render(<ContactList waNumber="919000000000" selectedContact={null} onSelectContact={() => {}} />);
}

describe('ContactList unread filter', () => {
  it('shows the normal conversation list under All and only unread conversations under Unread', async () => {
    const user = userEvent.setup();
    renderList();
    expect(await screen.findByText('Unread Contact')).toBeInTheDocument();
    expect(screen.getByText('Read Contact')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Unread' }));
    expect(screen.getByText('Unread Contact')).toBeInTheDocument();
    expect(screen.queryByText('Read Contact')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Read Contact')).toBeInTheDocument();
  });

  it('combines search with the unread filter', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Unread Contact');
    await user.click(screen.getByRole('button', { name: 'Unread' }));
    await user.type(screen.getByPlaceholderText('Search by phone...'), '2222');

    await waitFor(() => expect(screen.getByText('No chats found')).toBeInTheDocument());
    await user.clear(screen.getByPlaceholderText('Search by phone...'));
    expect(screen.getByText('Unread Contact')).toBeInTheDocument();
  });
});
