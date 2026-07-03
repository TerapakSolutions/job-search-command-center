const ATS_PLATFORM_NAMES = new Set([
  'workday',
  'greenhouse',
  'lever',
  'ashby',
  'icims',
  'taleo',
  'jobvite',
  'smartrecruiters',
]);

const ATS_EMAIL_SUFFIXES = [
  'myworkday.com',
  'workday.com',
  'greenhouse.io',
  'us.greenhouse-mail.io',
  'lever.co',
  'ashbyhq.com',
  'icims.com',
  'taleo.net',
];

export function isAtsPlatformCompany(company: string | null | undefined): boolean {
  const trimmed = company?.trim();
  if (!trimmed) return false;
  return ATS_PLATFORM_NAMES.has(trimmed.toLowerCase());
}

export function isAtsSenderEmail(email: string | null | undefined): boolean {
  const domain = email?.split('@')[1]?.toLowerCase() ?? '';
  if (!domain) return false;
  return ATS_EMAIL_SUFFIXES.some(
    (suffix) => domain === suffix || domain.endsWith(`.${suffix}`),
  );
}

export function isInterviewConfirmationText(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /interview confirmation/.test(normalized) ||
    /confirmed for (?:your )?interview/.test(normalized) ||
    /your interview (?:has been |is )?confirmed/.test(normalized) ||
    /interview has been confirmed/.test(normalized) ||
    /interview is confirmed/.test(normalized)
  );
}

export function extractEmployerFromSubject(subject: string): string | null {
  const trimmed = subject.trim();
  if (!trimmed) return null;

  const pipeMatch = trimmed.match(
    /^(.+?)\s*[|]\s*Interview Confirmation(?:\s+for\s+(.+?))?$/i,
  );
  if (pipeMatch) {
    const company = pipeMatch[1]?.trim();
    if (company && !isAtsPlatformCompany(company)) {
      return company;
    }
  }

  const dashMatch = trimmed.match(
    /^(.+?)\s*[-–—]\s*Interview Confirmation(?:\s+for\s+(.+?))?$/i,
  );
  if (dashMatch) {
    const company = dashMatch[1]?.trim();
    if (company && !isAtsPlatformCompany(company)) {
      return company;
    }
  }

  const forCompanyMatch = trimmed.match(
    /Interview Confirmation(?:\s+for\s+|\s*:\s*)(.+?)(?:\s+(?:on|at|with)\s|$)/i,
  );
  if (forCompanyMatch) {
    const candidate = forCompanyMatch[1]?.trim();
    if (candidate && !isAtsPlatformCompany(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function extractRoleFromInterviewSubject(subject: string): string | null {
  const trimmed = subject.trim();
  if (!trimmed) return null;

  const pipeMatch = trimmed.match(
    /^.+?\s*[|]\s*Interview Confirmation(?:\s+for\s+(.+?))?$/i,
  );
  if (pipeMatch?.[1]?.trim()) {
    return pipeMatch[1].trim();
  }

  const dashMatch = trimmed.match(
    /^.+?\s*[-–—]\s*Interview Confirmation(?:\s+for\s+(.+?))?$/i,
  );
  if (dashMatch?.[1]?.trim()) {
    return dashMatch[1].trim();
  }

  const forRoleMatch = trimmed.match(
    /Interview Confirmation(?:\s+for\s+|\s*:\s*)(.+)$/i,
  );
  if (forRoleMatch?.[1]?.trim()) {
    return forRoleMatch[1].trim();
  }

  return null;
}

export function inferEmployerFromSenderEmail(email: string | null | undefined): string | null {
  if (!email || isAtsSenderEmail(email)) return null;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  if (
    !domain ||
    domain.includes('gmail') ||
    domain.includes('yahoo') ||
    domain.includes('hotmail') ||
    domain.includes('outlook')
  ) {
    return null;
  }

  const root = domain.split('.')[0];
  if (!root || root.length < 2) return null;
  const company = root.charAt(0).toUpperCase() + root.slice(1);
  return isAtsPlatformCompany(company) ? null : company;
}

export function resolveEmployerCompany(input: {
  companyName?: string | null;
  originalCompany?: string | null;
  subject?: string | null;
  senderEmail?: string | null;
}): string | null {
  const subject = input.subject?.trim() ?? '';
  const fromSubject = subject ? extractEmployerFromSubject(subject) : null;
  if (fromSubject) return fromSubject;

  for (const candidate of [input.companyName, input.originalCompany]) {
    const trimmed = candidate?.trim();
    if (trimmed && !isAtsPlatformCompany(trimmed)) {
      return trimmed;
    }
  }

  const fromEmail = inferEmployerFromSenderEmail(input.senderEmail);
  if (fromEmail) return fromEmail;

  return null;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Optional weekday prefix ("Tuesday "), month name, day, optional year, then a
// time within the same line. Handles both inline phrasing
// ("... confirmed for Tuesday July 7, 6:00pm EST ...") and labeled lines
// ("Date/Time: Jul 7, 2026 6:00pm-7:00pm (GMT-04:00) ..."). The `\d{4}` year is
// optional because inline phrasing often omits it; it is then inferred from any
// full year elsewhere in the email.
const DATE_TIME_RE =
  /(?:(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?[^\n]{0,40}?(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)/gi;

// Date without an accompanying time (year required to avoid spurious matches).
const DATE_ONLY_RE =
  /(?:(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*,?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/i;

function parseTimeToken(token: string): { hour: number; minute: number } | null {
  const m = token.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i);
  if (!m) return null;
  let hour = Number.parseInt(m[1], 10);
  const minute = m[2] ? Number.parseInt(m[2], 10) : 0;
  if (m[3].toLowerCase() === 'p' && hour < 12) hour += 12;
  if (m[3].toLowerCase() === 'a' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

// Build an ISO instant from calendar components, treating the extracted
// wall-clock time as UTC. This keeps the interview's calendar DATE stable
// regardless of the server timezone (the primary product need). It does not
// resolve the source timezone (EST/EDT/…); the email's own .ics attachment
// carries an authoritative TZID and would be the precise source — see the
// deferred follow-up.
function buildUtcIso(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
): string | null {
  if (day < 1 || day > 31) return null;
  const iso = `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function extractInterviewDatetime(text: string): string | null {
  const yearMatch = text.match(/\b(20\d{2})\b/);
  const fallbackYear = yearMatch ? Number.parseInt(yearMatch[1], 10) : null;

  DATE_TIME_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DATE_TIME_RE.exec(text)) !== null) {
    const monthIndex = MONTH_INDEX[match[1].slice(0, 3).toLowerCase()];
    const day = Number.parseInt(match[2], 10);
    const year = match[3] ? Number.parseInt(match[3], 10) : fallbackYear;
    const time = parseTimeToken(match[4]);
    if (monthIndex === undefined || !year || !time) continue;
    const iso = buildUtcIso(year, monthIndex, day, time.hour, time.minute);
    if (iso) return iso;
  }

  const dateOnly = DATE_ONLY_RE.exec(text);
  if (dateOnly) {
    const monthIndex = MONTH_INDEX[dateOnly[1].slice(0, 3).toLowerCase()];
    const day = Number.parseInt(dateOnly[2], 10);
    const year = Number.parseInt(dateOnly[3], 10);
    if (monthIndex !== undefined) {
      const iso = buildUtcIso(year, monthIndex, day, 0, 0);
      if (iso) return iso;
    }
  }

  return null;
}

export function resolveRoleTitle(input: {
  positionTitle?: string | null;
  subject?: string | null;
}): string | null {
  const fromField = input.positionTitle?.trim();
  if (fromField && fromField.toLowerCase() !== 'unknown role') {
    return fromField;
  }

  const subject = input.subject?.trim() ?? '';
  if (!subject) return fromField ?? null;

  return extractRoleFromInterviewSubject(subject) ?? fromField ?? null;
}
