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

export function extractInterviewDatetime(text: string): string | null {
  const match = text.match(
    /(?:is confirmed for|confirmed for|scheduled for|interview on|on)\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})(?:\s+at\s+([\d:]+\s*(?:AM|PM)?(?:\s+[A-Z]{2,4})?)?)?/i,
  );
  if (!match?.[1]) return null;

  const datePart = match[1].replace(/,/g, '');
  const parsedDate = new Date(datePart);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const timePart = match[2]?.trim() ?? '';
  if (!timePart) return parsedDate.toISOString();

  const parsedWithTime = new Date(`${datePart} ${timePart.replace(/\s+[A-Z]{2,4}$/i, '')}`);
  return Number.isNaN(parsedWithTime.getTime())
    ? parsedDate.toISOString()
    : parsedWithTime.toISOString();
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
