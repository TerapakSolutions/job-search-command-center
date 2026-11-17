/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import FollowUpSettings from './FollowUpSettings';
import { ApiError } from '../api/http';

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

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement;
}

const LOAD_ERROR = "Couldn't load your follow-up setting. Reload to try again.";

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

  it('while the read is in flight, Save is disabled and no default is shown', async () => {
    let resolveRead: (v: unknown) => void = () => {};
    mockApiRequest.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    render(<FollowUpSettings />);
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByDisplayValue('3')).toBeNull();
    fireEvent.click(saveButton());
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRead({ followUpAfterDays: 4 });
    });
    await screen.findByDisplayValue('4');
    expect(saveButton().disabled).toBe(false);
  });

  // A failed read is not the default: never show 3 as if it were saved, never PUT it.
  describe.each([
    ['the request rejects', () => mockApiRequest.mockRejectedValueOnce(new Error('Could not reach the server.'))],
    [
      'the server answers 500',
      () =>
        mockApiRequest.mockRejectedValueOnce(
          new ApiError(500, '', 'The server had a problem handling that. Please try again.'),
        ),
    ],
    ['the body is malformed', () => mockApiRequest.mockResolvedValueOnce({ followUpAfterDays: 'x' })],
    ['the body has no value', () => mockApiRequest.mockResolvedValueOnce({})],
    ['the value is out of range', () => mockApiRequest.mockResolvedValueOnce({ followUpAfterDays: 15 })],
  ])('when %s', (_label, failRead) => {
    it('shows the error line, disables Save, shows no default, and sends no PUT', async () => {
      failRead();
      render(<FollowUpSettings />);
      expect((await screen.findByRole('alert')).textContent).toBe(LOAD_ERROR);
      expect(saveButton().disabled).toBe(true);
      expect(screen.queryByDisplayValue('3')).toBeNull();
      fireEvent.click(saveButton());
      expect(mockApiRequest).toHaveBeenCalledTimes(1);
      expect(mockApiRequest).not.toHaveBeenCalledWith('/user-settings', expect.anything());
    });

    it('Retry re-reads; on success it shows the stored value and enables Save', async () => {
      failRead();
      mockApiRequest
        .mockResolvedValueOnce({ followUpAfterDays: 6 })
        .mockResolvedValueOnce({ followUpAfterDays: 6 });
      render(<FollowUpSettings />);
      await screen.findByRole('alert');
      fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
      await screen.findByDisplayValue('6');
      expect(mockApiRequest).toHaveBeenNthCalledWith(2, '/user-settings');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(saveButton().disabled).toBe(false);
      fireEvent.click(saveButton());
      expect(await screen.findByRole('status')).not.toBeNull();
      expect(mockApiRequest).toHaveBeenLastCalledWith('/user-settings', {
        method: 'PUT',
        body: JSON.stringify({ followUpAfterDays: 6 }),
      });
    });
  });
});
