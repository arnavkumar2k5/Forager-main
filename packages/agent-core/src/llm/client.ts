import OpenAI from "openai";
import { env } from "@repo/config-env";

export type LLMProviderType = "groq" | "gemini" | "openai";

export interface LLMConfig {
  provider: LLMProviderType;
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  model: string;
  provider: LLMProviderType;
  durationMs: number;
}

type CustomLLMInvoker = (
  messages: LLMMessage[],
  config: LLMConfig
) => Promise<LLMResponse>;

const GLOBAL_LLM_KEY = Symbol.for("__forager_custom_llm_invoker__");
let customInvoker: CustomLLMInvoker | null = null;

export function setLLMClient(invoker: CustomLLMInvoker | null): void {
  customInvoker = invoker;
  (globalThis as Record<symbol, unknown>)[GLOBAL_LLM_KEY] = invoker;
}

export function resolveLLMConfig(): LLMConfig {
  const rawProvider = env.AI_PROVIDER?.toLowerCase() || env.MODEL_PROVIDER?.toLowerCase();
  let provider: LLMProviderType = "gemini";

  if (rawProvider === "openai") {
    provider = "openai";
  } else if (rawProvider === "groq") {
    provider = "groq";
  } else if (rawProvider === "gemini") {
    provider = "gemini";
  } else if (env.GEMINI_API_KEY) {
    provider = "gemini";
  } else if (env.GROQ_API_KEY) {
    provider = "groq";
  } else if (env.OPENAI_API_KEY) {
    provider = "openai";
  }

  if (provider === "gemini") {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured for Gemini provider.");
    }
    const candidate = env.AI_MODEL || env.SCOUT_MODEL;
    const model =
      candidate && !candidate.toLowerCase().startsWith("gpt-") && !candidate.toLowerCase().startsWith("o1")
        ? candidate
        : "gemini-3.5-flash-lite";

    return {
      provider: "gemini",
      model,
      apiKey,
      temperature: 0.2,
      maxTokens: 2048,
      timeoutMs: 30000,
    };
  }

  if (provider === "openai") {
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured for OpenAI provider.");
    }
    const candidate = env.AI_MODEL || env.SCOUT_MODEL;
    const model =
      candidate && !candidate.toLowerCase().includes("gemini")
        ? candidate
        : "gpt-4o-mini";

    return {
      provider: "openai",
      model,
      apiKey,
      temperature: 0.2,
      maxTokens: 2048,
      timeoutMs: 30000,
    };
  }

  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured for Groq provider.");
  }
  const model = env.AI_MODEL || env.SCOUT_MODEL || "openai/gpt-oss-20b";
  return {
    provider: "groq",
    model,
    apiKey,
    temperature: 0.2,
    maxTokens: 2048,
    timeoutMs: 30000,
  };
}

async function invokeGroq(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse> {
  const startTime = Date.now();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: "https://api.groq.com/openai/v1",
    timeout: config.timeoutMs || 30000,
  });

  const response = await client.chat.completions.create({
    model: config.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: config.temperature ?? 0.2,
    max_tokens: config.maxTokens ?? 1000,
    response_format: { type: "json_object" },
  });

  const choice = response.choices[0];
  const content = choice?.message?.content || "";
  const promptTokens = response.usage?.prompt_tokens || 0;
  const completionTokens = response.usage?.completion_tokens || 0;
  const tokensUsed = response.usage?.total_tokens || promptTokens + completionTokens;

  return {
    content,
    tokensUsed,
    promptTokens,
    completionTokens,
    model: config.model,
    provider: "groq",
    durationMs: Date.now() - startTime,
  };
}

async function invokeOpenAI(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse> {
  const startTime = Date.now();
  const client = new OpenAI({
    apiKey: config.apiKey,
    timeout: config.timeoutMs || 30000,
  });

  const response = await client.chat.completions.create({
    model: config.model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: config.temperature ?? 0.2,
    max_tokens: config.maxTokens ?? 1000,
    response_format: { type: "json_object" },
  });

  const choice = response.choices[0];
  const content = choice?.message?.content || "";
  const promptTokens = response.usage?.prompt_tokens || 0;
  const completionTokens = response.usage?.completion_tokens || 0;
  const tokensUsed = response.usage?.total_tokens || promptTokens + completionTokens;

  return {
    content,
    tokensUsed,
    promptTokens,
    completionTokens,
    model: config.model,
    provider: "openai",
    durationMs: Date.now() - startTime,
  };
}

export interface LLMUsageStats {
  totalRequests: number;
  totalTokens: number;
  retryCount: number;
  lastRateLimitAt: string | null;
}

const requestTimestamps: number[] = [];
const usageStats: LLMUsageStats = {
  totalRequests: 0,
  totalTokens: 0,
  retryCount: 0,
  lastRateLimitAt: null,
};

export function getLLMUsageStats(): LLMUsageStats {
  return { ...usageStats };
}

export function resetLLMUsageStats(): void {
  requestTimestamps.length = 0;
  usageStats.totalRequests = 0;
  usageStats.totalTokens = 0;
  usageStats.retryCount = 0;
  usageStats.lastRateLimitAt = null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function applyRpmPacing(maxRpm: number): Promise<void> {
  if (!Number.isFinite(maxRpm) || maxRpm <= 0) return;

  const windowMs = 60_000;
  const now = Date.now();
  while (requestTimestamps.length > 0 && now - requestTimestamps[0]! >= windowMs) {
    requestTimestamps.shift();
  }

  if (requestTimestamps.length >= maxRpm) {
    const oldest = requestTimestamps[0]!;
    const waitMs = Math.max(250, windowMs - (now - oldest) + 150);
    await sleep(waitMs);
  }

  requestTimestamps.push(Date.now());
}

function parseRetryDelayMs(err: unknown, attempt: number): number {
  const msg = err instanceof Error ? err.message : String(err);
  const retryMatch = msg.match(/retry\s*(?:in|after)?\s*(\d+(?:\.\d+)?)\s*s/i);
  if (retryMatch && retryMatch[1]) {
    return Math.ceil(Number(retryMatch[1]) * 1000) + 500;
  }
  return Math.min(30_000, 2000 * Math.pow(2, attempt));
}

function isRetryableRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(429|503|rate[\s_-]?limit|resource_exhausted|quota)\b/i.test(msg);
}

async function invokeGemini(messages: LLMMessage[], config: LLMConfig): Promise<LLMResponse> {
  const startTime = Date.now();
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const systemMessage = messages.find((m) => m.role === "system");
  const requestBody: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: config.temperature ?? 0.2,
      maxOutputTokens: config.maxTokens ?? 1000,
      responseMimeType: "application/json",
    },
  };

  if (systemMessage) {
    requestBody.systemInstruction = {
      parts: [{ text: systemMessage.content }],
    };
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(config.timeoutMs || 30000),
  });

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
    error?: { message?: string };
  };

  if (!response.ok || data.error) {
    const retryAfter = response.headers.get("retry-after");
    const retryHint = retryAfter ? ` (retry after ${retryAfter}s)` : "";
    throw new Error(`Gemini API error (${response.status}): ${data.error?.message || response.statusText}${retryHint}`);
  }

  const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const promptTokens = data.usageMetadata?.promptTokenCount || 0;
  const completionTokens = data.usageMetadata?.candidatesTokenCount || 0;
  const tokensUsed = data.usageMetadata?.totalTokenCount || promptTokens + completionTokens;

  return {
    content,
    tokensUsed,
    promptTokens,
    completionTokens,
    model: config.model,
    provider: "gemini",
    durationMs: Date.now() - startTime,
  };
}

export async function invokeLLM(
  messages: LLMMessage[],
  configOverride?: Partial<LLMConfig>
): Promise<LLMResponse> {
  const activeConfig = { ...resolveLLMConfig(), ...configOverride };
  const invoker = customInvoker || ((globalThis as Record<symbol, unknown>)[GLOBAL_LLM_KEY] as CustomLLMInvoker | null);
  if (invoker) {
    return invoker(messages, activeConfig);
  }

  const maxRpm = Number(env.LLM_MAX_RPM || 0);
  const maxRetries = Math.max(0, Number(env.LLM_MAX_RETRIES || 3));

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await applyRpmPacing(maxRpm);
    try {
      const response =
        activeConfig.provider === "gemini"
          ? await invokeGemini(messages, activeConfig)
          : activeConfig.provider === "openai"
            ? await invokeOpenAI(messages, activeConfig)
            : await invokeGroq(messages, activeConfig);

      usageStats.totalRequests += 1;
      usageStats.totalTokens += response.tokensUsed;
      return response;
    } catch (err) {
      if (attempt < maxRetries && isRetryableRateLimitError(err)) {
        usageStats.retryCount += 1;
        usageStats.lastRateLimitAt = new Date().toISOString();
        await sleep(parseRetryDelayMs(err, attempt));
        continue;
      }
      throw err;
    }
  }

  throw new Error("LLM invocation exceeded maximum retries.");
}

export function estimateTokenCost(
  tokensUsed: number,
  provider: LLMProviderType,
  promptTokens?: number,
  completionTokens?: number,
  model?: string
): number {
  if (tokensUsed <= 0) return 0;

  if (provider === "gemini") {
    // Verified Model Pricing:
    // Input: $0.30 per 1M tokens ($0.00000030 / token)
    // Output (including thinking tokens): $2.50 per 1M tokens ($0.00000250 / token)
    const promptRate = 0.00000030;
    const completionRate = 0.00000250;

    if (
      promptTokens !== undefined &&
      completionTokens !== undefined &&
      (promptTokens > 0 || completionTokens > 0)
    ) {
      const cost = promptTokens * promptRate + completionTokens * completionRate;
      return Number(cost.toFixed(6));
    }
    // Empirical distribution across web trajectories (~80% prompt / ~20% completion)
    const blendedRate = 0.80 * promptRate + 0.20 * completionRate;
    return Number((tokensUsed * blendedRate).toFixed(6));
  }

  const ratePerToken =
    provider === "groq"
      ? 0.0000002
      : provider === "openai"
        ? 0.0000003
        : 0.00000015;
  return Number((tokensUsed * ratePerToken).toFixed(6));
}
