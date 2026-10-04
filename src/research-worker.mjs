// Copyright (c) 2026 Carlos Felipe. SPDX-License-Identifier: MIT
// Fixed local evidence-kit module. Never a general model-accessible shell tool.
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { HubError } from './errors.mjs';

const MAX_INPUT = 256 * 1024, MAX_OUTPUT = 1024 * 1024;
const fail = () => new HubError('EVIDENCE_PREVIEW_DENIED');

export function createOfflineEvidenceReader({ evidenceSourcePath, scopePath, snapshotPath,
  pythonExecutable = 'python3', timeoutMs = 3000 }) {
  // All values come from trusted operator startup, never request/model fields.
  if (![evidenceSourcePath, scopePath, snapshotPath].every(x => typeof x === 'string' && isAbsolute(x))
    || typeof pythonExecutable !== 'string' || !pythonExecutable
    || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000) throw fail();
  return async () => {
    let file, input;
    try {
      file = await open(snapshotPath, 'r');
      const buffer = Buffer.alloc(MAX_INPUT + 1);
      // read may be short; keep reading until EOF or the hard limit.
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, null);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > MAX_INPUT) throw fail();
      input = buffer.subarray(0, offset);
    } catch { throw fail(); } finally { await file?.close(); }
    return new Promise((resolve, reject) => {
      const child = spawn(pythonExecutable,
        ['-P', '-m', 'radar_evidence.research_preview', '--scope', scopePath], {
          shell: false, stdio: ['pipe', 'pipe', 'pipe'],
          env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8',
            PYTHONPATH: evidenceSourcePath, PYTHONDONTWRITEBYTECODE: '1',
            ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}) }
        });
      let finished = false, outputBytes = 0, errorBytes = 0;
      const chunks = [];
      const complete = (error, value) => {
        if (finished) return;
        finished = true; clearTimeout(timer);
        if (error) { child.kill(); reject(fail()); } else resolve(value);
      };
      const timer = setTimeout(() => complete(true), timeoutMs);
      child.on('error', () => complete(true));
      child.stdin.on('error', () => complete(true));
      child.stdout.on('data', chunk => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_OUTPUT) return complete(true);
        if (!finished) chunks.push(chunk);
      });
      child.stderr.on('data', chunk => {
        // Consume/discard diagnostics; never forward document content or paths.
        errorBytes += chunk.length;
        if (errorBytes > 4096) complete(true);
      });
      child.on('close', code => {
        if (code !== 0) return complete(true);
        try { complete(false, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { complete(true); }
      });
      child.stdin.end(input);
    });
  };
}
