/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppShell from './AppShell';
import { isDemoMode } from '../api/persistence';

const mockUser = { id: 'user-jane', email: 'jane@example.com', name: 'Jane Doe', avatarUrl: null };

jest.mock('../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ user: mockUser, logout: jest.fn() }),
}));
jest.mock('../api/persistence', () => ({
  ...jest.requireActual('../api/persistence'),
  isDemoMode: jest.fn(() => false),
}));

type Handler = (url: string, init?: RequestInit) => { status: number; body: unknown };

function mockFetch(feedbackEnabled: boolean, onFeedback: Handler = () => ({ status: 201, body: { id: 'f1' } })) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const { status, body } = url.endsWith('/auth/config')
      ? { status: 200, body: { supportEmail: null, feedbackEnabled } }
      : onFeedback(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/applications']}>
      <AppShell>
        <div>page</div>
      </AppShell>
    </MemoryRouter>,
  );
}

function feedbackCalls(fetchMock: jest.Mock) {
  return fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/feedback'));
}

describe('Report a problem', () => {
  beforeEach(() => {
    (isDemoMode as jest.Mock).mockReturnValue(false);
  });

  it('is hidden when the server says the feature is off', async () => {
    const fetchMock = mockFetch(false);
    renderShell();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/auth/config'));
    // Let the config promise settle before asserting absence.
    await screen.findByText('page');
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('button', { name: 'Report a problem' })).toBeNull();
  });

  it('is hidden in demo mode and never asks the server', async () => {
    (isDemoMode as jest.Mock).mockReturnValue(true);
    const fetchMock = mockFetch(true);
    renderShell();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('button', { name: 'Report a problem' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the message with the page URL and shows the success state', async () => {
    const fetchMock = mockFetch(true);
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Report a problem' }));

    const send = screen.getByRole('button', { name: 'Send' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('What went wrong?'), { target: { value: 'The list is empty' } });
    fireEvent.click(send);

    expect(await screen.findByText('Thanks — we got it')).toBeTruthy();
    const calls = feedbackCalls(fetchMock);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({
      message: 'The list is empty',
      pageUrl: window.location.href,
    });
  });

  it('shows an error, keeps the text, and retries', async () => {
    let attempt = 0;
    const fetchMock = mockFetch(true, () => {
      attempt += 1;
      return attempt === 1 ? { status: 500, body: { error: 'boom' } } : { status: 201, body: { id: 'f1' } };
    });
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Report a problem' }));
    fireEvent.change(screen.getByLabelText('What went wrong?'), { target: { value: 'Broken again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/couldn.t send/i);
    expect((screen.getByLabelText('What went wrong?') as HTMLTextAreaElement).value).toBe('Broken again');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Thanks — we got it')).toBeTruthy();
    const calls = feedbackCalls(fetchMock);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1][1]?.body)).message).toBe('Broken again');
  });

  it('Cancel closes the form without sending', async () => {
    const fetchMock = mockFetch(true);
    renderShell();
    fireEvent.click(await screen.findByRole('button', { name: 'Report a problem' }));
    fireEvent.change(screen.getByLabelText('What went wrong?'), { target: { value: 'never mind' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('What went wrong?')).toBeNull();
    expect(feedbackCalls(fetchMock)).toHaveLength(0);
  });
});
