// Copyright (c) 2026 Carlos Felipe. MIT.
import { writeFile } from 'node:fs/promises';
import { buildN8nPreviewWorkflow } from '../src/n8n-workflow.mjs';

await writeFile(new URL('../workflows/n8n/crm-preview-internal.json', import.meta.url),
  JSON.stringify(buildN8nPreviewWorkflow(), null, 2) + '\n');
process.stdout.write('Workflow local exportado; nenhuma credencial ou conexão foi configurada.\n');
