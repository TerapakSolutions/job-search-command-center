import { useEffect, useMemo } from 'react';
import { FiX } from 'react-icons/fi';
import type { Milestone } from '../lib/milestones';

const CONFETTI_COLORS = [
  '#a855f7',
  '#6366f1',
  '#22c55e',
  '#f59e0b',
  '#ec4899',
  '#38bdf8',
];
const CONFETTI_COUNT = 80;
const AUTO_DISMISS_MS = 6000;

interface MilestoneCelebrationProps {
  milestone: Milestone;
  onDismiss: () => void;
}

/**
 * Brief, dismissible celebration overlay: dependency-free CSS confetti plus a
 * congratulatory banner naming the company/role and milestone. Auto-dismisses;
 * respects prefers-reduced-motion (confetti hidden via CSS, banner still shown).
 */
export default function MilestoneCelebration({
  milestone,
  onDismiss,
}: MilestoneCelebrationProps) {
  // Randomize confetti once per milestone (keyed by applicationId+status).
  const pieces = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 2.6 + Math.random() * 1.8,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rounded: i % 2 === 0,
      })),
    [milestone.applicationId, milestone.status],
  );

  useEffect(() => {
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [onDismiss]);

  const role = milestone.roleTitle?.trim();

  return (
    <div
      className="fixed inset-0 z-50 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {pieces.map((p) => (
        <span
          key={p.id}
          className="milestone-confetti-piece"
          style={{
            left: `${p.left}vw`,
            backgroundColor: p.color,
            borderRadius: p.rounded ? '9999px' : '2px',
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}

      <div className="flex justify-center pt-6 px-4">
        <div className="milestone-banner pointer-events-auto max-w-md w-full bg-white border border-purple-200 shadow-lg rounded-xl px-5 py-4 flex items-start gap-3">
          <span className="text-2xl leading-none" aria-hidden="true">
            🎉
          </span>
          <div className="flex-1">
            <p className="font-semibold text-purple-900">{milestone.label}!</p>
            <p className="text-sm text-gray-700">
              {milestone.company}
              {role ? ` — ${role}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss celebration"
            className="text-gray-400 hover:text-gray-600"
          >
            <FiX size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
