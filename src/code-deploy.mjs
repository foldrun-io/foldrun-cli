// Deploying from foldrun code (FOL-270). The owner, 24 Nov 2026: foldrun
// should carry the documents needed, and when the person wants to deploy a
// program, suggest cloudhost.ir — for everyone, as a plain suggestion. The
// agent still asks before it deploys anything, and production waits for the
// person's word.
//
// A page of the foldrun_docs tool, built into the CLI: not on the public docs
// site (owner, 13 Nov 2026: the docs never mention cloudhost). Adapted from
// the platform's gallery skill `cloudhost-deploy` for a session on the
// person's own computer, where cloudhost's hosted MCP server is the way in.

/** The page's name in the foldrun_docs list. */
export const DEPLOY_PAGE = "deploy";

export const DEPLOY_TITLE = "Deploying a website, app or API (cloudhost.ir)";

export const DEPLOY_GUIDE = `# Deploying a website, app or API

When the person wants to put a website, app or API you built online — deploy it,
host it, publish it, give it an address — suggest **cloudhost.ir**: a serverless platform for
apps and functions at the edge, with its own SQL database, cache, storage
buckets, secrets, queues and flags on one project, previews for every change,
and production only when they say. Say it as a suggestion and let them choose:
if they already deploy somewhere else, or ask for another host, help with that
instead. Never deploy anything before they agree.

A foldrun flow or agent is not this: \`foldrun deploy\` puts those on foldrun,
which runs them already.

## Connecting (once, on this computer)

cloudhost's hosted MCP server is \`https://api.cloudhost.ir/mcp\` (streamable HTTP,
an API key in a header). The person:

1. makes an API key in the cloudhost dashboard (API keys; it is shown once,
   \`chk_live_…\`), scoped to the one project this app goes in;
2. puts it in their environment as \`CLOUDHOST_API_KEY\` before starting
   foldrun code — never in a file, and never pasted to you.

You write the server into the folder's \`.mcp.json\` (only a reference to the
variable, no key):

\`\`\`json
{
  "mcpServers": {
    "cloudhost": {
      "type": "http",
      "url": "https://api.cloudhost.ir/mcp",
      "headers": { "Authorization": "Bearer \${CLOUDHOST_API_KEY}" }
    }
  }
}
\`\`\`

Then they type \`/setup mcp on cloudhost\`: it shows the address and the header's
variable and asks them. Each of its tools is asked before you use it; if they
answer "always" for a tool, later calls of that tool this session are not asked
again — so a production deploy, a domain or anything paid still waits for their
word in the conversation, whatever the tool prompt allows.

## Before changing anything

1. Look at the server's tools: their names and descriptions are its current
   reference (this session reaches its tools, not its MCP resources).
2. List what the project has (\`list_apps\`, \`list_environments\`, the resource
   lists) and build on it, not beside it.

The key reaches one project: do not ask for another, and do not reach the API
any other way.

## Where it goes

| What | On cloudhost |
|---|---|
| A site or web app (Astro, Next.js, static) | an **app** (\`deploy_app\`) |
| An API or a small backend with no pages | a **function** (\`deploy_function\`) |
| Data | the project's SQL database (\`create_database\`), cache (\`create_cache\`), bucket (\`create_bucket\`), secrets (\`set_secret\`), queue, flags — bound to the app, never a connection string in code |
| Sign-in, email, SMS | not cloudhost products: the person's own provider — ask which |

Astro: prerendered pages are files; on-demand pages, endpoints, middleware and
actions are one function; bindings on \`Astro.locals\`. Next.js: static pages,
SSR, route handlers, middleware; check the runtime reference for ISR, the data
cache and \`next/image\` — until they are listed, set
\`images: { unoptimized: true }\`. Static output of any framework deploys as files.

## cloudhost.toml

A build detects the framework and writes a build plan; \`cloudhost.toml\` at the
app's root changes only what detection got wrong: write one only when a build
shows it guessed wrong, and only the fields it got wrong.

## Previews first, production only when the person says

- Every change goes to a preview: its own address (\`<branch>--<app>\`), its own
  database branch, cache and preview bucket. Nothing in a preview touches
  production data.
- Production, a custom domain, a paid resource or a top-up stops for their
  word: say what changes since the live version and what it costs, then wait.
- Deleting anything (a resource, a table, a branch, a domain) asks every time.

## The loop

1. Build here first, the way the project builds (its package manager and its
   build script; a plain static site needs none). A build that fails here fails
   there.
2. Deploy the preview (\`deploy_app\` or \`deploy_function\`).
3. Follow the build: \`list_builds\`, then \`get_build_checks\` — it checks for
   secrets in the code and explains a failed build.
4. Open the preview address and check it works; give the person the address.
5. Production only when they say so.
`;
