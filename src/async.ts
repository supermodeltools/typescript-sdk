/**
 * Async Client Wrapper for Supermodel API
 * 
 * Provides automatic polling for async job endpoints, so you can use them
 * like synchronous APIs without manually implementing polling loops.
 * 
 * @example
 * ```typescript
 * import { DefaultApi, Configuration, SupermodelClient } from '@supermodeltools/sdk';
 * 
 * const api = new DefaultApi(new Configuration({ 
 *   basePath: 'https://api.supermodel.tools',
 *   apiKey: () => 'your-api-key'
 * }));
 * 
 * const client = new SupermodelClient(api);
 * 
 * // Returns the unwrapped result - polling is automatic!
 * const graph = await client.generateDependencyGraph(zipFile);
 * console.log(graph.graph.nodes.length);
 * ```
 */

import type { InitOverrideFunction } from './runtime';
import type { DefaultApi } from './apis/DefaultApi';
import type {
  CodeGraphEnvelope,
  CodeGraphEnvelopeAsync,
  DomainClassificationResponse,
  DomainClassificationResponseAsync,
  SupermodelIR,
  SupermodelIRAsync,
} from './models';

/**
 * Configuration options for the async client.
 */
export interface AsyncClientOptions {
  /**
   * Maximum time to wait for a job to complete (in milliseconds).
   * Default: 900000 (15 minutes)
   */
  timeoutMs?: number;

  /**
   * Default retry interval when server doesn't specify (in milliseconds).
   * Default: 10000 (10 seconds)
   */
  defaultRetryIntervalMs?: number;

  /**
   * Maximum number of polling attempts.
   * Default: 90
   */
  maxPollingAttempts?: number;

  /**
   * Callback for polling progress updates.
   * Useful for showing progress indicators in UIs.
   */
  onPollingProgress?: (status: PollingProgress) => void;

  /**
   * Function to generate idempotency keys.
   * Default: crypto.randomUUID() or fallback
   */
  generateIdempotencyKey?: () => string;

  /**
   * AbortSignal for cancelling the polling operation.
   * When aborted, throws an AbortError.
   */
  signal?: AbortSignal;
}

/**
 * Polling progress information passed to onPollingProgress callback.
 */
export interface PollingProgress {
  jobId: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  elapsedMs: number;
  nextRetryMs?: number;
}

/**
 * Options for individual graph generation requests.
 */
export interface GraphRequestOptions {
  /**
   * Idempotency key for the request (auto-generated if not provided).
   */
  idempotencyKey?: string;

  /**
   * Optional fetch init overrides (e.g., for API key auth headers).
   */
  initOverrides?: RequestInit | InitOverrideFunction;

  /**
   * AbortSignal for cancelling this specific request.
   * Overrides the signal set at client construction.
   */
  signal?: AbortSignal;
}

/**
 * Error thrown when a job fails.
 */
export class JobFailedError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly errorMessage: string
  ) {
    super(`Job ${jobId} failed: ${errorMessage}`);
    this.name = 'JobFailedError';
  }
}

/**
 * Error thrown when polling times out.
 */
export class PollingTimeoutError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly timeoutMs: number,
    public readonly attempts: number
  ) {
    super(`Polling timed out for job ${jobId} after ${timeoutMs}ms (${attempts} attempts)`);
    this.name = 'PollingTimeoutError';
  }
}

/**
 * Default idempotency key generator.
 */
function defaultGenerateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Polling aborted');
      error.name = 'AbortError';
      reject(error);
      return;
    }

    const timeout = setTimeout(() => {
      if (signal && onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    let onAbort: (() => void) | undefined;
    if (signal) {
      onAbort = () => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', onAbort!);
        const error = new Error('Polling aborted');
        error.name = 'AbortError';
        reject(error);
      };
      signal.addEventListener('abort', onAbort);
    }
  });
}

/**
 * Generic type for async response envelopes.
 */
interface AsyncEnvelope<T> {
  status: string;
  jobId: string;
  retryAfter?: number;
  error?: string;
  result?: T;
}

/**
 * Poll an async endpoint until completion.
 */
async function pollUntilComplete<T, R extends AsyncEnvelope<T>>(
  apiCall: () => Promise<R>,
  options: AsyncClientOptions
): Promise<T> {
  const {
    timeoutMs = 900000,
    defaultRetryIntervalMs = 10000,
    maxPollingAttempts = 90,
    onPollingProgress,
    signal,
  } = options;

  const startTime = Date.now();
  let attempt = 0;
  let jobId = '';

  while (attempt < maxPollingAttempts) {
    // Check for abort before each attempt
    if (signal?.aborted) {
      const error = new Error('Polling aborted');
      error.name = 'AbortError';
      throw error;
    }

    attempt++;
    const elapsedMs = Date.now() - startTime;

    if (elapsedMs >= timeoutMs) {
      throw new PollingTimeoutError(jobId || 'unknown', timeoutMs, attempt);
    }

    const response = await apiCall();
    jobId = response.jobId;
    const status = response.status;

    if (onPollingProgress) {
      const nextRetryMs = status === 'completed' || status === 'failed' 
        ? undefined 
        : (response.retryAfter || defaultRetryIntervalMs / 1000) * 1000;
      
      onPollingProgress({
        jobId,
        status,
        attempt,
        maxAttempts: maxPollingAttempts,
        elapsedMs,
        nextRetryMs,
      });
    }

    if (status === 'completed') {
      if (response.result !== undefined) {
        return response.result;
      }
      throw new Error(`Job ${jobId} completed but result is undefined`);
    }

    if (status === 'failed') {
      throw new JobFailedError(jobId, response.error || 'Unknown error');
    }

    const retryAfterMs = (response.retryAfter || defaultRetryIntervalMs / 1000) * 1000;
    
    // Use abortable sleep
    await sleepWithAbort(retryAfterMs, signal);
  }

  throw new PollingTimeoutError(jobId || 'unknown', timeoutMs, attempt);
}

/**
 * Async client wrapper that handles polling automatically.
 * 
 * Wraps the generated DefaultApi and provides simplified methods
 * for graph generation that handle async job polling internally.
 */
export class SupermodelClient {
  private api: DefaultApi;
  private options: AsyncClientOptions;
  private generateIdempotencyKey: () => string;

  constructor(api: DefaultApi, options: AsyncClientOptions = {}) {
    this.api = api;
    this.options = options;
    this.generateIdempotencyKey = options.generateIdempotencyKey || defaultGenerateIdempotencyKey;
  }

  /**
   * Generate a dependency graph from a zip file.
   * Automatically handles polling until the job completes.
   * 
   * @param file - Zip file containing the repository
   * @param options - Optional request options
   * @returns The dependency graph result
   */
  async generateDependencyGraph(
    file: Blob,
    options?: GraphRequestOptions
  ): Promise<CodeGraphEnvelope> {
    const key = options?.idempotencyKey || this.generateIdempotencyKey();
    const pollOptions = options?.signal ? { ...this.options, signal: options.signal } : this.options;
    return pollUntilComplete<CodeGraphEnvelope, CodeGraphEnvelopeAsync>(
      () => this.api.generateDependencyGraph({ idempotencyKey: key, file }, options?.initOverrides),
      pollOptions
    );
  }

  /**
   * Generate a call graph from a zip file.
   * Automatically handles polling until the job completes.
   */
  async generateCallGraph(
    file: Blob,
    options?: GraphRequestOptions
  ): Promise<CodeGraphEnvelope> {
    const key = options?.idempotencyKey || this.generateIdempotencyKey();
    const pollOptions = options?.signal ? { ...this.options, signal: options.signal } : this.options;
    return pollUntilComplete<CodeGraphEnvelope, CodeGraphEnvelopeAsync>(
      () => this.api.generateCallGraph({ idempotencyKey: key, file }, options?.initOverrides),
      pollOptions
    );
  }

  /**
   * Generate a domain graph from a zip file.
   * Automatically handles polling until the job completes.
   */
  async generateDomainGraph(
    file: Blob,
    options?: GraphRequestOptions
  ): Promise<DomainClassificationResponse> {
    const key = options?.idempotencyKey || this.generateIdempotencyKey();
    const pollOptions = options?.signal ? { ...this.options, signal: options.signal } : this.options;
    return pollUntilComplete<DomainClassificationResponse, DomainClassificationResponseAsync>(
      () => this.api.generateDomainGraph({ idempotencyKey: key, file }, options?.initOverrides),
      pollOptions
    );
  }

  /**
   * Generate a parse graph from a zip file.
   * Automatically handles polling until the job completes.
   */
  async generateParseGraph(
    file: Blob,
    options?: GraphRequestOptions
  ): Promise<CodeGraphEnvelope> {
    const key = options?.idempotencyKey || this.generateIdempotencyKey();
    const pollOptions = options?.signal ? { ...this.options, signal: options.signal } : this.options;
    return pollUntilComplete<CodeGraphEnvelope, CodeGraphEnvelopeAsync>(
      () => this.api.generateParseGraph({ idempotencyKey: key, file }, options?.initOverrides),
      pollOptions
    );
  }

  /**
   * Generate a Supermodel IR from a zip file.
   * Automatically handles polling until the job completes.
   */
  async generateSupermodelGraph(
    file: Blob,
    options?: GraphRequestOptions
  ): Promise<SupermodelIR> {
    const key = options?.idempotencyKey || this.generateIdempotencyKey();
    const pollOptions = options?.signal ? { ...this.options, signal: options.signal } : this.options;
    return pollUntilComplete<SupermodelIR, SupermodelIRAsync>(
      () => this.api.generateSupermodelGraph({ idempotencyKey: key, file }, options?.initOverrides),
      pollOptions
    );
  }

  /**
   * Access the underlying raw API for methods that don't need polling
   * or when you want direct control over the async envelope responses.
   */
  get rawApi(): DefaultApi {
    return this.api;
  }
}
