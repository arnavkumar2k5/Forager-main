import { env } from "@repo/config-env";
import { Proposition } from "@repo/types";

export const EXPECTED_EMBEDDING_DIM = 1024;
export const DEFAULT_GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";

export interface EmbeddingClient {
  generateEmbedding(text: string): Promise<number[]>;
  generateBatchEmbeddings?(texts: string[]): Promise<number[][]>;
}

const GLOBAL_EMBEDDING_KEY = Symbol.for("__forager_embedding_client__");
let embeddingClientOverride: EmbeddingClient | null = null;
const embeddingCache = new Map<string, number[]>();

export function setEmbeddingClient(client: EmbeddingClient | null): void {
  embeddingClientOverride = client;
  (globalThis as any)[GLOBAL_EMBEDDING_KEY] = client;
}

export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

export function isValidEmbedding(vec: unknown): vec is number[] {
  if (!Array.isArray(vec)) return false;
  if (vec.length !== EXPECTED_EMBEDDING_DIM) return false;
  for (let i = 0; i < vec.length; i++) {
    const val = vec[i];
    if (typeof val !== "number" || !Number.isFinite(val)) {
      return false;
    }
  }
  return true;
}

export function validateEmbedding(vec: unknown, label = "vector"): number[] {
  if (!Array.isArray(vec)) {
    throw new Error(`Invalid ${label}: expected array of numbers, got ${typeof vec}`);
  }
  if (vec.length !== EXPECTED_EMBEDDING_DIM) {
    throw new Error(
      `Embedding dimension mismatch for ${label}: expected ${EXPECTED_EMBEDDING_DIM}, got ${vec.length}`
    );
  }
  for (let i = 0; i < vec.length; i++) {
    const val = vec[i];
    if (typeof val !== "number" || !Number.isFinite(val)) {
      throw new Error(
        `Invalid ${label} component at index ${i}: expected finite numeric value, got ${val}`
      );
    }
  }
  return vec;
}

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  validateEmbedding(vecA, "vector A");
  validateEmbedding(vecB, "vector B");

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < EXPECTED_EMBEDDING_DIM; i++) {
    const a = vecA[i]!;
    const b = vecB[i]!;
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(-1.0, Math.min(1.0, similarity));
}

export function normalizeGeminiModel(model: string): string {
  return model.trim().replace(/^models\//i, "");
}

export function getGeminiEmbeddingConfig(): { apiKey: string; model: string } {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured for embedding inference");
  }
  const rawModel = env.GEMINI_EMBEDDING_MODEL || DEFAULT_GEMINI_EMBEDDING_MODEL;

  return { apiKey, model: normalizeGeminiModel(rawModel) };
}

export async function generateGeminiEmbedding(
  text: string,
  options?: { timeoutMs?: number }
): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Cannot generate embedding for empty or whitespace text");
  }

  // Deduplicate redundant requests within same execution / process
  const cached = embeddingCache.get(trimmed);
  if (cached) {
    return [...cached];
  }

  const client = embeddingClientOverride || (globalThis as any)[GLOBAL_EMBEDDING_KEY];
  if (client) {
    const rawVector = await client.generateEmbedding(trimmed);
    const validVector = validateEmbedding(rawVector, "mock embedding");
    embeddingCache.set(trimmed, [...validVector]);
    return [...validVector];
  }

  const { apiKey, model } = getGeminiEmbeddingConfig();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
  const timeoutMs = options?.timeoutMs ?? 10000;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: {
          parts: [{ text: trimmed }],
        },
        outputDimensionality: EXPECTED_EMBEDDING_DIM,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const errObj = err as Error;
    if (errObj.name === "TimeoutError") {
      throw new Error(`Gemini embedding request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Failed to connect to Gemini embedding endpoint: ${errObj.message}`);
  }

  if (!response.ok) {
    let errDetail = response.statusText;
    try {
      const errBody = (await response.json()) as { error?: { message?: string } };
      if (errBody?.error?.message) {
        errDetail = errBody.error.message.replace(/([a-zA-Z0-9_\-]{20,})/g, "[REDACTED]");
      }
    } catch {}
    throw new Error(`Gemini embedding request failed with HTTP ${response.status} (${errDetail})`);
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Failed to parse Gemini embedding response: ${(err as Error).message}`);
  }

  const embeddingObj = data.embedding as { values?: unknown } | undefined;
  const rawValues = embeddingObj?.values;

  const validated = validateEmbedding(rawValues, "Gemini embedding");
  embeddingCache.set(trimmed, [...validated]);
  return [...validated];
}

export async function generateEmbeddingSafe(
  text: string,
  options?: { timeoutMs?: number }
): Promise<{ success: boolean; embedding?: number[]; error?: string }> {
  try {
    const embedding = await generateGeminiEmbedding(text, options);
    return { success: true, embedding };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

export async function attachPropositionEmbeddings(
  propositions: Proposition[],
  options?: { timeoutMs?: number }
): Promise<{ count: number; failed: number }> {
  let count = 0;
  let failed = 0;

  for (const prop of propositions) {
    const result = await generateEmbeddingSafe(prop.content, options);
    if (result.success && result.embedding) {
      prop.embedding = result.embedding;
      count++;
    } else {
      prop.embedding = undefined;
      failed++;
    }
  }

  return { count, failed };
}
