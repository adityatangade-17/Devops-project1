import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContactsPage from '../ContactsPage.jsx';

vi.mock('../../api.js', () => ({
  api: {
    numbers: vi.fn(),
    savedContacts: vi.fn(),
    stopContacts: vi.fn(),
    contact: vi.fn(),
    categories: { list: vi.fn() },
    tags: { list: vi.fn() },
    contactFields: { list: vi.fn() },
  },
}));

import { api } from '../../api.js';

const WA_NUMBER = '919000000000';
const CONTACT = {
  contact_number: '919111111111', name: 'Normal Contact', tags: [], custom_fields: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  api.numbers.mockResolvedValue([{ wa_number: WA_NUMBER, display_name: 'EPR Seva' }]);
  api.savedContacts.mockResolvedValue([CONTACT]);
  api.contact.mockResolvedValue(CONTACT);
  api.categories.list.mockResolvedValue([]);
  api.tags.list.mockResolvedValue([]);
  api.contactFields.list.mockResolvedValue([]);
});

describe('ContactsPage chat navigation', () => {
  it('opens the exact existing chat when a contact name is clicked', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<ContactsPage user={{ role: 'bda_sales' }} onNavigate={onNavigate} />);

    await user.click(await screen.findByRole('button', { name: 'Normal Contact' }));
    expect(onNavigate).toHaveBeenCalledWith('chats', WA_NUMBER, CONTACT.contact_number);
  });

  it('uses the same chat route from the contact details dialog', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<ContactsPage user={{ role: 'bda_sales' }} onNavigate={onNavigate} />);

    await screen.findByRole('button', { name: 'Normal Contact' });
    await user.click(screen.getAllByRole('row')[1]);
    await screen.findByText('Contact Details');
    await user.click(screen.getAllByRole('button', { name: 'Normal Contact' })[1]);
    expect(onNavigate).toHaveBeenCalledWith('chats', WA_NUMBER, CONTACT.contact_number);
  });
});
