import { fireEvent, render, screen } from '@testing-library/react';
import SettingsPage from './SettingsPage';

describe('SettingsPage', () => {
  it('renders the settings heading and data-management copy', () => {
    render(<SettingsPage />);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(
      screen.getByText(/Export, import, or reset your job search data/i),
    ).toBeTruthy();
  });

  it('shows the active persistence mode', () => {
    render(<SettingsPage />);
    // jest.setup.js forces VITE_PERSISTENCE_MODE=demo
    expect(screen.getByText(/Demo mode/i)).toBeTruthy();
  });

  describe('Follow up after a meeting (demo mode, localStorage)', () => {
    const KEY = 'follow-up-after-days';
    beforeEach(() => localStorage.removeItem(KEY));

    const input = () => screen.getByLabelText(/Follow up after a meeting/i) as HTMLInputElement;

    it('shows the default, 3 business days, when nothing is saved', async () => {
      render(<SettingsPage />);
      await screen.findByDisplayValue('3');
      expect(input().value).toBe('3');
    });

    it('shows the saved value', async () => {
      localStorage.setItem(KEY, '6');
      render(<SettingsPage />);
      await screen.findByDisplayValue('6');
    });

    it('saving updates the value and keeps it', async () => {
      render(<SettingsPage />);
      await screen.findByDisplayValue('3');
      fireEvent.change(input(), { target: { value: '7' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save follow-up days' }));
      await screen.findByText('Follow-up days saved locally.');
      expect(localStorage.getItem(KEY)).toBe('7');
    });
  });
});
