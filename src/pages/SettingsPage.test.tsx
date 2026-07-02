import { render, screen } from '@testing-library/react';
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
});
