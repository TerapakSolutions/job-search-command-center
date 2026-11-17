import { GoogleAuth } from 'google-auth-library';

/**
 * Gemini on Vertex AI (native generateContent), selected by AI_PROVIDER=gemini.
 * Same request shape and host rules as the SEO engine (trend-tagger
 * src/utils/vertexEndpoint.ts) and Lookout (services/ai/llmProvider.ts).
 *
 * Credential values never reach a log or an error message: a bad JSON string
 * is reported as "not configured", and a failed token fetch throws a fixed
 * message with no `cause` (Node prints causes, and a JSON.parse or signing
 * error can quote the input).
 */

const VERTEX_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DEFAULT_MODEL = 'gemini-3.8-flash';
// gemini-3.8-flash is served on `global` (and the us/eu multi-regions), not
// on us-central1 — trend-tagger measured a 404 there on 2026-11-16.
const DEFAULT_LOCATION = 'global';

/**
 * Thinking counts toward maxOutputTokens (Google AI docs; Google staff on the
 * developer forum), so OpenAI's 800 would leave little or nothing for the
 * answer. 800 for the answer plus headroom for LOW thinking. Only generated
 * tokens are billed; this is a ceiling, not a spend.
 */
export const GEMINI_MAX_OUTPUT_TOKENS = 4096;

export interface GeminiConfig {
  project: string;
  location: string;
  model: string;
  credentials: Record<string, unknown>;
  credentialsKey: string;
}

export function readGeminiConfig(): GeminiConfig | null {
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  if (!project || !raw) return null;

  let credentials: unknown;
  try {
    credentials = JSON.parse(raw);
  } catch {
    return null; // never echo the parse error: it quotes the credential
  }
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) {
    return null;
  }

  return {
    project,
    location: (process.env.VERTEX_LOCATION?.trim() || DEFAULT_LOCATION).toLowerCase(),
    model: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL,
    credentials: credentials as Record<string, unknown>,
    credentialsKey: raw,
  };
}

/**
 * `global` has no region prefix on the host; the us/eu multi-regions use the
 * `.rep.` host (Vertex locations doc); a single region uses `{region}-`.
 */
function vertexHost(location: string): string {
  if (location === 'global') return 'aiplatform.googleapis.com';
  if (location === 'us' || location === 'eu') return `aiplatform.${location}.rep.googleapis.com`;
  return `${location}-aiplatform.googleapis.com`;
}

export function vertexGenerateContentUrl(config: GeminiConfig): string {
  const host = vertexHost(config.location);
  return (
    `https://${host}/v1/projects/${config.project}` +
    `/locations/${config.location}/publishers/google/models/${config.model}:generateContent`
  );
}

export function buildGeminiRequestBody(options: {
  systemPrompt: string;
  userPrompt: string;
  json: boolean;
}): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: options.systemPrompt }] },
    // Vertex requires the role (400 INVALID_ARGUMENT without it).
    contents: [{ role: 'user', parts: [{ text: options.userPrompt }] }],
    generationConfig: {
      // No temperature: Google's gemini-3.8-flash guide says sampling
      // parameters are ignored by the backend and should be removed.
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      ...(options.json ? { responseMimeType: 'application/json' } : {}),
      // Vertex REST enum ThinkingLevel. 3.8-flash defaults to MEDIUM and
      // rejects MINIMAL; thinkingBudget is deprecated for Gemini 3.
      thinkingConfig: { thinkingLevel: 'LOW' },
    },
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
}

/**
 * The answer text, or null. A MAX_TOKENS stop means truncated JSON or a
 * half-written brief, so callers get null and use their rules fallback.
 */
export function geminiResponseText(json: GeminiResponse): string | null {
  const candidate = json.candidates?.[0];
  if (!candidate || candidate.finishReason === 'MAX_TOKENS') return null;
  const text = (candidate.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  return text || null;
}

/**
 * Which "AI paused" outcome a Vertex error means, keyed on the HTTP status:
 * the 402 (prepaid credit depleted) body says RESOURCE_EXHAUSTED, the same
 * word a 429 uses. 429 = retry shortly; 402 or billing disabled = paused.
 */
export function geminiQuotaReason(
  status: number,
  body: string,
): 'insufficient_quota' | 'rate_limited' | null {
  if (status === 429) return 'rate_limited';
  if (status === 402) return 'insufficient_quota';
  if (status === 403 && body.includes('BILLING_DISABLED')) return 'insufficient_quota';
  return null;
}

// google-auth-library caches and refreshes the token itself; we only keep one
// client per credential value.
let authClient: { key: string; auth: GoogleAuth } | null = null;

export async function getVertexAccessToken(config: GeminiConfig): Promise<string> {
  try {
    if (!authClient || authClient.key !== config.credentialsKey) {
      authClient = {
        key: config.credentialsKey,
        auth: new GoogleAuth({ credentials: config.credentials, scopes: [VERTEX_SCOPE] }),
      };
    }
    const token = await authClient.auth.getAccessToken();
    if (token) return token;
  } catch {
    // fall through to the fixed message below
  }
  authClient = null;
  throw new Error(
    'Gemini authentication failed: could not get a Google access token from GOOGLE_APPLICATION_CREDENTIALS_JSON',
  );
}
