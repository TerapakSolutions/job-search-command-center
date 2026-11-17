/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import FollowUpSettings from './FollowUpSettings';
import { DEMO_FOLLOW_UP_DAYS_KEY } from '../api/userSettingsClient';

// Demo mode: the section reads and writes localStorage only, never the network.
jest.mock('../api/persistence', () => ({
  isDemoMode: () => true,
  getPersistenceMode: () => 'demo',
  getApiBaseUrl: () => '/api',
}));

const mockApiRequest = jest.fn();
jest.mock('../api/http', () => ({
  ...jest.requireActual('../api/http'),
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

beforeEach(() => {
  mockApiRequest.mockReset();
  localStorage.clear();
});

function input(): HTMLInputElement {
  return screen.getByLabelText(/Follow up after a meeting/i) as HTMLInputElement;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement;
}

describe('FollowUpSettings (demo mode)', () => {
  it('shows the value stored in this browser, with Save enabled', async () => {
    localStorage.setItem(DEMO_FOLLOW_UP_DAYS_KEY, '8');
    render(<FollowUpSettings />);
    await screen.findByDisplayValue('8');
    expect(saveButton().disabled).toBe(false);
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it('with nothing stored, shows the default 3 and Save is enabled', async () => {
    render(<FollowUpSettings />);
    await screen.findByDisplayValue('3');
    expect(saveButton().disabled).toBe(false);
  });

  it('saving writes localStorage and never calls the API', async () => {
    render(<FollowUpSettings />);
    await screen.findByDisplayValue('3');
    fireEvent.change(input(), { target: { value: '5' } });
    fireEvent.click(saveButton());
    expect((await screen.findByRole('status')).textContent).toBe('Follow-up days saved locally.');
    expect(localStorage.getItem(DEMO_FOLLOW_UP_DAYS_KEY)).toBe('5');
    expect(mockApiRequest).not.toHaveBeenCalled();
  });
});
