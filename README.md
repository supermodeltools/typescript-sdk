# Supermodel TypeScript SDK

Official TypeScript/JavaScript SDK for the [Supermodel API](https://supermodeltools.com).

Generate code graphs, dependency analysis, and domain models from your source code repositories.

---

## ⭐ Star the Supermodel Ecosystem

If this is useful, please star our tools — it helps us grow:

[![mcp](https://img.shields.io/github/stars/supermodeltools/mcp?style=social)](https://github.com/supermodeltools/mcp) &nbsp;[![mcpbr](https://img.shields.io/github/stars/supermodeltools/mcpbr?style=social)](https://github.com/supermodeltools/mcpbr) &nbsp;[![typescript-sdk](https://img.shields.io/github/stars/supermodeltools/typescript-sdk?style=social)](https://github.com/supermodeltools/typescript-sdk) &nbsp;[![arch-docs](https://img.shields.io/github/stars/supermodeltools/arch-docs?style=social)](https://github.com/supermodeltools/arch-docs) &nbsp;[![dead-code-hunter](https://img.shields.io/github/stars/supermodeltools/dead-code-hunter?style=social)](https://github.com/supermodeltools/dead-code-hunter) &nbsp;[![Uncompact](https://img.shields.io/github/stars/supermodeltools/Uncompact?style=social)](https://github.com/supermodeltools/Uncompact) &nbsp;[![narsil-mcp](https://img.shields.io/github/stars/supermodeltools/narsil-mcp?style=social)](https://github.com/supermodeltools/narsil-mcp)

---

## Installation

```bash
npm install @supermodeltools/sdk
```

## Quick Start

### Basic Usage (Auto-Polling)

The SDK provides a high-level `SupermodelClient` that automatically handles async job polling:

```typescript
import { SupermodelClient, DefaultApi, Configuration } from '@supermodeltools/sdk';
import { readFile } from 'node:fs/promises';

// Configure the API client
const api = new DefaultApi(new Configuration({
  basePath: 'https://api.supermodeltools.com',
  apiKey: () => process.env.SUPERMODEL_API_KEY || ''
}));

// Create the async client wrapper
const client = new SupermodelClient(api);

// Generate a code graph (polling handled automatically)
const zipBuffer = await readFile('./my-repo.zip');
const zipBlob = new Blob([zipBuffer]);

const result = await client.generateSupermodelGraph(zipBlob);
console.log(`Generated graph with ${result.graph.nodes.length} nodes`);
```

### Advanced Configuration

Configure polling behavior for long-running operations:

```typescript
const client = new SupermodelClient(api, {
  // Maximum time to wait for job completion
  timeoutMs: 900000,  // 15 minutes (default)

  // Polling interval when server doesn't specify
  defaultRetryIntervalMs: 10000,  // 10 seconds (default)

  // Maximum number of polling attempts
  maxPollingAttempts: 90,  // (default)

  // Progress callback
  onPollingProgress: (progress) => {
    console.log(`Job ${progress.jobId}: ${progress.status} ` +
                `(${progress.attempt}/${progress.maxAttempts})`);
  },

  // Cancellation support
  signal: abortController.signal,
});
```

### Per-Request Configuration

Override client defaults for specific requests:

```typescript
// Use a custom idempotency key
const result = await client.generateDependencyGraph(zipBlob, {
  idempotencyKey: 'my-repo:dependency:abc123',
});

// Add custom headers (e.g., for different auth)
const result = await client.generateCallGraph(zipBlob, {
  initOverrides: {
    headers: { 'Authorization': 'Bearer custom-token' }
  }
});

// Cancel a specific request
const controller = new AbortController();
const promise = client.generateParseGraph(zipBlob, {
  signal: controller.signal
});

// Later: controller.abort();
```

## Available Methods

### SupermodelClient (Async Wrapper)

All methods automatically handle polling until job completion:

- `generateSupermodelGraph(file, options?)` - Full Supermodel IR with all analysis
- `generateDependencyGraph(file, options?)` - Module/package dependencies
- `generateCallGraph(file, options?)` - Function-level call relationships
- `generateDomainGraph(file, options?)` - High-level domain model
- `generateParseGraph(file, options?)` - AST-level parse tree

### Raw API (Manual Polling)

Access the underlying API for manual control:

```typescript
const rawApi = client.rawApi;

// Make initial request
let response = await rawApi.generateDependencyGraph({
  idempotencyKey: 'my-key',
  file: zipBlob
});

// Poll manually
while (response.status === 'pending' || response.status === 'processing') {
  await sleep(response.retryAfter * 1000);
  response = await rawApi.generateDependencyGraph({
    idempotencyKey: 'my-key',
    file: zipBlob
  });
}

if (response.status === 'completed') {
  console.log(response.result);
}
```

## Configuration Options

### AsyncClientOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeoutMs` | `number` | `900000` (15 min) | Maximum time to wait for job completion |
| `defaultRetryIntervalMs` | `number` | `10000` (10 sec) | Polling interval when server doesn't specify |
| `maxPollingAttempts` | `number` | `90` | Maximum number of polling attempts |
| `onPollingProgress` | `function` | `undefined` | Callback for polling progress updates |
| `generateIdempotencyKey` | `function` | `crypto.randomUUID()` | Custom idempotency key generator |
| `signal` | `AbortSignal` | `undefined` | AbortSignal for cancelling operations |

### GraphRequestOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `idempotencyKey` | `string` | auto-generated | Idempotency key for request deduplication |
| `initOverrides` | `RequestInit` | `undefined` | Custom fetch options (headers, etc.) |
| `signal` | `AbortSignal` | `undefined` | Request-specific abort signal |

## Error Handling

```typescript
import { JobFailedError, PollingTimeoutError } from '@supermodeltools/sdk';

try {
  const result = await client.generateDependencyGraph(zipBlob);
} catch (error) {
  if (error instanceof JobFailedError) {
    console.error(`Job ${error.jobId} failed: ${error.errorMessage}`);
  } else if (error instanceof PollingTimeoutError) {
    console.error(`Job ${error.jobId} timed out after ${error.timeoutMs}ms`);
  } else if (error.name === 'AbortError') {
    console.log('Operation cancelled');
  } else {
    throw error;
  }
}
```

## Idempotency

The API uses idempotency keys to prevent duplicate processing. The same key will always return the same result:

```typescript
// Generate a stable key from your repo state
import crypto from 'crypto';
import { execSync } from 'child_process';

const gitHash = execSync('git rev-parse --short HEAD').toString().trim();
const idempotencyKey = `my-project:supermodel:${gitHash}`;

// This will generate once, then return cached result on subsequent calls
const result = await client.generateSupermodelGraph(zipBlob, {
  idempotencyKey
});
```

## Preparing Repository Archives

### For Git Repositories (Recommended)

```bash
cd /path/to/your/repo
git archive -o /tmp/repo.zip HEAD
```

This automatically respects `.gitignore` and creates clean, reproducible archives.

### For Any Directory

```bash
cd /path/to/your/repo
zip -r /tmp/repo.zip . \
  -x "node_modules/*" \
  -x ".git/*" \
  -x "dist/*" \
  -x "*.pyc" \
  -x "__pycache__/*"
```

### What to Include

- ✅ Source code files (`.py`, `.js`, `.ts`, `.java`, etc.)
- ✅ Configuration files (`package.json`, `pyproject.toml`, etc.)
- ✅ Type definitions (`.d.ts`, `.pyi`)
- ❌ Dependencies (`node_modules/`, `venv/`, `target/`)
- ❌ Build outputs (`dist/`, `build/`, `.next/`)
- ❌ Large binaries, images, datasets

### Size Limits

Archives should be under 50MB. If larger:
- Ensure dependencies are excluded
- Consider analyzing a subdirectory
- Check for accidentally committed binaries

## TypeScript Support

Full TypeScript definitions are included. Types are automatically resolved via `package.json`.

```typescript
import type {
  SupermodelIR,
  CodeGraphEnvelope,
  DomainClassificationResponse,
} from '@supermodeltools/sdk';

// Types are available for all request/response models
```

## Environment Support

- ✅ Node.js (18+)
- ✅ Modern browsers (with Blob support)
- ✅ Webpack, Vite, Rollup
- ✅ ES6 modules and CommonJS

## Authentication

Get your API key from the [Supermodel Dashboard](https://dashboard.supermodeltools.com).

```typescript
const api = new DefaultApi(new Configuration({
  basePath: 'https://api.supermodeltools.com',
  apiKey: () => process.env.SUPERMODEL_API_KEY || ''
}));
```

## Rate Limiting

The API includes rate limiting headers in responses:

```typescript
const response = await rawApi.generateDependencyGraphRaw({
  idempotencyKey: 'key',
  file: blob
});

console.log(response.raw.headers.get('RateLimit-Limit'));
console.log(response.raw.headers.get('RateLimit-Remaining'));
console.log(response.raw.headers.get('RateLimit-Reset'));
```

## Examples

### Integration with mcpbr

```typescript
import { SupermodelClient, DefaultApi, Configuration } from '@supermodeltools/sdk';

const api = new DefaultApi(new Configuration({
  basePath: process.env.SUPERMODEL_BASE_URL || 'https://api.supermodeltools.com',
  apiKey: () => process.env.SUPERMODEL_API_KEY || ''
}));

// Configure for long-running benchmark operations
const client = new SupermodelClient(api, {
  timeoutMs: 900000,           // 15 minutes
  maxPollingAttempts: 90,       // 90 attempts
  onPollingProgress: (progress) => {
    console.log(`[${progress.jobId}] ${progress.status} - ` +
                `attempt ${progress.attempt}/${progress.maxAttempts}`);
  }
});
```

## Links

- [API Documentation](https://docs.supermodeltools.com)
- [GitHub Repository](https://github.com/supermodeltools/supermodel-public-api)
- [Dashboard](https://dashboard.supermodeltools.com)
- [Terms of Service](https://supermodeltools.com/legal/api-terms)

## License

This SDK is licensed under the MIT License. See the main repository for details.
