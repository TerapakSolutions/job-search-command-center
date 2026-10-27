/** @jest-environment node */
import type Stripe from 'stripe';
import { createDonationCheckout } from './donations.js';

function fakeStripe(url: string | null = 'https://checkout.stripe.com/c/pay/test') {
  const create = jest.fn().mockResolvedValue({ url });
  return { client: { checkout: { sessions: { create } } } as unknown as Stripe, create };
}

const ENV = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  FRONTEND_URL: 'https://jobs.example.com/',
};

describe('createDonationCheckout', () => {
  it('rejects anything but 5, 10 or 25', async () => {
    const { client, create } = fakeStripe();
    for (const body of [null, [], {}, { amount: 7 }, { amount: '10' }]) {
      const res = await createDonationCheckout(body, { env: ENV, stripe: client });
      expect(res.statusCode).toBe(400);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('says donations are not set up when there is no Stripe key', async () => {
    const res = await createDonationCheckout({ amount: 10 }, { env: { FRONTEND_URL: ENV.FRONTEND_URL } });
    expect(res).toEqual({ statusCode: 503, body: { error: 'Donations are not set up yet.' } });
  });

  it('creates a one-time payment for the chosen amount and returns to this app', async () => {
    const { client, create } = fakeStripe();
    const res = await createDonationCheckout({ amount: 25 }, { env: ENV, stripe: client });

    expect(res).toEqual({ statusCode: 200, body: { url: 'https://checkout.stripe.com/c/pay/test' } });
    const params = create.mock.calls[0][0];
    expect(params.mode).toBe('payment');
    expect(params.line_items).toEqual([
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: 2500,
          product_data: { name: 'Job Search Command Center donation' },
        },
      },
    ]);
    expect(params.success_url).toBe('https://jobs.example.com/donation-success');
    expect(params.cancel_url).toBe('https://jobs.example.com/donation-cancel');
  });

  it('reports a provider failure without leaking its message', async () => {
    const create = jest.fn().mockRejectedValue(new Error('Invalid API Key provided: sk_live_…'));
    const client = { checkout: { sessions: { create } } } as unknown as Stripe;
    const spy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const res = await createDonationCheckout({ amount: 5 }, { env: ENV, stripe: client });
    spy.mockRestore();
    expect(res).toEqual({ statusCode: 502, body: { error: 'Could not start checkout. Please try again.' } });
  });
});

describe('POST /api/donate', () => {
  it('requires a signed-in user', async () => {
    const http = await import('node:http');
    const { createApp } = await import('../app.js');
    const { createTestDb } = await import('./testDb.js');
    process.env.SESSION_SECRET = 'test-session-secret-for-donate';
    const server = http.createServer(createApp(createTestDb()));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/donate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 5 }),
      });
      expect(res.status).toBe(401);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
