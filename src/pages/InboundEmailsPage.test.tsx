/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import InboundEmailsPage from './InboundEmailsPage';
import * as inboundEmailsClient from '../api/inboundEmailsClient';

jest.mock('../api/inboundEmailsClient');
jest.mock('../api/emailAutomationClient', () => ({
  fetchEmailAutomationAnalysis: jest.fn().mockResolvedValue({
    emailId: 'email-1',
    matches: {
      matches: [
        {
          applicationId: 'app-1',
          company: 'Acme Corp',
          roleTitle: 'Engineer',
          status: 'applied',
          confidence: 85,
          matchReasons: ['Company match'],
        },
      ],
      bestMatch: {
        applicationId: 'app-1',
        company: 'Acme Corp',
        roleTitle: 'Engineer',
        status: 'applied',
        confidence: 85,
        matchReasons: ['Company match'],
      },
      requiresManualSelection: false,
    },
    nextActions: [
      {
        type: 'reply',
        label: 'Reply to recruiter',
        description: 'Send a timely response',
        priority: 'high',
      },
    ],
    pipelineProposal: {
      applicationId: 'app-1',
      currentStatus: 'applied',
      proposedStatus: 'interviewing',
      confidence: 90,
      requiresApproval: false,
      reason: 'Interview request',
    },
    canCreateApplication: false,
    duplicateApplicationId: null,
  }),
  runEmailAutomation: jest.fn(),
  createApplicationFromEmail: jest.fn(),
  createContactFromEmail: jest.fn(),
  updatePipelineFromEmail: jest.fn(),
  draftReplyFromEmail: jest.fn(),
}));
jest.mock('../api/persistence', () => ({
  isDemoMode: () => false,
  getApiBaseUrl: () => '/api',
}));

const mockFetchInboundEmails = jest.mocked(inboundEmailsClient.fetchInboundEmails);
const mockFetchInboundEmailById = jest.mocked(inboundEmailsClient.fetchInboundEmailById);
const mockMarkInboundEmailProcessed = jest.mocked(
  inboundEmailsClient.markInboundEmailProcessed,
);
const mockClassifyInboundEmail = jest.mocked(inboundEmailsClient.classifyInboundEmail);
const mockClassifyUnprocessedInboundEmails = jest.mocked(
  inboundEmailsClient.classifyUnprocessedInboundEmails,
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
      classification: 'Interview Request',
      classificationConfidence: 90,
      suggestedAction: 'Reply to schedule the interview',
      requiresResponse: true,
      processedAt: '2026-07-01T10:00:00.000Z',
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
      companyName: 'Acme Corp',
      positionTitle: 'Engineer',
      recruiterName: 'Jane',
      actionDueAt: null,
      interviewDetected: true,
      interviewDatetime: null,
      aiSummary: 'Recruiter wants to schedule an interview.',
    });
    mockMarkInboundEmailProcessed.mockResolvedValue({
      ...sampleList.items[0],
      processed: true,
    });
    mockClassifyInboundEmail.mockResolvedValue({
      classification: {
        classification: 'Interview Request',
        classificationConfidence: 90,
        companyName: 'Acme Corp',
        positionTitle: 'Engineer',
        recruiterName: 'Jane',
        requiresResponse: true,
        suggestedAction: 'Reply to schedule the interview',
        actionDueAt: null,
        interviewDetected: true,
        interviewDatetime: null,
        aiSummary: 'Recruiter wants to schedule an interview.',
        processedAt: '2026-07-01T10:00:00.000Z',
      },
      email: {
        ...sampleList.items[0],
        provider: 'postmark',
        textBody: 'Hello candidate',
        htmlBody: '<p>Hello candidate</p>',
        companyName: 'Acme Corp',
        positionTitle: 'Engineer',
        recruiterName: 'Jane',
        actionDueAt: null,
        interviewDetected: true,
        interviewDatetime: null,
        aiSummary: 'Recruiter wants to schedule an interview.',
      },
    });
    mockClassifyUnprocessedInboundEmails.mockResolvedValue({
      classified: 1,
      failed: 0,
      skipped: 0,
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
    expect(screen.getByText('Interview Request')).toBeTruthy();
    expect(screen.getByText(/Suggested action:/)).toBeTruthy();
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

  it('re-runs classification from the analyze button', async () => {
    render(
      <MemoryRouter>
        <InboundEmailsPage />
      </MemoryRouter>,
    );

    await screen.findByText('Interview invite');
    await userEvent.click(screen.getByRole('button', { name: /recruiter@acme.com/i }));
    await screen.findByRole('button', { name: /Re-analyze/i });

    await userEvent.click(screen.getByRole('button', { name: /Re-analyze/i }));

    await waitFor(() => {
      expect(mockClassifyInboundEmail).toHaveBeenCalledWith('email-1', { force: true });
    });
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
