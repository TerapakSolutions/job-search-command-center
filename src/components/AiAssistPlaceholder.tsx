import { FiZap } from 'react-icons/fi';

/**
 * Placeholder for deferred AI features:
 * fit score, resume tailoring, cover letters, recruiter drafts, interview prep, STAR stories.
 */
export default function AiAssistPlaceholder() {
  return (
    <div className="rounded-xl border border-dashed border-purple-300 bg-purple-50 p-6">
      <div className="flex items-start gap-3">
        <FiZap className="text-purple-500 shrink-0 mt-0.5" size={20} />
        <div>
          <h3 className="font-semibold text-purple-900">AI assist (coming soon)</h3>
          <p className="mt-1 text-sm text-purple-800">
            Planned features: role fit scoring, resume tailoring, cover letter drafts,
            recruiter response suggestions, interview prep, and STAR story generation.
          </p>
          <p className="mt-2 text-xs text-purple-600">
            Hook point: integrate an LLM provider via environment config when ready.
          </p>
        </div>
      </div>
    </div>
  );
}
