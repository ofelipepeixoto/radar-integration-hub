import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HubError } from './errors.mjs';

// Reserva a tentativa ANTES da chamada. Falhas também consomem cota.
// Exclusão mútua local, não um lock distribuído. Crash mantém lock: falha fechada.
export class FileLedger {
  constructor(directory, { maxAttempts = 10, clock = () => new Date() } = {}) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new HubError('INVALID_QUOTA');
    this.directory = directory; this.maxAttempts = maxAttempts; this.clock = clock;
  }
  async reserve(tenantId, requestId) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lock = join(this.directory, 'lock');
    try { await mkdir(lock, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') throw new HubError('LEDGER_BUSY'); throw new HubError('LEDGER_UNAVAILABLE'); }
    try {
      const path = join(this.directory, 'attempts.json');
      let entries = [];
      try { entries = JSON.parse(await readFile(path, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw new HubError('LEDGER_CORRUPT'); }
      if (!Array.isArray(entries) || entries.some(x => typeof x?.tenantId !== 'string' || typeof x?.requestId !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x?.day))) throw new HubError('LEDGER_CORRUPT');
      const day = this.clock().toISOString().slice(0, 10);
      entries = entries.filter(x => x.day === day);
      if (entries.some(x => x.tenantId === tenantId && x.requestId === requestId)) throw new HubError('DUPLICATE_REQUEST');
      if (entries.filter(x => x.tenantId === tenantId).length >= this.maxAttempts) throw new HubError('DAILY_QUOTA_EXCEEDED');
      entries.push({ tenantId, requestId, day });
      await writeFile(join(this.directory, 'attempts.tmp'), JSON.stringify(entries), { mode: 0o600 });
      await rename(join(this.directory, 'attempts.tmp'), path);
    } finally { await rm(lock, { recursive: true, force: true }); }
  }
}
