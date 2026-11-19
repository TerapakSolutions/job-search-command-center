import { outlookComposeUrl } from './outlookCompose';

describe('outlookComposeUrl', () => {
  it('fills To, Subject and body, encoding spaces as %20', () => {
    const url = new URL(
      outlookComposeUrl({
        to: 'nick@code-talent.example',
        subject: 'Re: Afresh Interview Request',
        body: 'Hi Nick,\n\nThanks & regards + more\n\nSteve',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://outlook.office.com/mail/deeplink/compose');
    expect(url.searchParams.get('to')).toBe('nick@code-talent.example');
    expect(url.searchParams.get('subject')).toBe('Re: Afresh Interview Request');
    expect(url.searchParams.get('body')).toBe('Hi Nick,\n\nThanks & regards + more\n\nSteve');
    expect(url.search).not.toContain('+');
  });

  it('leaves To and Subject out when unknown', () => {
    const url = new URL(outlookComposeUrl({ to: null, subject: '', body: 'Hi' }));
    expect(url.searchParams.has('to')).toBe(false);
    expect(url.searchParams.has('subject')).toBe(false);
    expect(url.searchParams.get('body')).toBe('Hi');
  });

  it('round-trips line breaks, non-ASCII, % and #', () => {
    const body = 'Hi José,\r\n\r\n100% sure — ticket #42?\nSteve';
    const url = new URL(outlookComposeUrl({ to: 'a@b.example', subject: 'Re: Café #1', body }));
    expect(url.hash).toBe('');
    expect(url.searchParams.get('body')).toBe(body);
    expect(url.searchParams.get('subject')).toBe('Re: Café #1');
  });
});
