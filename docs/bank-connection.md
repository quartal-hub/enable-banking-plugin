# Bank connection flow

How a user connects a bank account through [Enable Banking](https://enablebanking.com) and how
the plugin's tools then read accounts, balances and transactions. This describes the current,
**anonymous** implementation (`auth: "anon"` in `qrtl.config.ts`); per-user authentication is
planned.

## Parts

| Part | File | Role |
|---|---|---|
| API client | `src/enable-banking/EnableBankingClient.ts` | Calls `https://api.enablebanking.com` with an RS256 JWT signed by the application's private key with `jose` (`kid` = application id). The token is cached for an hour. |
| Authorization store | `src/enable-banking/AuthorizationStore.ts` | Started authorizations keyed by the random `state` sent to the bank, and their outcome (session id and accounts, or an error). In memory, kept 30 minutes. |
| Tools | `src/tools/EnableBanking.ts` | `listBanks`, `startAuthorization`, `getAuthorizationResult`, `listAccounts`, `getAccountStatement`. |
| Callback | `src/pages/enable-banking/callback.astro` | The redirect URL registered with Enable Banking. Exchanges the authorization code for a session and stores the outcome. A plain Astro page (which escapes everything it renders) outside the plugin's reserved paths (`/api`, `/mcp`, `/oauth`, …). |
| Widget | `src/components/StartAuthorization.tsx` (page `src/pages/widgets/startAuthorization.astro`) | The **Connect bank** button for `startAuthorization`: opens the bank login through the MCP host. |

## Flow

```
Agent            Plugin                           Enable Banking / bank        Browser
  │ startAuthorization(bank, country)               │                            │
  ├──────────────▶ state = createAuthorizationState │                            │
  │               POST /auth {state, redirect_url} ─▶                            │
  │ ◀── { url, authorizationId }                    │                            │
  │  widget: Connect bank ──── openLink(url) ───────┼──────────────────────────▶ │
  │                                                 │ ◀── user logs in, approves │
  │               GET /enable-banking/callback?code&state ◀──────── redirect ─── │
  │               getPendingAuthorization(state)                                 │
  │               POST /sessions {code} ───────────▶                             │
  │               completeAuthorization(state, sessionId, accounts)              │
  │  user: "done" → getAuthorizationResult(authorizationId)                      │
  │ ◀── { status: "connected", sessionId, accounts }                             │
  │ listAccounts(sessionId), then getAccountStatement(accountId)
```

1. **`startAuthorization`** creates a random `state`, calls `POST /auth` with the redirect URL and
   90 days of access, links Enable Banking's `authorization_id` to the `state`, and returns the
   bank login `url` and the `authorizationId`.
2. The **Connect bank** widget opens the URL through the MCP host (`openLink`, falling back to
   `window.open`). The user logs in to the bank and approves access.
3. The bank redirects the browser to **`/enable-banking/callback?code=…&state=…`** (or `error=…`).
   The callback accepts only a pending, unexpired `state` (so each callback URL works once),
   exchanges the code with `POST /sessions`, and stores the session id and accounts, or the error,
   under that `state`. The page tells the user to return to the chat; it does not show the
   session id.
4. The user comes back to the chat and says they are done. The model calls
   **`getAuthorizationResult`** with the `authorizationId`; once the status is `connected`, the
   result has the session id and the accounts.
5. The model reads data with **`listAccounts(sessionId)`**, then **`getAccountStatement(accountId)`**
   with the account ids it returned.

`getAuthorizationResult` statuses: `pending` (user not back yet), `connected`, `failed`, and
`notFound` (wrong id, or older than 30 minutes).

## Errors

`src/enable-banking/EnableBankingError.ts` turns Enable Banking's error responses
(`{ code, error, message }`) into messages for the agent, which MCP clients receive as tool
execution errors (`isError: true`):

| Enable Banking | Message to the agent |
|---|---|
| 401 with a `*_SESSION` code (e.g. `CLOSED_SESSION`) on account calls | "The bank connection has ended … connect their bank again" |
| Session status other than `AUTHORIZED` (e.g. `CLOSED`) in `listAccounts`: a closed session still answers `GET /sessions/{id}` | the same |
| 404 `SESSION_DOES_NOT_EXIST` / `ACCOUNT_DOES_NOT_EXIST` | "Unknown session id" / "Unknown account id" |
| 422 `WRONG_REQUEST_PARAMETERS` | "Invalid request … check the ids and dates" |
| anything else | the method, path, status and Enable Banking's message |

Verified in the sandbox by revoking a session (`DELETE /sessions/{id}`). An expired session is
assumed to behave the same way (another non-`AUTHORIZED` status, another `*_SESSION` code); it was
not observed, since sandbox sessions last 90 days.

## Setup, sandbox data and limitations

See the [README](../README.md): [Setup](../README.md#setup) for the environment variables,
[Sandbox test data](../README.md#sandbox-test-data) and [Limitations](../README.md#limitations).

## Framework workarounds

### `notFound` instead of `unknown` in `getAuthorizationResult`

**Bug:** `@quartal/plugin` 1.0.0 analyzes string literal types without their quotes, so a literal
value spelled like a TypeScript keyword (`"unknown"`, `"string"`, `"null"`, `"object"`, …) is read
as a type. With `status: "pending" | "connected" | "failed" | "unknown"`, the generated MCP output
schema for `status` was an unsatisfiable `oneOf` of empty schemas, and MCP clients rejected every
result of `getAuthorizationResult`:

```
Tool "getAuthorizationResult" structured content does not match its output schema:
data/status must match exactly one schema in oneOf.
```

**Workaround:** the status value is `"notFound"`, which is not a keyword
(`src/tools/model/BankingModel.ts`, `src/enable-banking/AuthorizationStore.ts`). The same rule
applies to any new tool type until the fix is released: no string literal values spelled like
TypeScript keywords, and no unions of named types (`Cat | Dog`), which the same bug turns into a
string enum.

**Fix:** keeping string literals quoted in the analyzer, on the `@quartal/plugin` branch
`fix/string-literal-union-keywords` (documented in that repository's
`docs/string-literal-union-fix.md`). It is in the first `@quartal/plugin` release after 1.0.0 that
includes that fix.

**Removing the workaround after that release:**

1. Upgrade `@quartal/plugin` (`pnpm up @quartal/plugin`) and run `pnpm typecheck` and `pnpm build`.
2. Delete the comment above `status` in `src/tools/model/BankingModel.ts`, and this section.
3. Optional: rename `notFound` back to `unknown` in `src/tools/model/BankingModel.ts`,
   `src/enable-banking/AuthorizationStore.ts` and this document. `notFound` is a good name too, so
   keeping it is fine.
4. If you renamed it, check the generated schema with `pnpm dev`:
   `curl -s http://localhost:4321/mcp/tools.json` must show `getAuthorizationResult`'s
   `outputSchema.properties.status` as an `enum` (`["pending", "connected", "failed", "unknown", null]`),
   not a `oneOf`. Then reconnect the server in the MCP client, since clients cache output schemas.
