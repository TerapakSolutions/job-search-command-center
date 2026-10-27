import { Link } from 'react-router-dom';
import { FiHelpCircle } from 'react-icons/fi';

export const INBOUND_ADDRESS = 'jobinfo@jobs.terapak.com';

export default function QuickStartPanel() {
  return (
    <section className="bg-white border border-blue-200 rounded-lg p-5 space-y-3">
      <h3 className="flex items-center gap-2 text-lg font-medium text-gray-800">
        <FiHelpCircle className="text-blue-500" />
        Quick start
      </h3>
      <ol className="list-decimal pl-5 space-y-1.5 text-sm text-gray-700">
        <li>
          <strong>Get emails in.</strong> Forward any recruiter or ATS email to{' '}
          <code className="font-mono text-xs">{INBOUND_ADDRESS}</code>, or add an application
          by hand with <strong>New application</strong> on Applications.
        </li>
        <li>
          <strong>Set your goals.</strong> In <strong>Settings</strong>, set your daily, weekly,
          and monthly application targets so Today can track your pace.
        </li>
        <li>
          <strong>Check Today each morning.</strong> It shows your goal progress, what&apos;s due,
          and the AI brief of what came in.
        </li>
        <li>
          <strong>Review or fix.</strong> Clear confirmations become applications automatically;
          anything unclear waits under <strong>Pending approvals</strong>. Correct a company or
          role by clicking the application on Applications.
        </li>
        <li>
          <strong>Prepare.</strong> Today also lists upcoming interviews and recruiter follow-ups
          so you know what&apos;s next.
        </li>
      </ol>
      <p className="text-sm">
        <Link to="/help" className="text-blue-600 hover:underline">
          Full directions
        </Link>
      </p>
    </section>
  );
}
