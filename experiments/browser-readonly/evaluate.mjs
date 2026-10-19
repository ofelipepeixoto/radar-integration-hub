import { startFixtures, CASES } from './fixtures.mjs';
import { capture } from './capture.mjs';
if (process.argv.length !== 2) throw new Error('This fixture-only experiment accepts no CLI arguments');
const lab = await startFixtures();
const results = [];
try {
  for (let repetition = 0; repetition < 3; repetition++) {
    // Alternate method order; this is a tiny synthetic functional comparison, not capacity proof.
    for (const mode of repetition % 2 ? ['browser', 'http'] : ['http', 'browser']) {
      for (const row of CASES) {
        const { text, receipt } = await capture({ sourceId: row.id, mode }, lab);
        results.push({ repetition, ...receipt, correct: receipt.outcome === row[mode]
          && text === (row[mode] === 'captured' ? row.expected : null),
          recovered_available_evidence: row.expected !== null && text === row.expected });
      }
    }
  }
  const summary = Object.fromEntries(['http', 'browser'].map(mode => {
    const rows = results.filter(row => row.mode === mode);
    const times = rows.map(row => row.elapsed_ms).sort((a, b) => a - b);
    return [mode, { runs: rows.length, contract_passes: rows.filter(row => row.correct).length,
      evidence_recovered: rows.filter(row => row.recovered_available_evidence).length,
      evidence_opportunities: CASES.filter(row => row.expected !== null).length * 3,
      median_ms: Math.round(((times[5] + times[6]) / 2) * 100) / 100 }];
  }));
  console.log(JSON.stringify({ schema: 'radar.synthetic-study.v1', node: process.version,
    platform: process.platform, measured_at: new Date().toISOString(), repetitions: 3,
    decision: 'STUDY: HTTP first; browser only a candidate for JS-only sources after additional gates',
    limitations: ['four synthetic cases; no held-out corpus', 'no LLM, public site, user session or production job',
      'no OS sandbox/egress isolation demonstrated', 'latencies are local measurements, not SLOs'],
    summary, results }, null, 2));
  if (results.some(row => !row.correct)) process.exitCode = 1;
} finally { await lab.close(); }
