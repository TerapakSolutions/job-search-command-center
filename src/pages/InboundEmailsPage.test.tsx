/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import InboundEmailsPage from './InboundEmailsPage';
import * as inboundEmailsClient from '../api/inboundEmailsClient';

jest.mock('../api/inboundEmailsClient');
jest.mock('../api/persistence', () => ({
  isDemoMode: () => false,
  getApiBaseUrl: () => '/api',
}));

const mockFetchInboundEmails = jest.mocked(inboundEmailsClient.fetchInboundEmails);
const mockFetchInboundEmailById = jest.mocked(inboundEmailsClient.fetchInboundEmailById);
const mockMarkInboundEmailProcessed = jest.mocked(
  inboundEmailsClient.markInboundEmailProcessed,
);

const sampleList = {
  items: [
    {
      id: 'email-1',
      subject: 'Interview invite',
      fromEmail: 'recruiter@acme.com',
      toEmail: 'seeker@example.com',
      receivedAt: '2026-07-01T09:00:00.000Z',
      processed: false,
    },
  ],
  total: 1,
  limit: 100,
  offset: 0,
};

describe('InboundEmailsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchInboundEmails.mockResolvedValue(sampleList);
    mockFetchInboundEmailById.mockResolvedValue({
      ...sampleList.items[0],
      provider: 'postmark',
      textBody: 'Hello candidate',
      htmlBody: '<p>Hello candidate</p>',
    });
    mockMarkInboundEmailProcessed.mockResolvedValue({
      ...sampleList.items[0],
      processed: true,
    });
  });

  it('renders list and detail after selecting an email', async () => {
    render(
      <MemoryRouter>
        <InboundEmailsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Interview invite')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /recruiter@acme.com/i }));

    await waitFor(() => {
      expect(mockFetchInboundEmailById).toHaveBeenCalledWith('email-1');
    });
    expect(await screen.findByText('Hello candidate')).toBeTruthy();
  });

  it('marks email as reviewed', async () => {
    render(
      <MemoryRouter>
        <InboundEmailsPage />
      </MemoryRouter>,
    );

    await screen.findByText('Interview invite');
    await userEvent.click(screen.getByRole('button', { name: /recruiter@acme.com/i }));
    await screen.findByText('Mark reviewed');

    await userEvent.click(screen.getByRole('button', { name: /Mark reviewed/i }));

    await waitFor(() => {
      expect(mockMarkInboundEmailProcessed).toHaveBeenCalledWith('email-1', true);
    });
    expect(screen.queryByRole('button', { name: /Mark reviewed/i })).toBeNull();
  });

  it('shows empty state when no emails', async () => {
    mockFetchInboundEmails.mockResolvedValue({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
    });

    render(
      <MemoryRouter>
        <InboundEmailsPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('No inbound emails match your filters.'),
    ).toBeTruthy();
  });
});
