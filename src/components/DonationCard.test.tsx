/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DonationCard from './DonationCard';
import { AuthGate } from '../App';

jest.mock('../store/useAuthStore', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ user: null, loading: false, checked: true, checkAuth: jest.fn(), sessionExpired: false }),
}));
jest.mock('../api/persistence', () => ({
  ...jest.requireActual('../api/persistence'),
  isDemoMode: () => false,
}));

function mockDonateResponse(status: number, body: unknown) {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('DonationCard', () => {
  let assign: jest.Mock;
  beforeEach(() => {
    assign = jest.fn();
  });

  it('sends the chosen amount and goes to Stripe Checkout', async () => {
    const fetchMock = mockDonateResponse(200, { url: 'https://checkout.stripe.com/c/pay/x' });
    render(<DonationCard redirect={assign} />);
    fireEvent.click(screen.getByRole('button', { name: '$10' }));
    await screen.findByRole('button', { name: 'Redirecting…' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ amount: 10 });
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/x');
  });

  it('shows the server error and stays on the page', async () => {
    mockDonateResponse(503, { error: 'Donations are not set up yet.' });
    render(<DonationCard redirect={assign} />);
    fireEvent.click(screen.getByRole('button', { name: '$5' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Donations are not set up yet.');
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('donation result pages', () => {
  it.each([
    ['/donation-success', 'Thank you for your support!'],
    ['/donation-cancel', 'Donation canceled'],
  ])('%s renders for someone who is not signed in', (path, heading) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <AuthGate>
          <div>signed-in app</div>
        </AuthGate>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.queryByText('signed-in app')).toBeNull();
  });

  it('gives donors the support address on the result pages', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ supportEmail: 'help@terapak.com' }),
    }) as unknown as typeof fetch;
    render(
      <MemoryRouter initialEntries={['/donation-success']}>
        <AuthGate>
          <div />
        </AuthGate>
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: 'help@terapak.com' });
    expect(link.getAttribute('href')).toBe('mailto:help@terapak.com');
  });
});
