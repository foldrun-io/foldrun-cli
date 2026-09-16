// A platform that is not there: the routes these commands call, the calls it
// saw, and the real binary spawned against it.
//
// Every remote command's test needs the same three things, and three copies
// of them is how the next route shape change gets fixed in two places and
// missed in the third. One definition, read by all of them.

import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin/foldrun.mjs");

export type Seen = { method: string; url: string; query: URLSearchParams; body: string };

/** An answer with a status other than 200. `__status` and not `status`,
 *  because a run record HAS a status and reading it as the HTTP one turned
 *  every fixture into a 500. */
export const failing = (status: number, body: unknown) => ({ __status: status, body });

export interface Fake {
  url: string;
  seen: Seen[];
  close: () => void;
}

/**
 * Routes are keyed by path, or by `"<METHOD> <path>"` when one path answers
 * two verbs. Anything unrouted is a 404 with the platform's own wording, so
 * a command that probes for a run gets the answer it would really get.
 */
export function serve(routes: Record<string, (body: string, query: URLSearchParams) => unknown>): Promise<Fake> {
  const seen: Seen[] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        const [url, search] = (req.url ?? "").split("?");
        const query = new URLSearchParams(search ?? "");
        seen.push({ method: req.method ?? "", url, query, body });
        const route = routes[`${req.method} ${url}`] ?? routes[url];
        if (!route) {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "run not found" }));
          return;
        }
        const answer = route(body, query) as any;
        const bad = answer && typeof answer === "object" && "__status" in answer;
        res.writeHead(bad ? answer.__status : 200, { "content-type": "application/json" });
        res.end(JSON.stringify(bad ? answer.body : answer));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${port}`,
        seen,
        close: () => {
          server.closeAllConnections();
          server.close();
        },
      });
    });
  });
}

/** The real binary, awaited — never spawnSync, since the fake platform
 *  answers from this very process and a blocked loop never replies. */
export function cli(args: string[], opts: { cwd?: string } = {}): Promise<{ out: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, FOLDRUN_HOME: "/nonexistent/foldrun-home", FOLDRUN_URL: "", FOLDRUN_TOKEN: "", NO_COLOR: "1" },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.stdin.end();
    child.on("close", (code) => resolve({ out, code: code ?? 1 }));
  });
}

/** The same, against a fake platform, with a key it will not check. */
export const at = (url: string, ...args: string[]) => cli([...args, "--url", url, "--token", "k"]);

export const WORKSPACES = { workspaces: [{ name: "blog-desk" }, { name: "rank-desk" }] };
