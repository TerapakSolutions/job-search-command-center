import { useSupportEmail } from '../lib/useSupportEmail';

/** "email support@…" when a support address is set, else a general pointer to the owner. */
export default function ContactLine() {
  const supportEmail = useSupportEmail();
  if (!supportEmail) return <>contact the app owner</>;
  return (
    <>
      email{' '}
      <a href={`mailto:${supportEmail}`} className="text-blue-600 hover:underline">
        {supportEmail}
      </a>
    </>
  );
}
