// Copyright (c) 2026 Carlos Felipe. SPDX-License-Identifier: MIT
// Preflight for the operator/CI checkout, not authentication of an issuer.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, isAbsolute } from 'node:path';

try {
  const pin = JSON.parse(readFileSync(new URL('../research-dependencies.json', import.meta.url), 'utf8'));
  const source = process.env.RADAR_EVIDENCE_KIT_PATH;
  if (typeof source !== 'string' || !isAbsolute(source)
    || !/^[a-f0-9]{40}$/.test(pin.commit)) throw new Error();
  const root = resolve(source, '..');
  const git = args => execFileSync('git', ['-C', root, ...args],
    { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git(['rev-parse', '--show-toplevel']) !== root
    || git(['rev-parse', 'HEAD']) !== pin.commit
    || git(['status', '--porcelain', '--untracked-files=no'])) throw new Error();
  console.log(`EVIDENCE_KIT_PIN_VERIFIED ${pin.commit}`);
} catch {
  console.error('EVIDENCE_KIT_PIN_MISMATCH');
  process.exitCode = 1;
}
