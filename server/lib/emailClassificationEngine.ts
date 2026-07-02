import type { EmailClassificationResult } from './emailClassificationTypes.js';
import { defaultSuggestedAction, parseClassificationJson } from './emailClassificationParser.js';
import { isApplicationConfirmationText } from './emailAutomationMessages.js';
import { generateLlmCompletion, isLlmConfigured } from './llmClient.js';

const SYSTEM_PROMPT = `You classify inbound job-search emails and extract structured fields for a job seeker's command center.

Respond with ONLY valid JSON (no markdown) using this schema:
{
  "classification": one of ["Interview Request", "Application Confirmation", "Rejection", "Recruiter Outreach", "Follow-up Required", "Offer", "Scheduling", "General Update", "Other"],
  "classificationConfidence": number 0-100,
  "companyName": string or null,
  "positionTitle": string or null,
  "recruiterName": string or null,
  "requiresResponse": boolean,
  "suggestedAction": string,
  "actionDueAt": ISO-8601 string or null,
  "interviewDetected": boolean,
  "interviewDatetime": ISO-8601 string or null,
  "aiSummary": string (1-2 sentences)
}

Guidelines:
- "Interview Request": recruiter wants to schedule or proceed to interviews
- "Application Confirmation": acknowledgment that an application was received
- "Rejection": candidate not moving forward
- Set requiresResponse true when a reply is expected
- Do not invent facts not supported by the email`;

interface ClassifyInput {
  subject: string;
  fromEmail: string;
  textBody: string;
}

export async function classifyInboundEmailWithLlm(
  input: ClassifyInput,
): Promise<EmailClassificationResult | null> {
  if (!isLlmConfigured()) {
    return null;
  }

  const userPrompt = JSON.stringify(
    {
      subject: input.subject,
      fromEmail: input.fromEmail,
      textBody: input.textBody.slice(0, 8000),
    },
    null,
    2,
  );

  const raw = await generateLlmCompletion({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseFormat: 'json_object',
  });

  if (!raw) return null;
  return parseClassificationJson(raw);
}

export function classifyInboundEmailWithRules(
  input: ClassifyInput,
): EmailClassificationResult {
  const text = `${input.subject}\n${input.textBody}`.toLowerCase();

  if (
    /schedule an interview|want to schedule|interview invitation|move forward with an interview|reviewed your resume and want to schedule/.test(
      text,
    )
  ) {
    return buildRuleResult('Interview Request', 85, input, {
      requiresResponse: true,
      interviewDetected: true,
      suggestedAction: 'Reply to schedule the interview',
      aiSummary:
        'The sender wants to schedule an interview after reviewing your application.',
    });
  }

  if (isApplicationConfirmationText(text)) {
    return buildRuleResult('Application Confirmation', 85, input, {
      requiresResponse: false,
      suggestedAction: 'No action needed — application received',
      aiSummary: 'Automated or recruiter confirmation that your application was received.',
    });
  }

  if (
    /move forward with other candidates|not moving forward|decided to pursue other|unfortunately|regret to inform|not selected|no longer under consideration/.test(
      text,
    )
  ) {
    return buildRuleResult('Rejection', 85, input, {
      requiresResponse: false,
      suggestedAction: 'Archive the application and move on',
      aiSummary: 'The company indicated they will not proceed with your candidacy.',
    });
  }

  if (/offer letter|pleased to offer|extend an offer|compensation package/.test(text)) {
    return buildRuleResult('Offer', 80, input, {
      requiresResponse: true,
      suggestedAction: 'Review offer details and respond promptly',
      aiSummary: 'This email appears to contain a job offer or offer discussion.',
    });
  }

  if (/following up|follow up|checking in|any update|still interested/.test(text)) {
    return buildRuleResult('Follow-up Required', 70, input, {
      requiresResponse: true,
      suggestedAction: 'Send a follow-up reply',
      aiSummary: 'The sender is following up and may expect a response.',
    });
  }

  if (/recruiter|talent acquisition|hiring manager|opportunity at/.test(text)) {
    if (isApplicationConfirmationText(text)) {
      return buildRuleResult('Application Confirmation', 85, input, {
        requiresResponse: false,
        suggestedAction: 'No action needed — application received',
        aiSummary: 'Automated or recruiter confirmation that your application was received.',
      });
    }
    return buildRuleResult('Recruiter Outreach', 65, input, {
      requiresResponse: true,
      suggestedAction: 'Review opportunity and respond if interested',
      aiSummary: 'Recruiter outreach about a potential role or conversation.',
    });
  }

  return buildRuleResult('Other', 50, input, {
    requiresResponse: false,
    suggestedAction: defaultSuggestedAction('Other'),
    aiSummary: 'General job-search email — review manually for next steps.',
  });
}

function buildRuleResult(
  classification: EmailClassificationResult['classification'],
  confidence: number,
  input: ClassifyInput,
  overrides: Partial<EmailClassificationResult>,
): EmailClassificationResult {
  const companyMatch = input.textBody.match(
    /(?:at|with|from)\s+([A-Z][A-Za-z0-9&.\- ]{2,40})/,
  );

  return {
    classification,
    classificationConfidence: confidence,
    companyName: overrides.companyName ?? companyMatch?.[1]?.trim() ?? null,
    positionTitle: overrides.positionTitle ?? null,
    recruiterName: overrides.recruiterName ?? null,
    requiresResponse: overrides.requiresResponse ?? false,
    suggestedAction:
      overrides.suggestedAction ?? defaultSuggestedAction(classification),
    actionDueAt: overrides.actionDueAt ?? null,
    interviewDetected: overrides.interviewDetected ?? false,
    interviewDatetime: overrides.interviewDatetime ?? null,
    aiSummary:
      overrides.aiSummary ??
      defaultSuggestedAction(classification),
  };
}
