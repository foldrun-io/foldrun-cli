---
title: OAuth support
description: Every kind of OAuth, and what foldrun does about it — when an agent connects to a provider, and when an AI app signs in to foldrun.
---

<!-- Generated from foldrun-core/src/oauth-capabilities.ts by
     `node scripts/oauth-doc.mjs` in foldrun-core. Edit the list, not this page. -->

# OAuth support

foldrun meets OAuth in two roles:

- **As a client.** An agent reaches Google, Slack, Notion or a bank. You
  connect the account once ([connected accounts](secrets#connected-accounts)),
  and foldrun holds the token and refreshes it.
- **As an authorization server.** An AI app such as claude.ai signs in to
  foldrun's MCP endpoint ([MCP](mcp)), and foldrun issues the token.

Each row that says *Supported* is proven by tests that run against a real
authorization server (Keycloak) and against recorded provider answers.

## When an agent connects to a provider

| What | Spec | Status | How, or why not |
|---|---|---|---|
| Authorization code with PKCE (S256) | RFC 6749 §4.1, RFC 7636 | Supported | Settings → Connections or `foldrun connect`. PKCE is on for every connection. |
| Refresh, and refresh-token rotation | RFC 6749 §6, RFC 9700 §2.2.2 | Supported | Refreshed before every use; a rotated refresh token replaces the stored one. |
| Client credentials (machine to machine) | RFC 6749 §4.4 | Supported | The "OAuth — client credentials" connection, or `foldrun secrets set NAME --kind m2m`. |
| Client secret in the form body | RFC 6749 §2.3.1 | Supported | The default (`token_auth: client_secret_post`). |
| Client secret as HTTP Basic | RFC 6749 §2.3.1 | Supported | `token_auth: client_secret_basic`, or `--token-auth basic`. Notion, Spotify, Reddit and Zoom need it. |
| Public app (no secret), PKCE only | RFC 9700 §2.1.1 | Supported | Leave the client secret empty. |
| Metadata discovery from an issuer | RFC 8414, OpenID Connect Discovery | Supported | The Issuer field's Discover, or `--issuer`. |
| Issuer in the authorization response (mix-up defence) | RFC 9207 | Supported | With an issuer, the `iss` that comes back must be it. |
| Revocation when a connection ends | RFC 7009 | Supported | Deleting a connection, or reconnecting it with another app, revokes the old grant. |
| Pushed authorization requests | RFC 9126 | Supported | Used whenever the provider has a PAR endpoint. |
| Token responses as providers send them | RFC 6749 §5.1 | Supported | JSON or form-encoded, `expires_in` as a string, Slack's `authed_user`. |
| JWT bearer grant (service accounts) | RFC 7523 §2.1 | Supported | The service-account connection (`--kind service-account`). |
| Rich authorization requests | RFC 9396 | Supported | `authorization_details` as an extra authorize parameter (a JSON value). |
| Signed client assertion (private_key_jwt) | RFC 7523 §2.2 | Supported | `token_auth: private_key_jwt` with a key you paste or foldrun makes; a certificate adds Entra's thumbprint. `--token-auth jwt`. |
| Device authorization | RFC 8628 | Supported | Connect with a code on any device: the Connections form, or `foldrun connect --device`. PKCE is sent with the device grant. |
| Token exchange | RFC 8693 | Planned | Part I: a `token-exchange` secret kind. Cloud STS is covered today by the keyless identity kind. |
| DPoP sender-constrained tokens | RFC 9449 | Planned | Part H: Bluesky/atproto, Okta DPoP. |
| Mutual-TLS client auth and bound tokens | RFC 8705 | Planned | Part H: the client-cert secret at the token endpoint. |
| Client-initiated backchannel authentication | OpenID CIBA | Not needed | No provider an agent needs uses it. |

## When an AI app signs in to foldrun (`/api/mcp`)

| What | Spec | Status | How, or why not |
|---|---|---|---|
| Authorization code with PKCE (S256) | OAuth 2.1, MCP authorization | Supported | How claude.ai and other AI apps sign in to /api/mcp. |
| Refresh rotation, reuse revokes | OAuth 2.1 §4.3.1 | Supported | A refresh token used twice ends the connection. |
| Client secret (Basic or body), or a public app | RFC 6749 §2.3.1 | Supported | Registered apps choose `none`, `client_secret_post` or `client_secret_basic`. |
| Authorization server and resource metadata | RFC 8414, RFC 9728 | Supported | `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`. |
| Dynamic registration and client metadata documents | RFC 7591, CIMD | Supported | An app registers itself, or names itself by an https URL. |
| Resource indicators | RFC 8707 | Supported | Tokens are bound to /api/mcp. |
| Issuer in the authorization response | RFC 9207 | Supported | Every answer carries `iss`. |
| Revocation endpoint | RFC 7009 | Supported | `POST /api/mcp/oauth/revoke`: an app ends its own connection. |
| Client credentials for machine clients | RFC 6749 §4.4 | Supported | An admin registers a machine client (Settings, or `foldrun mcp clients add`) with a role, workspaces and access; no refresh token; disconnecting it makes it `invalid_client`. |
| Signed client assertion (private_key_jwt) | RFC 7523 §2.2 | Supported | Apps that register `jwks` or `jwks_uri` sign in with assertions; each `jti` is used once. |

## Refused on purpose

These are refused, and the error says why. They are never quietly ignored.

| What | Spec | Status | How, or why not |
|---|---|---|---|
| Implicit grant | RFC 9700 §2.1.2 | Refused | Tokens in the browser's URL leak; OAuth 2.1 removes it. |
| Resource owner password grant | RFC 9700 §2.4 | Refused | foldrun never holds a person's password for another service. |
| PKCE `plain` | RFC 9700 §2.1.1 | Refused | Only S256 is accepted: `plain` protects nothing if the request is seen. |
| Wildcard or prefix redirect matching | RFC 9700 §4.1 | Refused | Redirect URIs match exactly (a loopback port may vary). |
