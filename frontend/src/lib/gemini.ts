export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatOpts {
  json?: boolean;
  temperature?: number;
}

const MODEL = 'gemini-2.5-flash';

export class GeminiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'GeminiError';
  }
}

function parseErrorBody(text: string): string {
  try {
    const json = JSON.parse(text) as { error?: { message?: string } };
    return json.error?.message ?? text;
  } catch {
    return text;
  }
}

export async function geminiChat(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string> {
  const key = process.env.GEMINI_API_KEY ?? '';
  if (!key) throw new Error('GEMINI_API_KEY not set');

  const systemMessage = messages.find(m => m.role === 'system');
  const otherMessages = messages.filter(m => m.role !== 'system');

  const body: Record<string, unknown> = {
    contents: otherMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      ...(opts.json && { responseMimeType: 'application/json' }),
    },
  };
  if (systemMessage) {
    body.systemInstruction = { parts: [{ text: systemMessage.content }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`;
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };

  // Retry transient 5xx once. Don't retry 4xx (incl. 429 daily quota — quota
  // doesn't reset in 500ms).
  const MAX_ATTEMPTS = 2;
  let lastStatus = 0;
  let lastMessage = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) {
      const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }
    lastStatus = res.status;
    lastMessage = parseErrorBody(await res.text());
    if (res.status >= 500 && res.status < 600 && attempt < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, 500 * attempt));
      continue;
    }
    break;
  }
  throw new GeminiError(lastStatus, lastMessage);
}

export function parseJson<T>(text: string): T {
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(stripped) as T;
}
