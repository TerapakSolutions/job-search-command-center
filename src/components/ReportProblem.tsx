import { useEffect, useState } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import { fetchPublicConfig } from '../api/authClient';
import { submitFeedback } from '../api/feedbackClient';
import Modal from './Modal';

const MESSAGE_MAX = 4000;

type Status = 'editing' | 'sending' | 'sent' | 'error';

/**
 * Header control for signed-in pages. Renders nothing until the server's public
 * config says the feature is on (FEEDBACK_ENABLED), so it ships dark.
 */
export default function ReportProblem() {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('editing');

  useEffect(() => {
    let active = true;
    void fetchPublicConfig().then((config) => {
      if (active) setEnabled(config.feedbackEnabled);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!enabled) return null;

  const close = () => {
    setOpen(false);
    setMessage('');
    setStatus('editing');
  };

  const send = async () => {
    setStatus('sending');
    try {
      await submitFeedback(message.trim(), window.location.href);
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  };

  const canSend = message.trim().length > 0 && status !== 'sending';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report a problem"
        title="Report a problem"
        className="text-gray-500 hover:text-blue-600"
      >
        <FiAlertTriangle size={22} />
      </button>
      <Modal title="Report a problem" isOpen={open} onClose={close}>
        {status === 'sent' ? (
          <div className="space-y-4">
            <p className="text-gray-800">Thanks — we got it</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={close}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSend) void send();
            }}
          >
            <label className="block text-sm font-medium text-gray-700" htmlFor="report-problem-message">
              What went wrong?
            </label>
            <textarea
              id="report-problem-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={MESSAGE_MAX}
              rows={5}
              className="w-full rounded-lg border border-gray-300 p-2 text-sm"
            />
            <p className="text-xs text-gray-500">The page you are on is attached automatically.</p>
            {status === 'error' && (
              <p role="alert" className="text-sm text-red-600">
                We couldn’t send your report. Please try again.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-lg px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSend}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {status === 'sending' ? 'Sending…' : status === 'error' ? 'Try again' : 'Send'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
