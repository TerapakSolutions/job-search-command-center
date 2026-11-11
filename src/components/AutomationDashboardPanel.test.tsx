/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AutomationDashboardPanel from './AutomationDashboardPanel';
import * as client from '../api/emailAutomationClient';

jest.mock('../api/emailAutomationClient');
jest.mock('../api/persistence', () => ({
  isDemoMode: () => false,
  getApiBaseUrl: () => '/api',
}));

describe('AutomationDashboardPanel pending approvals', () => {
  it('links each approval straight to its email', async () => {
    jest.mocked(client.fetchAutomationDashboard).mockResolvedValue({
      recentActions: [],
      attentionApplications: [],
      pendingApprovals: [
        {
          id: 'approval-1',
          inboundEmailId: 'email-42',
          approvalType: 'draft_reply',
          applicationId: null,
          proposedStatus: 'saved',
          currentStatus: null,
          confidence: 95,
          reason: 'requires_response',
          reasonCode: 'requires_response',
          reasonMessage: 'This email may require a reply before automation can continue.',
          suggestedAction: 'Confirm attendance for the meeting on November 13, 2026.',
          autoApprovalThreshold: 75,
          stopReason: '',
          candidateMatches: [],
          status: 'pending',
          createdAt: '2026-11-11T17:00:00.000Z',
          emailSubject: 'Fw: Confirmed: Initial Screening',
        },
      ],
    });

    render(
      <MemoryRouter>
        <AutomationDashboardPanel />
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: /open email/i });
    expect(link.getAttribute('href')).toBe('/inbound-emails?email=email-42');
  });
});
