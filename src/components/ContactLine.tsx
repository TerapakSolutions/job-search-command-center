import { useSupportEmail } from '../lib/useSupportEmail';

/** "email support@…" when a support address is set, else the person who invited you. */
export default function ContactLine() {
  const supportEmail = useSupportEmail();
  if (!supportEmail) return <>contact the person who invited you</>;
  return (
    <>
      email{' '}
      <a href={`mailto:${supportEmail}`} className="text-blue-600 hover:underline">
        {supportEmail}
      </a>
    </>
  );
}
