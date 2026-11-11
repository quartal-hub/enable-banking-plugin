# Authentication

The REST API (`/api/*`) and the MCP server (`/mcp`) require an OAuth access token from the Quartal
test Keycloak. MCP clients run the login flow themselves. This document tells how to set up a
client that can log in. Tying bank connections to the logged-in user is a separate, unfinished
step: [user-authentication.md](./user-authentication.md).

## How it works

`qrtl.config.ts` sets the plugin's auth to `custom`:

```ts
auth: {
  mode: "custom",
  issuer: "https://iam2026.test.qrtl.com/auth/realms/quartal",
  scope: "quartal-hub-test",
  audience: "https://hub.test.qrtl.com",
},
```

- A request without a token gets `401` with a `WWW-Authenticate` header that points to the
  protected resource metadata at `/.well-known/oauth-protected-resource`.
- The metadata names the `quartal` realm as the authorization server and `quartal-hub-test` as
  the scope to ask for.
- The plugin accepts a token only if it is signed by that realm (`iss`) and its `aud` includes
  `https://hub.test.qrtl.com`. The `quartal-hub-test` client scope adds that audience.

This config describes the plugin's side only: it does not register any client. Each MCP client
needs a Keycloak client of its own, either pre-registered (below) or created by the MCP client
itself through dynamic client registration.

## Pre-registered client (works)

### 1. Create the client in Keycloak

In the Keycloak admin console, realm `quartal` → **Clients** → **Create client**:

- **Client type:** OpenID Connect. **Client ID:** any, e.g. `<your-name>-test-client`.
- **Capability config:** **Client authentication** Off (a public client, no secret) and
  **Standard flow** On.
- **Valid redirect URIs:** the MCP client's OAuth callback. For MCPJam:
  - `http://127.0.0.1:6274/oauth/callback`
  - `http://localhost:6274/oauth/callback`
- **Web origins:** `+`, which allows the origins of the redirect URIs. MCPJam exchanges the code
  for a token from the browser, so the token endpoint must allow its origin.
- **Client scopes** tab: `quartal-hub-test` assigned as **Default** (or Optional). Without it, the
  token lacks the `https://hub.test.qrtl.com` audience and the plugin answers `401`.

To check the audience: **Client scopes** → **Evaluate**, pick a user and open **Generated access
token**; `aud` must include `https://hub.test.qrtl.com`.

### 2. Connect MCPJam

1. Start MCPJam (`npx @mcpjam/inspector@latest`) and the plugin (`pnpm dev`).
2. Add the server `http://localhost:4321/mcp` (HTTP), or edit it: on its **Config** tab:
   - **Authentication:** OAuth.
   - Registration: **Pre-registered**, **Client ID** the client created above, **Client Secret**
     empty.
   - **Path-scoped authorization server:** Off. Keycloak's issuer is the full realm URL, so the
     strict issuer match passes.
3. **Save & Connect** and log in at Keycloak.

MCPJam opens at `http://127.0.0.1:6274` and calls `/mcp` from the browser. The `astro dev`
server blocks cross-site requests from origins it does not know, so `astro.config.mjs` allows
`localhost` and `127.0.0.1` (dev only). Without that, the log shows
`Blocked cross-origin request to /mcp` and MCPJam cannot connect.

## Dynamic client registration (blocked by realm policies)

The plugin needs no changes for dynamic client registration: its part is pointing clients to the
realm, and MCPJam found the realm's registration endpoint that way. The registration itself is
between the MCP client and Keycloak, which supports it but refuses it under the realm's current
anonymous registration policies. MCP clients use it by default (MCPJam's **Auto** setting picked
it):

- From MCPJam, the browser sends `Origin: http://127.0.0.1:6274`, and Keycloak answers `403`
  `{"error":"Invalid origin"}`. The error response has no CORS headers, so MCPJam only shows
  `Client registration failed: Failed to fetch`.
- The realm's anonymous **Trusted Hosts** policy has **Host sending client registration request
  must match** On. That checks the address the request comes from, which is the user's public IP,
  so it would likely refuse the request even with the origin allowed.

To support it, a realm admin would change the anonymous client registration policies
(**Clients** → **Client registration**): allow the MCP clients' web origins, turn off the sending
host check, trust the hosts of the clients' redirect and client URIs, and allow the
`quartal-hub-test` scope. That lets anyone create clients in the realm, so it is a decision for
the realm's owners. A successful registration has not been seen yet, so another policy may
still refuse it after these changes. Until then, use a pre-registered client.

The realm also advertises Client ID Metadata Documents (CIMD), which needs no registration.
`@quartal/plugin` documents Keycloak bugs with CIMD and scopes; it has not been tried with this
plugin.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `astro dev` logs `Blocked cross-origin request to /mcp` | The MCP client's origin is missing from `security.allowedDomains` in `astro.config.mjs`. |
| `Client registration failed: Failed to fetch` | The MCP client is using dynamic registration. Switch it to the pre-registered client. |
| Keycloak shows `Invalid parameter: redirect_uri` | The client's callback URL is not in **Valid redirect URIs** (check host and port). |
| CORS error at the token step | **Web origins** of the Keycloak client does not include the MCP client's origin. |
| `401` from `/mcp` after logging in | The token's `aud` lacks `https://hub.test.qrtl.com` (scope not assigned) or `iss` is not the realm. |
