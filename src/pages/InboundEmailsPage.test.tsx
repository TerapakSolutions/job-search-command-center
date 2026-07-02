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
    nextActions: [],
    pipelineProposal: null,
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
const mockReanalyzeInboundEmail = jest.mocked(inboundEmailsClient.reanalyzeInboundEmail);
const mockRetryInboundEmailProcessing = jest.mocked(
  inboundEmailsClient.retryInboundEmailProcessing,
);
const mockFetchInboundEmailAuditLog = jest.mocked(
  inboundEmailsClient.fetchInboundEmailAuditLog,
);
const mockDeleteInboundEmail = jest.mocked(inboundEmailsClient.deleteInboundEmail);

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
      processingStatus: 'processed' as const,
      processingError: null,
      lastProcessedAt: '2026-07-01T10:00:00.000Z',
      needsApproval: false,
    },
  ],
  total: 1,
  limit: 100,
  offset: 0,
};

const detailExtensions = {
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
  processingStartedAt: '2026-07-01T10:00:00.000Z',
  processingCompletedAt: '2026-07-01T10:00:00.000Z',
  processingAttempts: 1,
  forwarded: {
    isForwarded: false,
    forwardedByEmail: 'recruiter@acme.com',
    originalSenderEmail: null,
    originalSenderName: null,
    originalSubject: null,
    originalRecipient: null,
    originalSentAt: null,
    originalCompany: null,
  },
  processingTimeline: null,
  pendingApprovals: [],
};

describe('InboundEmailsPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchInboundEmails.mockResolvedValue(sampleList);
    mockFetchInboundEmailById.mockResolvedValue({
      ...sampleList.items[0],
      ...detailExtensions,
    });
    mockMarkInboundEmailProcessed.mockResolvedValue({
      ...sampleList.items[0],
      processed: true,
    });
    mockReanalyzeInboundEmail.mockResolvedValue({
      result: {
        emailId: 'email-1',
        processingStatus: 'processed',
        processingError: null,
        classificationRan: true,
        automationActions: 1,
        pendingApprovals: 0,
      },
      email: {
        ...sampleList.items[0],
        ...detailExtensions,
        processingAttempts: 2,
      },
    });
    mockRetryInboundEmailProcessing.mockResolvedValue({
      result: {
        emailId: 'email-1',
        processingStatus: 'processed',
        processingError: null,
        classificationRan: true,
        automationActions: 0,
        pendingApprovals: 0,
      },
      email: {
        ...sampleList.items[0],
        ...detailExtensions,
        processingStatus: 'processed',
        processingError: null,
        htmlBody: null,
        processingAttempts: 2,
      },
    });
    mockFetchInboundEmailAuditLog.mockResolvedValue({
      items: [
        {
          id: 'audit-1',
          inboundEmailId: 'email-1',
          actionType: 'auto_process',
          confidence: null,
          status: 'completed',
          details: {},
          resultingChanges: {},
          createdAt: '2026-07-01T10:00:00.000Z',
        },
      ],
    });
    mockDeleteInboundEmail.mockResolvedValue(undefined);
  });

  it('renders list and detail after selecting an email', async () => {
    render(
      <MemoryRouter>
        <InboundEmailsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Interview invite')).toBeTruthy();
    expect(screen.getByText('Processed')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /recruiter@acme.com/i }));

    await waitFor(() => {
      expect(mockFetchInboundEmailById).toHaveBeenCalledWith('email-1');
    });
    expect(await screen.findByText('Hello candidate')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Analyze$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /Re-analyze/i })).toBeTruthy();
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

  it('re-runs processing from the re-analyze button', async () => {
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
      expect(mockReanalyzeInboundEmail).toHaveBeenCalledWith('email-1');
    });
  });

  it('shows retry and error for failed processing', async () => {
    const failedItem = {
      ...sampleList.items[0],
      processingStatus: 'failed' as const,
      processingError: 'Classification failed',
    };
    mockFetchInboundEmails.mockResolvedValue({
      ...sampleList,
      items: [failedItem],
    });
    mockFetchInboundEmailById.mockResolvedValue({
      ...failedItem,
      ...detailExtensions,
      htmlBody: null,
    });

    render(
      <MemoryRouter>
        <InboundEmailsPage />
      </MemoryRouter>,
    );

    await screen.findByText('Interview invite');
    await userEvent.click(screen.getByRole('button', { name: /recruiter@acme.com/i }));

    expect(await screen.findByText(/Processing error:/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry failed processing/i })).toBeTruthy();
  });

  it('loads audit log from secondary action', async () => {
    render(
      <MemoryRouter>
        <InboundEmailsPage />
      </MemoryRouter>,
    );

    await screen.findByText('Interview invite');
    await userEvent.click(screen.getByRole('button', { name: /recruiter@acme.com/i }));
    await userEvent.click(screen.getByRole('button', { name: /View audit log/i }));

    await waitFor(() => {
      expect(mockFetchInboundEmailAuditLog).toHaveBeenCalledWith('email-1');
    });
    expect(await screen.findByText('auto_process')).toBeTruthy();
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

  it('deletes email after confirmation', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <MemoryRouter>
        <InboundEmailsPage />
      </MemoryRouter>,
    );

    await screen.findByText('Interview invite');
    await userEvent.click(screen.getByRole('button', { name: /recruiter@acme.com/i }));
    await userEvent.click(screen.getByRole('button', { name: /^Delete$/i }));

    await waitFor(() => {
      expect(mockDeleteInboundEmail).toHaveBeenCalledWith('email-1');
    });
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('Delete this email only'),
    );

    confirmSpy.mockRestore();
  });
});
