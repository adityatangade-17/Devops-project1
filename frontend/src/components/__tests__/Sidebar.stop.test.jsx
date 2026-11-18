import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Sidebar from '../Sidebar.jsx';

describe('Sidebar STOP contacts', () => {
  it('shows the STOP Contacts menu to users with Contacts access', () => {
    render(<Sidebar activePage="contacts" onPageChange={() => {}} collapsed={false} setCollapsed={() => {}} user={{ role: 'bda_sales', pages: ['contacts'] }} />);
    expect(screen.getByText('STOP Contacts')).toBeInTheDocument();
  });
});
