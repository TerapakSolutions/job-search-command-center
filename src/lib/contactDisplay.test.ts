/** @jest-environment node */
import {
  contactApplicationLabel,
  isLikelyDomainCompany,
  isMeaningfulContactNextAction,
  resolveContactCompany,
} from '../../src/lib/contactDisplay.js';

describe('contactDisplay', () => {
  it('filters no-action contact next actions', () => {
    expect(isMeaningfulContactNextAction('No action needed — application received')).toBe(
      false,
    );
    expect(
      isMeaningfulContactNextAction('Wait response, but gut says something changed'),
    ).toBe(false);
    expect(isMeaningfulContactNextAction('Send follow-up Thursday')).toBe(true);
  });

  it('shows recruiter-only label without linked application', () => {
    expect(
      contactApplicationLabel({
        applicationId: null,
        company: 'NewCo',
        source: 'linkedin',
      }),
    ).toBe('NewCo — LinkedIn contact');
  });

  it('avoids Unknown role in labels', () => {
    expect(
      contactApplicationLabel({
        applicationId: 'app-1',
        company: 'Acme',
        roleTitle: 'Unknown role',
      }),
    ).toBe('Acme — Role not identified');
  });

  it('prefers linked application company over domain-only contact company', () => {
    expect(
      resolveContactCompany({
        contactCompany: 'terapak.com',
        applicationCompany: 'PwC',
      }),
    ).toBe('PwC');
    expect(
      contactApplicationLabel({
        applicationId: 'app-1',
        company: 'PwC',
        roleTitle: 'Unknown role',
      }),
    ).toBe('PwC — Role not identified');
  });

  it('keeps application-not-identified label when company is unknown', () => {
    expect(
      contactApplicationLabel({
        applicationId: 'app-1',
        company: 'terapak.com',
        roleTitle: 'Unknown role',
      }),
    ).toBe('Application not identified yet');
  });

  it('hides domain-only company labels for unlinked contacts', () => {
    expect(isLikelyDomainCompany('terapak.com')).toBe(true);
    expect(
      contactApplicationLabel({
        applicationId: null,
        company: 'terapak.com',
        source: 'email',
      }),
    ).toBe('Recruiter contact only');
  });
});
