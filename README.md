# Supermodel TypeScript SDK

[![npm](https://img.shields.io/npm/v/@supermodeltools/sdk)](https://www.npmjs.com/package/@supermodeltools/sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

TypeScript client for the [Supermodel API](https://docs.supermodeltools.com) - code graph generation and static analysis.

## Install

```bash
npm install @supermodeltools/sdk
```

## Quick Start

Get your API key from the [Supermodel Dashboard](https://dashboard.supermodeltools.com) and set it as `SUPERMODEL_API_KEY`.

```typescript
import { Configuration, DefaultApi } from '@supermodeltools/sdk';
import { readFile } from 'node:fs/promises';

const config = new Configuration({
  basePath: 'https://api.supermodeltools.com',
  apiKey: process.env.SUPERMODEL_API_KEY,
});

const api = new DefaultApi(config);

// Create a ZIP of your repo: git archive -o /tmp/repo.zip HEAD
const file = new Blob([await readFile('/tmp/repo.zip')], { type: 'application/zip' });

const result = await api.generateSupermodelGraph({
  idempotencyKey: 'my-repo:supermodel:abc123',
  file,
});

console.log(result.graph.nodes.length, 'nodes');
```

## Methods

| Method | Description |
|--------|-------------|
| `generateDependencyGraph` | File-level dependency graph |
| `generateCallGraph` | Function-level call graph |
| `generateDomainGraph` | Domain model classification |
| `generateParseGraph` | AST parse tree relationships |
| `generateSupermodelGraph` | Full Supermodel IR bundle |

All methods require `idempotencyKey` (string) and `file` (Blob) parameters.

## Links

- [API Documentation](https://docs.supermodeltools.com)
- [OpenAPI Spec](https://www.npmjs.com/package/@supermodeltools/openapi-spec)
