/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthGate } from '../App';
import LoginPage from './LoginPage';

jest.mock('../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      user: null,
      loading: false,
      checked: true,
      checkAuth: jest.fn(),
      sessionExpired: false,
    }),
}));

jest.mock('../api/persistence', () => ({
  ...jest.requireActual('../api/persistence'),
  isDemoMode: () => false,
}));

function mockSupportEmail(supportEmail: string | null) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ supportEmail }),
  }) as unknown as typeof fetch;
}

describe('Privacy page', () => {
  it('can be read by someone who is not signed in', async () => {
    mockSupportEmail('help@example.com');
    render(
      <MemoryRouter initialEntries={['/privacy']}>
        <AuthGate>
          <div>signed-in app</div>
        </AuthGate>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeTruthy();
    expect(screen.queryByText('signed-in app')).toBeNull();
    expect((await screen.findAllByRole('link', { name: 'help@example.com' })).length).toBeGreaterThan(0);
  });

  it('points to the app owner when no support address is set', async () => {
    mockSupportEmail(null);
    render(
      <MemoryRouter initialEntries={['/privacy']}>
        <AuthGate>
          <div />
        </AuthGate>
      </MemoryRouter>,
    );
    expect((await screen.findAllByText(/contact the app owner/)).length).toBeGreaterThan(0);
  });

  it('is linked from the login page', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe('/privacy');
  });

  it('shows the support address in the login page footer', async () => {
    mockSupportEmail('help@terapak.com');
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: 'help@terapak.com' });
    expect(link.getAttribute('href')).toBe('mailto:help@terapak.com');
  });
});
