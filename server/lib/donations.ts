import Stripe from 'stripe';

// One-time donations through Stripe Checkout, the same flow CampScout uses.
// The price is set inline, so the only setup is STRIPE_SECRET_KEY: no Stripe
// products or price IDs to create.
export const DONATION_AMOUNTS = [5, 10, 25] as const;
export type DonationAmount = (typeof DONATION_AMOUNTS)[number];

export interface DonateResponse {
  statusCode: number;
  body: { url: string } | { error: string };
}

function isDonationAmount(value: unknown): value is DonationAmount {
  return typeof value === 'number' && DONATION_AMOUNTS.includes(value as DonationAmount);
}

export async function createDonationCheckout(
  body: unknown,
  options: { env?: NodeJS.ProcessEnv; stripe?: Stripe } = {},
): Promise<DonateResponse> {
  const env = options.env ?? process.env;
  const amount =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).amount
      : undefined;
  if (!isDonationAmount(amount)) {
    return { statusCode: 400, body: { error: 'Choose a donation of $5, $10, or $25.' } };
  }

  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    return { statusCode: 503, body: { error: 'Donations are not set up yet.' } };
  }

  // Return URLs come from config only, never the request, so checkout can't
  // be pointed at another site.
  const baseUrl = (env.FRONTEND_URL ?? 'http://localhost:5173').trim().replace(/\/$/, '');
  const stripe = options.stripe ?? new Stripe(secretKey);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amount * 100,
            product_data: { name: 'Job Search Command Center donation' },
          },
        },
      ],
      success_url: `${baseUrl}/donation-success`,
      cancel_url: `${baseUrl}/donation-cancel`,
    });
    if (!session.url) {
      return { statusCode: 502, body: { error: 'Could not start checkout. Please try again.' } };
    }
    return { statusCode: 200, body: { url: session.url } };
  } catch (error) {
    process.stderr.write(
      `[donate] Stripe checkout failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return { statusCode: 502, body: { error: 'Could not start checkout. Please try again.' } };
  }
}
