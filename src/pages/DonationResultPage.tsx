import { Link } from 'react-router-dom';
import { FiCheckCircle } from 'react-icons/fi';

// Stripe sends people back here; it renders without a session so a donor
// whose session lapsed during checkout still sees the result.
export default function DonationResultPage({ outcome }: { outcome: 'success' | 'cancel' }) {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="max-w-md bg-white border rounded-lg p-8 text-center space-y-4">
        {outcome === 'success' ? (
          <>
            <FiCheckCircle className="mx-auto text-green-600" size={44} aria-hidden="true" />
            <h2 className="text-2xl font-semibold text-gray-900">Thank you for your support!</h2>
            <p className="text-gray-600">
              Your donation helps keep Job Search Command Center running.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold text-gray-900">Donation canceled</h2>
            <p className="text-gray-600">
              No problem. Nothing was charged, and the app stays free to use.
            </p>
          </>
        )}
        <Link
          to="/today"
          className="inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Back to the app
        </Link>
      </div>
    </div>
  );
}
