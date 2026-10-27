import { Link } from 'react-router-dom';
import ContactLine from '../components/ContactLine';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-lg font-medium text-gray-900">{title}</h3>
      <div className="text-sm text-gray-700 space-y-2">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-100 px-4 py-10">
      <div className="max-w-2xl mx-auto bg-white border rounded-lg p-8 space-y-6">
        <div>
          <h2 className="text-2xl font-semibold text-gray-900">Privacy</h2>
          <p className="mt-1 text-sm text-gray-600">
            Job Search Command Center is a small, invite-only beta run by one person. This page
            says plainly what happens to your information.
          </p>
        </div>

        <Section title="What is stored">
          <p>
            <strong>Your Google profile:</strong> your name, email address, and profile photo,
            used only to sign you in.
          </p>
          <p>
            <strong>Emails you forward:</strong> the full text of each email, plus what the app
            extracts from it (company, role, recruiter, dates, a short summary).
          </p>
          <p>
            <strong>What you enter:</strong> applications, contacts, notes, interviews, and goals.
          </p>
        </Section>

        <Section title="Where it is stored, and who can see it">
          <p>
            Everything is kept in one database on one server, hosted by Fly.io in San Jose,
            California. Other users of the app cannot see your data. The person who runs the app
            can access the server and database, and so can read what is stored there.
          </p>
        </Section>

        <Section title="AI processing">
          <p>
            To sort and summarize your email, the app sends the text of each forwarded email,
            and a summary of your job search for the daily brief, to OpenAI. OpenAI&apos;s own
            terms cover how it handles that data; see{' '}
            <a
              href="https://openai.com/policies/"
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 hover:underline"
            >
              openai.com/policies
            </a>
            .
          </p>
        </Section>

        <Section title="What the app does not do">
          <p>
            No ads and no analytics or tracking scripts. The only cookie is the one that keeps you
            signed in.
          </p>
        </Section>

        <Section title="Deleting your data">
          <p>
            <strong>Delete</strong> on an email hides it from the app, but does not erase it from
            the database. To have your emails or your whole account permanently removed,{' '}
            <ContactLine />.
          </p>
        </Section>

        <Section title="Good to know">
          <p>
            Forward emails from the same address you sign in with; that is how the app knows they
            are yours. Days and goals are counted on Pacific time.
          </p>
          <p>
            If you have questions, <ContactLine />.
          </p>
        </Section>

        <p className="text-sm">
          <Link to="/" className="text-blue-600 hover:underline">
            Back to the app
          </Link>
        </p>
      </div>
    </div>
  );
}
