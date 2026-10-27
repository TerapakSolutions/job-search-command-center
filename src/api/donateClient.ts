export type DonationAmount = 5 | 10 | 25;

export async function startDonation(amount: DonationAmount): Promise<string> {
  const res = await fetch('/api/donate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount }),
  });
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !data.url) {
    throw new Error(data.error ?? 'Could not start checkout. Please try again.');
  }
  return data.url;
}
