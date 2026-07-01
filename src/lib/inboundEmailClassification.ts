const CLASSIFICATION_STYLES: Record<string, string> = {
  'Interview Request': 'bg-purple-100 text-purple-800 border-purple-200',
  'Application Confirmation': 'bg-blue-100 text-blue-800 border-blue-200',
  Rejection: 'bg-gray-100 text-gray-700 border-gray-200',
  'Recruiter Outreach': 'bg-indigo-100 text-indigo-800 border-indigo-200',
  'Follow-up Required': 'bg-amber-100 text-amber-800 border-amber-200',
  Offer: 'bg-green-100 text-green-800 border-green-200',
  Scheduling: 'bg-purple-50 text-purple-700 border-purple-200',
  'General Update': 'bg-slate-100 text-slate-700 border-slate-200',
  Other: 'bg-slate-100 text-slate-600 border-slate-200',
};

export function classificationBadgeClass(classification: string | null): string {
  if (!classification) {
    return 'bg-gray-50 text-gray-500 border-gray-200';
  }
  return CLASSIFICATION_STYLES[classification] ?? CLASSIFICATION_STYLES.Other;
}

export function classificationPriorityLabel(
  classification: string | null,
  requiresResponse: boolean | null,
): string | null {
  if (!classification) return null;
  if (classification === 'Interview Request' || classification === 'Offer') {
    return 'High priority';
  }
  if (requiresResponse) return 'Action needed';
  if (classification === 'Rejection' || classification === 'Application Confirmation') {
    return 'Low priority';
  }
  return null;
}
