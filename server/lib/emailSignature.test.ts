/** @jest-environment node */
import { parseSenderSignature } from './emailSignature.js';
import { outlookAlreadySubmittedElsewhere } from './__fixtures__/outlookAlreadySubmittedElsewhere.js';

describe('parseSenderSignature', () => {
  it("reads title, phone and LinkedIn from the counterparty's own quoted message", () => {
    expect(
      parseSenderSignature(outlookAlreadySubmittedElsewhere, {
        email: 'priya.nair@vendortwo.example',
        name: 'Priya Nair',
      }),
    ).toEqual({
      title: 'US IT Recruiter',
      phone: '+1 555-0199',
      linkedIn: 'https://www.linkedin.com/in/example-recruiter',
    });
  });

  it("control: never reads the forwarder's own signature (top of the forward)", () => {
    const result = parseSenderSignature(outlookAlreadySubmittedElsewhere, {
      email: 'steve@terapak.com',
      name: 'Steve Terapak',
    });
    expect(result.phone).not.toBe('+1 555-0199');
    expect(result.linkedIn).toBeNull();
  });

  it('returns nulls when the sender has no message in the text', () => {
    expect(
      parseSenderSignature(outlookAlreadySubmittedElsewhere, {
        email: 'someone@else.example',
        name: 'Someone Else',
      }),
    ).toEqual({ title: null, phone: null, linkedIn: null });
  });

  it.each(['Sent from my iPhone', 'Get Outlook for iOS<https://aka.ms/o0ukef>'])(
    'control: a mobile footer is not a title (%s)',
    (footer) => {
      const body = ['Sounds good.', '', 'Thanks,', 'Ravi', '', footer].join('\n');
      expect(
        parseSenderSignature(body, { email: 'ravi@acme.example', name: 'Ravi Kumar', wholeBody: true }).title,
      ).toBeNull();
    },
  );

  it('reads a plain (not forwarded) message signed by the sender', () => {
    const body = [
      'Hi Steve,',
      '',
      'Are you open to a Platform Lead role?',
      '',
      'Thanks,',
      'Ravi Kumar',
      'Senior Technical Recruiter',
      'Mobile: (555) 010-0123',
      'https://www.linkedin.com/in/ravi-kumar-example/',
    ].join('\n');
    expect(parseSenderSignature(body, { email: 'ravi@acme.example', name: 'Ravi Kumar', wholeBody: true })).toEqual({
      title: 'Senior Technical Recruiter',
      phone: '(555) 010-0123',
      linkedIn: 'https://www.linkedin.com/in/ravi-kumar-example',
    });
  });
});
