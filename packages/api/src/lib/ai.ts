import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env';

export interface AiRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface ResolvedProvider {
  provider: 'anthropic' | 'openai';
  model: string;
}

/** Pick a provider from env: explicit AI_PROVIDER wins, else first key found. */
export function resolveProvider(env: Env): ResolvedProvider | null {
  const explicit = env.AI_PROVIDER;
  if (explicit === 'anthropic' || (explicit === undefined && env.ANTHROPIC_API_KEY)) {
    if (!env.ANTHROPIC_API_KEY) return null;
    return { provider: 'anthropic', model: env.AI_MODEL ?? 'claude-sonnet-5' };
  }
  if (explicit === 'openai' || (explicit === undefined && env.OPENAI_API_KEY)) {
    if (!env.OPENAI_API_KEY) return null;
    return { provider: 'openai', model: env.AI_MODEL ?? 'gpt-5-mini' };
  }
  return null;
}

/** Single-shot completion against the configured provider. */
export async function aiComplete(env: Env, req: AiRequest): Promise<string> {
  const resolved = resolveProvider(env);
  if (!resolved) {
    throw new HTTPException(501, {
      message:
        'No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY (and optionally AI_PROVIDER / AI_MODEL).',
    });
  }
  const maxTokens = req.maxTokens ?? 4000;

  if (resolved.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: resolved.model,
        max_tokens: maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      }),
    });
    if (!res.ok) {
      throw new HTTPException(502, {
        message: `AI provider error ${res.status}: ${(await res.text()).slice(0, 300)}`,
      });
    }
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    return data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENAI_API_KEY as string}`,
    },
    body: JSON.stringify({
      model: resolved.model,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    }),
  });
  if (!res.ok) {
    throw new HTTPException(502, {
      message: `AI provider error ${res.status}: ${(await res.text()).slice(0, 300)}`,
    });
  }
  const data = (await res.json()) as { choices: { message: { content: string | null } }[] };
  return data.choices[0]?.message.content ?? '';
}

/** Extract the first JSON value from an LLM response (handles code fences / prose). */
export function extractJson(text: string): unknown {
  let candidate = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(candidate);
  if (fenced?.[1]) candidate = fenced[1].trim();

  const starts = ['[', '{']
    .map((ch) => candidate.indexOf(ch))
    .filter((index) => index !== -1);
  if (starts.length === 0) throw new Error('no JSON found in AI response');
  candidate = candidate.slice(Math.min(...starts));

  const lastClose = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'));
  if (lastClose !== -1) candidate = candidate.slice(0, lastClose + 1);

  return JSON.parse(candidate);
}
