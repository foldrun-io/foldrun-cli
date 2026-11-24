// FOL-273: loaded with --import into a foldrun code session under test.
// Counts every module the process loads and, as it exits, writes that
// count and its memory to $FOLDRUN_WEIGHT_OUT — what the ceiling test reads.
import fs from "node:fs";
import module from "node:module";

const seen = new Set();
module.registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context);
    seen.add(r.url);
    return r;
  },
});
process.on("exit", () => {
  const m = process.memoryUsage();
  const urls = [...seen];
  fs.writeFileSync(process.env.FOLDRUN_WEIGHT_OUT, JSON.stringify({
    modules: urls.length,
    builtin: urls.filter((u) => u.startsWith("node:")).length,
    rssMb: Math.round(m.rss / 1048576),
    heapMb: Math.round(m.heapUsed / 1048576),
    urls,
  }));
});
