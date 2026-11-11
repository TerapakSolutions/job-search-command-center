import { pipelineStatusLabel } from './emailPipelineAutomation.js';

// Booking links recruiters send with a screening or interview request.
const SCHEDULING_URL =
  /https?:\/\/(?:calendly\.com|[\w.-]*goodtime\.io|[\w.-]*greenhouse\.io|cal\.com|calendar\.app\.google|outlook\.office\.com\/(?:book|bookwithme))[^\s<>)"']*/i;

export function firstSchedulingUrl(text: string): string | null {
  return text.match(SCHEDULING_URL)?.[0] ?? null;
}

/**
 * The line added to an application's notes when an approved email moves it
 * to a new stage, e.g.
 * "[2026-11-11] Recruiter Screen requested by Alex Rivera (Example Grocer). Schedule: https://calendly.com/x"
 */
export function buildStageChangeNote(input: {
  date: string;
  status: string;
  senderName: string | null;
  company: string;
  text: string;
}): string {
  const who = input.senderName?.trim() ? `by ${input.senderName.trim()}` : 'via email';
  const url = firstSchedulingUrl(input.text);
  const schedule = url ? ` Schedule: ${url}` : '';
  return `[${input.date}] ${pipelineStatusLabel(input.status)} requested ${who} (${input.company}).${schedule}`;
}

const DATE_PREFIX = /^\[\d{4}-\d{2}-\d{2}\] /;

/** Append the note on its own line, unless the same note (any date) is already there. */
export function appendStageChangeNote(notes: string, line: string): string {
  const body = line.replace(DATE_PREFIX, '');
  const already = notes.split('\n').some((existing) => existing.replace(DATE_PREFIX, '') === body);
  if (already) return notes;
  return notes ? `${notes}\n${line}` : line;
}
