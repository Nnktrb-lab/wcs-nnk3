'use strict';
/* Puzzle generation runs off the main thread so matchmaking / sockets never stall. */
const { parentPort } = require('worker_threads');
const { load } = require('./engine');
const { E, G } = load();

async function make(job) {
  const seed = job.seed || E.randomSeed();
  if (job.mode === 'killer') {
    const want = job.diff;
    const t0 = Date.now();
    let best = null, n = 0;
    while (Date.now() - t0 < 6000 && n < 40) {
      const k = G.generateKiller(n === 0 ? seed : E.randomSeed());
      n++;
      if (!k.solvedLogically) continue;
      // verify uniqueness with cages (server-side validation, never trust generator blindly)
      const chk = E.solve(k.puzzle, { limit: 2, cages: k.killer.cages, nodeLimit: 600000 });
      if (chk.count !== 1 || chk.aborted) continue;
      if (!best) best = k;
      if (k.difficulty === want) { best = k; break; }
    }
    if (!best) throw new Error('killer generation failed');
    return { mode: 'killer', puzzle: best.puzzle, solution: best.solution, cages: best.killer.cages, difficulty: best.difficulty, wanted: want, seed: best.seed, pid: best.id, clues: best.clues };
  }
  /* strict: the graded difficulty must equal the requested one (WCS = Extreme only); tech: the logical solve path must use it. */
  const tries = job.strict || job.tech ? 40 : 1;
  let last = null;
  for (let n = 0; n < tries; n++) {
    const sd = n === 0 ? seed : E.randomSeed();
    const r = await G.generate(job.diff, sd);
    const v = E.solve(r.puzzle, { limit: 2 });
    if (v.count !== 1) continue; // never use a puzzle without exactly one solution
    last = { mode: 'classic', puzzle: r.puzzle, solution: r.solution, cages: null, difficulty: r.difficulty, wanted: job.diff, seed: r.seed, pid: r.id, clues: r.clues, used: Object.keys(r.used || {}) };
    if (job.strict && r.difficulty !== job.diff) continue;
    if (job.tech && !(r.used && r.used[job.tech])) continue;
    return last;
  }
  if (job.strict || !last) throw new Error('no puzzle met the requirements');
  return last;
}

parentPort.on('message', (job) => {
  make(job).then((res) => parentPort.postMessage({ id: job.id, ok: true, res }))
    .catch((e) => parentPort.postMessage({ id: job.id, ok: false, err: String(e && e.message || e) }));
});
