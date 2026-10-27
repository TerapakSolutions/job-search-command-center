// The app is invite-only while it's shared with a small group. ALLOWED_EMAILS
// is a comma- or space-separated list kept as a Fly secret (the repo is
// public). Production with no list lets nobody in, so a missing secret can't
// silently open sign-up.
export function isEmailInvited(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.ALLOWED_EMAILS?.trim();
  if (!raw) return env.NODE_ENV !== 'production';
  const invited = raw.toLowerCase().split(/[\s,]+/).filter(Boolean);
  return invited.includes(email.trim().toLowerCase());
}
