import type { AiRun } from '@croquis/shared';
import { z } from 'zod';
import type { Env } from '../env';
import { ApiError, badGateway, notImplemented } from '../http/problem';
import { newId } from '../security/tokens';

/**
 * Provider-neutral structured generation. Every call asks the model for JSON
 * matching a Zod schema (tool use on Anthropic, `json_schema` response format
 * on OpenAI and Workers AI), validates the answer, and records an `ai_runs`
 * row for cost and failure visibility.
 *
 * Provider selection: AI_PROVIDER wins when set (`none` disables AI);
 * otherwise an Anthropic key, then an OpenAI key, then the Workers AI binding —
 * so a fresh Cloudflare deployment has AI with zero configuration.
 */

export type AiProviderName = 'anthropic' | 'openai' | 'workers-ai';

export interface ResolvedAi {
  provider: AiProviderName;
  model: string;
}

const DEFAULT_MODELS: Record<AiProviderName, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5-mini',
  'workers-ai': '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
};
const TIMEOUT_MS = 60_000;

export function resolveAi(env: Env): ResolvedAi | null {
  const explicit = env.AI_PROVIDER?.trim().toLowerCase();
  const pick = (provider: AiProviderName): ResolvedAi => ({
    provider,
    model: env.AI_MODEL?.trim() || DEFAULT_MODELS[provider],
  });
  if (explicit === 'none') return null;
  if (explicit === 'anthropic') return env.ANTHROPIC_API_KEY ? pick('anthropic') : null;
  if (explicit === 'openai') return env.OPENAI_API_KEY ? pick('openai') : null;
  if (explicit === 'workers-ai') return env.AI ? pick('workers-ai') : null;
  if (env.ANTHROPIC_API_KEY) return pick('anthropic');
  if (env.OPENAI_API_KEY) return pick('openai');
  if (env.AI) return pick('workers-ai');
  return null;
}

export function aiConfigured(env: Env): boolean {
  return resolveAi(env) !== null;
}

export interface AiContext {
  workspaceId: string;
  projectId: string | null;
  kind: AiRun['kind'];
  actorId: string | null;
}

export interface GenerateRequest<T extends z.ZodType> {
  system: string;
  prompt: string;
  schema: T;
  /** Name of the JSON object the model returns (used as the tool name). */
  name: string;
  maxTokens?: number;
}

interface ProviderResult {
  json: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
}

/** JSON Schema for the model: objects only (tool inputs must be objects). */
function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  return rest;
}

async function readError(response: Response): Promise<string> {
  return `${response.status} ${(await response.text()).slice(0, 300)}`;
}

async function callAnthropic(
  env: Env,
  model: string,
  req: GenerateRequest<z.ZodType>,
): Promise<ProviderResult> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 4096,
      system: req.system,
      messages: [{ role: 'user', content: req.prompt }],
      tools: [
        {
          name: req.name,
          description: 'Return the result.',
          input_schema: jsonSchemaOf(req.schema),
        },
      ],
      tool_choice: { type: 'tool', name: req.name },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Anthropic ${await readError(response)}`);
  const data = (await response.json()) as {
    content: { type: string; input?: unknown }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const tool = data.content.find((block) => block.type === 'tool_use');
  return {
    json: tool?.input,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
  };
}

async function callOpenAi(
  env: Env,
  model: string,
  req: GenerateRequest<z.ZodType>,
): Promise<ProviderResult> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENAI_API_KEY as string}`,
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: req.maxTokens ?? 4096,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: req.name, schema: jsonSchemaOf(req.schema), strict: false },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`OpenAI ${await readError(response)}`);
  const data = (await response.json()) as {
    choices: { message: { content: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    json: JSON.parse(data.choices[0]?.message.content ?? 'null'),
    inputTokens: data.usage?.prompt_tokens ?? null,
    outputTokens: data.usage?.completion_tokens ?? null,
  };
}

async function callWorkersAi(
  env: Env,
  model: string,
  req: GenerateRequest<z.ZodType>,
): Promise<ProviderResult> {
  const ai = env.AI as Ai;
  const result = (await ai.run(
    model as Parameters<Ai['run']>[0],
    {
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ],
      max_tokens: req.maxTokens ?? 4096,
      response_format: { type: 'json_schema', json_schema: jsonSchemaOf(req.schema) },
    } as never,
  )) as { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const raw = result.response;
  return {
    json: typeof raw === 'string' ? JSON.parse(raw) : raw,
    inputTokens: result.usage?.prompt_tokens ?? null,
    outputTokens: result.usage?.completion_tokens ?? null,
  };
}

function recordRun(
  ctx: AiContext,
  resolved: ResolvedAi,
  run: Omit<AiRun, 'id' | 'kind' | 'provider' | 'model' | 'created_at'>,
): AiRun {
  const row: AiRun = {
    id: newId(),
    kind: ctx.kind,
    provider: resolved.provider,
    model: resolved.model,
    created_at: Date.now(),
    ...run,
  };
  return row;
}

export function insertRun(db: D1Database, ctx: AiContext, run: AiRun): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ai_runs (id, workspace_id, project_id, kind, provider, model, status, input_tokens, output_tokens,
                            duration_ms, error, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      run.id,
      ctx.workspaceId,
      ctx.projectId,
      run.kind,
      run.provider,
      run.model,
      run.status,
      run.input_tokens,
      run.output_tokens,
      run.duration_ms,
      run.error,
      ctx.actorId,
      run.created_at,
    );
}

/**
 * Generate and validate. Failed runs are logged and surface as 502
 * `ai_provider_error` / `ai_invalid_output`; a missing provider is 501.
 * Successful runs are returned for the caller to persist with its own batch.
 */
export async function generate<T extends z.ZodType>(
  env: Env,
  ctx: AiContext,
  req: GenerateRequest<T>,
): Promise<{ value: z.output<T>; run: AiRun }> {
  const resolved = resolveAi(env);
  if (!resolved) {
    throw notImplemented(
      'ai_not_configured',
      'No AI provider is configured. Add the Workers AI binding, or set ANTHROPIC_API_KEY / OPENAI_API_KEY.',
    );
  }
  const started = Date.now();
  let result: ProviderResult;
  try {
    const call =
      resolved.provider === 'anthropic'
        ? callAnthropic
        : resolved.provider === 'openai'
          ? callOpenAi
          : callWorkersAi;
    result = await call(env, resolved.model, req);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'request failed';
    const run = recordRun(ctx, resolved, {
      status: 'failed',
      input_tokens: null,
      output_tokens: null,
      duration_ms: Date.now() - started,
      error: message.slice(0, 500),
    });
    await insertRun(env.DB, ctx, run).run();
    throw badGateway('ai_provider_error', `The AI provider failed: ${message.slice(0, 200)}`);
  }

  const parsed = req.schema.safeParse(result.json);
  const run = recordRun(ctx, resolved, {
    status: parsed.success ? 'succeeded' : 'failed',
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    duration_ms: Date.now() - started,
    error: parsed.success ? null : 'output did not match the schema',
  });
  if (!parsed.success) {
    await insertRun(env.DB, ctx, run).run();
    throw new ApiError(
      502,
      'ai_invalid_output',
      'Bad gateway',
      'The AI answer did not match the expected format; retry',
    );
  }
  return { value: parsed.data, run };
}
