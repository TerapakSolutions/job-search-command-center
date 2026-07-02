/** @jest-environment node */
import {
  contactApplicationLabel,
  isMeaningfulContactNextAction,
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
    ).toBe('Acme — Application not identified yet');
  });
});
