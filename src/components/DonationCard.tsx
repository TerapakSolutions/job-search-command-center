import { useState } from 'react';
import { FiHeart } from 'react-icons/fi';
import { startDonation, type DonationAmount } from '../api/donateClient';

const AMOUNTS: DonationAmount[] = [5, 10, 25];

export default function DonationCard({
  redirect = (url: string) => window.location.assign(url),
}: {
  redirect?: (url: string) => void;
}) {
  const [loading, setLoading] = useState<DonationAmount | null>(null);
  const [error, setError] = useState('');

  const donate = async (amount: DonationAmount) => {
    setError('');
    setLoading(amount);
    try {
      redirect(await startDonation(amount));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout. Please try again.');
      setLoading(null);
    }
  };

  return (
    <section
      aria-labelledby="donation-heading"
      className="rounded-lg border border-green-200 bg-green-50 p-5"
    >
      <div className="flex items-start gap-3">
        <FiHeart className="mt-1 shrink-0 text-green-600" size={20} aria-hidden="true" />
        <div className="flex-1 space-y-3">
          <div>
            <h3 id="donation-heading" className="text-lg font-medium text-gray-900">
              Support Job Search Command Center
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              The app is free. If it helps your search, a small donation covers hosting and the AI
              that reads your email.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {AMOUNTS.map((amount) => (
              <button
                key={amount}
                type="button"
                disabled={loading !== null}
                onClick={() => void donate(amount)}
                className="min-w-[4.5rem] rounded-lg border border-green-600 bg-white px-4 py-2 text-sm font-semibold text-green-700 hover:bg-green-600 hover:text-white disabled:opacity-60"
              >
                {loading === amount ? 'Redirecting…' : `$${amount}`}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
