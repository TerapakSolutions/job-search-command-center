import { Link } from 'react-router-dom';
import ContactLine from '../components/ContactLine';
import QuickStartPanel, { INBOUND_ADDRESS } from '../components/QuickStartPanel';

// One line per classification the email pipeline emits. HelpPage.test.tsx
// checks this against the server's EMAIL_CLASSIFICATIONS so it can't drift.
export const CLASSIFICATION_GLOSSARY: Record<string, string> = {
  'Application Confirmation':
    'An employer confirming it received your application. Creates an Applied application when the company and role are clear.',
  'Recruiter Outreach':
    'A recruiter contacting you about a role. Creates or updates an application at Recruiter screen when the company and role are clear.',
  'Interview Request': 'An invitation to interview. Moves the application to Interviewing, sometimes after your approval.',
  Scheduling: 'Booking or confirming an interview time. Moves the application to Interviewing, sometimes after your approval.',
  'Follow-up Required': 'Someone is waiting on a reply or an action from you.',
  Offer: 'A job offer. Always waits for your approval before changing anything.',
  Rejection: 'The employer is not moving forward. Marks the matching application Rejected.',
  'General Update': 'Job-related news that needs no action (for example, "your application is under review").',
  'Not Job Related':
    'Bills, newsletters, and other non-job mail. Hidden from Inbound Emails by default; use "Show hidden non-job emails" to see them.',
  Other: 'Possibly job-related, but the AI could not place it. Stays visible so you can Re-analyze it or add it by hand.',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border rounded-lg p-6 space-y-3">
      <h3 className="text-lg font-medium text-gray-900">{title}</h3>
      <div className="text-sm text-gray-700 space-y-2">{children}</div>
    </section>
  );
}

export default function HelpPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-semibold text-gray-900">Help</h2>
        <p className="mt-1 text-gray-600">How to get the most out of Job Search Command Center.</p>
        <p className="mt-2 text-sm text-gray-600">
          This is a free beta. See{' '}
          <Link to="/privacy" className="text-blue-600 hover:underline">
            Privacy
          </Link>{' '}
          for what is stored and who can see it.
        </p>
      </div>

      <QuickStartPanel />

      <Section title="1. Getting emails in">
        {/* screenshot: forwarding an email to the inbound address */}
        <p>
          Forward the email to <code className="font-mono text-xs">{INBOUND_ADDRESS}</code> from
          Outlook, Gmail, Apple Mail, or your phone, using the same address you sign in with:
          that is how the app knows the email is yours. Use plain Forward and don&apos;t edit the
          body; attachments are fine. In Apple Mail you can select several emails and forward
          them together, and each becomes its own entry. In other mail apps, forward one at a
          time.
        </p>
        <p>
          Forward outreach, application confirmations, interview invites, scheduling emails, and
          rejections. For a role with no email trail, add it with <strong>New application</strong>{' '}
          on Applications.
        </p>
      </Section>

      <Section title="2. Goals">
        {/* screenshot: Settings → Job search goals */}
        <p>
          <strong>Settings → Job search goals</strong> holds your daily, weekly, and monthly
          application targets. Today shows your progress against them, and the AI brief mentions
          when you&apos;re behind. Days run on Pacific time; weeks start Monday.
        </p>
      </Section>

      <Section title="3. Today">
        {/* screenshot: Today page */}
        <p>
          <strong>Due actions</strong> lists what needs doing now, such as interview prep and
          recruiter follow-ups. Use <strong>Dismiss</strong> to hide one for this visit.
        </p>
        <p>
          <strong>AI pipeline automation → Pending approvals</strong> holds changes the AI
          wasn&apos;t sure enough to make on its own. <strong>Approve</strong> applies the change;{' '}
          <strong>Reject</strong> drops it.
        </p>
        <p>
          To correct a company or role, click the application on <strong>Applications</strong>,
          edit it, and save.
        </p>
      </Section>

      <Section title="4. Preparing">
        {/* screenshot: Upcoming interviews on Today */}
        <p>
          <strong>Upcoming interviews</strong> lists applications at Interviewing or Final round
          with an interview in the next two weeks, or with no date set yet. The date comes from the invite or scheduling
          email. If it&apos;s wrong or missing, click the application on Applications and set{' '}
          <strong>Interview date</strong> and <strong>Pipeline status</strong>.
        </p>
      </Section>

      <Section title="Troubleshooting">
        <p>
          <strong>Nothing showed up.</strong> Wait 1–2 minutes and refresh. Check Spam for a
          bounce. Make sure you forwarded rather than replied, and that you forwarded from the
          address you sign in with. If it still isn&apos;t there, <ContactLine />.
        </p>
        <p>
          <strong>Wrong company or role.</strong> Click the application on Applications and fix
          it.
        </p>
        <p>
          <strong>Email classified as Other.</strong> Open it on Inbound Emails and click{' '}
          <strong>Re-analyze</strong>. If it&apos;s still Other, add the application with{' '}
          <strong>New application</strong>.
        </p>
      </Section>

      <Section title="Email classifications">
        <dl className="space-y-2">
          {Object.entries(CLASSIFICATION_GLOSSARY).map(([name, description]) => (
            <div key={name}>
              <dt className="font-medium text-gray-900">{name}</dt>
              <dd className="text-gray-600">{description}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </div>
  );
}
