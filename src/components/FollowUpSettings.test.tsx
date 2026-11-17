/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import FollowUpSettings from './FollowUpSettings';

// API mode: the section reads and writes through /api/user-settings.
jest.mock('../api/persistence', () => ({
  isDemoMode: () => false,
  getPersistenceMode: () => 'api',
  getApiBaseUrl: () => '/api',
}));

const mockApiRequest = jest.fn();
jest.mock('../api/http', () => ({
  ...jest.requireActual('../api/http'),
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

beforeEach(() => mockApiRequest.mockReset());

function input(): HTMLInputElement {
  return screen.getByLabelText(/Follow up after a meeting/i) as HTMLInputElement;
}

describe('FollowUpSettings (API mode)', () => {
  it("shows the user's current value from the server", async () => {
    mockApiRequest.mockResolvedValueOnce({ followUpAfterDays: 5 });
    render(<FollowUpSettings />);
    await screen.findByDisplayValue('5');
    expect(mockApiRequest).toHaveBeenCalledWith('/user-settings');
    expect(screen.getByText(/Monday to Friday/)).not.toBeNull();
  });

  it('saving sends the new value and shows what the server stored', async () => {
    mockApiRequest
      .mockResolvedValueOnce({ followUpAfterDays: 3 })
      .mockResolvedValueOnce({ followUpAfterDays: 7 });
    render(<FollowUpSettings />);
    await screen.findByDisplayValue('3');
    fireEvent.change(input(), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(await screen.findByRole('status')).not.toBeNull();
    expect(mockApiRequest).toHaveBeenLastCalledWith('/user-settings', {
      method: 'PUT',
      body: JSON.stringify({ followUpAfterDays: 7 }),
    });
    expect(input().value).toBe('7');
  });

  it('does not send an out-of-range value', async () => {
    mockApiRequest.mockResolvedValueOnce({ followUpAfterDays: 3 });
    render(<FollowUpSettings />);
    await screen.findByDisplayValue('3');
    fireEvent.change(input(), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    expect(await screen.findByRole('alert')).not.toBeNull();
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
  });

  it('shows the default 3 when the read fails', async () => {
    mockApiRequest.mockRejectedValueOnce(new Error('Could not reach the server.'));
    render(<FollowUpSettings />);
    await screen.findByDisplayValue('3');
  });
});
