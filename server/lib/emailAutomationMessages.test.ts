/** @jest-environment node */
import {
  hasIdentifiedCompanyAndRole,
  isLikelyDomainCompany,
  isMeaningfulContactNextAction,
  isUnknownRole,
} from './emailAutomationMessages.js';

describe('emailAutomationMessages helpers', () => {
  it('detects unknown roles and domain-only companies', () => {
    expect(isUnknownRole('Unknown role')).toBe(true);
    expect(isUnknownRole('Engineer')).toBe(false);
    expect(isLikelyDomainCompany('terapak.com')).toBe(true);
    expect(isLikelyDomainCompany('PwC')).toBe(false);
  });

  it('requires identified company and role for auto application creation', () => {
    expect(
      hasIdentifiedCompanyAndRole({
        companyName: 'PwC',
        positionTitle: 'Engineer',
      }),
    ).toBe(true);
    expect(
      hasIdentifiedCompanyAndRole({
        companyName: 'terapak.com',
        positionTitle: 'Unknown role',
      }),
    ).toBe(false);
  });

  it('filters passive confirmation contact next actions', () => {
    expect(isMeaningfulContactNextAction('No action needed — application received')).toBe(
      false,
    );
    expect(
      isMeaningfulContactNextAction('Wait response, but gut says something changed'),
    ).toBe(false);
    expect(isMeaningfulContactNextAction('Send follow-up Thursday')).toBe(true);
  });
});
