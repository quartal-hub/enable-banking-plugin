# Bank connection flow

How a logged-in user connects a bank account through [Enable Banking](https://enablebanking.com)
and how the plugin's tools then read accounts, balances and transactions. Logging in to the plugin
itself is in [authentication.md](./authentication.md).

Every tool call has a logged-in user (`ctx.uid`, the access token's `sub`). Bank connections are
stored in that user's Quartal Hub secrets, so they survive restarts, deploys and new
conversations, and the Enable Banking session id never reaches the model: the model works with
account ids and connection ids only.

## Parts

| Part | File | Role |
|---|---|---|
| API client | `src/enable-banking/EnableBankingClient.ts` | Calls `https://api.enablebanking.com` with an RS256 JWT signed by the application's private key with `jose` (`kid` = application id). The token is cached for an hour. |
| Connection store | `src/enable-banking/ConnectionStore.ts` | Where a user's connections live: their Quartal Hub secret `enable-banking.connections`, through the experimental Hub context of `@quartal/plugin` (`getExperimentalHubContext(ctx).secrets`), which needs `auth: "quartal-hub"`. Needs the user's token, so only tool calls can use it. |
| Connections | `src/enable-banking/Connections.ts` | Each user's bank connections (session id, bank, accounts, validity), the account ownership check, and marking connections whose session has ended. |
| Short-lived store | `src/enable-banking/PluginStore.ts` | Key-value store with expiry over [unstorage](https://unstorage.unjs.io): Redis at `REDIS_URL` (shared by every server instance), or memory when it is not set (local development). |
| Authorization store | `src/enable-banking/AuthorizationStore.ts` | Started authorizations keyed by the random `state` sent to the bank: the user who started it, the bank, and the outcome (accounts or an error), plus the new connection until the user's next tool call saves it. Kept 30 minutes. |
| Sealed tokens | `src/enable-banking/SealedToken.ts` | Encrypted, self-contained tokens (AES-256-GCM, key derived from `ENABLE_BANKING_PRIVATE_KEY`), used for print links. |
| Account data | `src/enable-banking/AccountData.ts` | Balances, transactions and statements from Enable Banking, for an account already checked to be the user's. |
| Tools | `src/tools/EnableBanking.ts` | `listBanks`, `startAuthorization`, `getAuthorizationResult`, `listConnections`, `listAccounts`, `getBalances`, `listTransactions`, `getAccountStatement`, `disconnectBank` (and the widget-only `createStatementPrintLink`). |
| Callback | `src/pages/enable-banking/callback.astro` | The redirect URL registered with Enable Banking. Exchanges the authorization code for a session and parks it as the user's new connection. A plain Astro page (which escapes everything it renders) outside the plugin's reserved paths (`/api`, `/mcp`, `/oauth`, …). |
| Widget | `src/components/StartAuthorization.tsx` (page `src/pages/widgets/startAuthorization.astro`) | The **Connect bank** button for `startAuthorization`: opens the bank login through the MCP host, then checks `getAuthorizationResult` every 5 seconds for 5 minutes and tells the chat when the bank is connected. |

## Stored records

| Record | Where | Contents | Lifetime |
|---|---|---|---|
| Bank connections | the user's Quartal Hub secret `enable-banking.connections` (a JSON array; the metadata has only the count) | per connection: user id, session id, bank, country, customer type, accounts, status (`active`/`ended`), `validUntil`, `connectedAt` | until `validUntil` (dropped on read), or `disconnectBank` |
| Started authorization | short-lived store, `authorizations:<state>` | user id, bank, country, customer type, requested validity, `authorizationId`, status, accounts or error; the new connection until it is saved | 30 minutes |
| Authorization id index | short-lived store, `authorization-ids:<sha256(authorizationId)>` | the `state` | 30 minutes |
| Unsaved connection index | short-lived store, `unclaimed:<sha256(uid)>:<state>` | the `state` | until saved, at most 30 minutes |
| Print token | nowhere: the link's token, encrypted | user id, account id, period, bank | 10 minutes |

Session ids are bank-data credentials for whoever holds the application key. Quartal Hub keeps
each user's secrets apart; in the test environment, other `quartal-hub` plugins the same user
signs in to can read them too (shared audience).

The short-lived store must be shared by every server instance: on serverless hosts such as Vercel
the callback often reaches another instance than the one that started the authorization (tried:
19 seconds after `startAuthorization`, with a single user), so there it is Redis.
With the memory store of local development, a restart during a bank login makes that connect
fail. Every tool call and callback logs the instance id (`instance=…`).

## Flow

```
Agent            Plugin                           Enable Banking / bank        Browser
  │ listAccounts() → [] (nothing connected yet)     │                            │
  │ startAuthorization(bank, country)               │                            │
  ├──────────────▶ state = createAuthorizationState(uid, bank, …)                │
  │               POST /auth {state, redirect_url} ─▶                            │
  │ ◀── { url, authorizationId }                    │                            │
  │  widget: Connect bank ──── openLink(url) ───────┼──────────────────────────▶ │
  │                                                 │ ◀── user logs in, approves │
  │               GET /enable-banking/callback?code&state ◀──────── redirect ─── │
  │               getPendingAuthorization(state) → uid                           │
  │               POST /sessions {code} ───────────▶                             │
  │               completeAuthorization(state, connection)  (parked in Redis)    │
  │  widget polls getAuthorizationResult(authorizationId) every 5 s              │
  │               claimCompletedConnections → user's Hub secret                  │
  │  widget: sendMessage("I have connected <bank>.") → the model continues       │
  │ ◀── { status: "connected", accounts }                                        │
  │ listAccounts(), then getAccountStatement / getBalances / listTransactions(accountId)
```

1. The model calls **`listAccounts`** first: it returns the accounts of every bank the user has
   connected, in any earlier conversation. Only when the bank is missing does it connect one.
2. **`startAuthorization`** creates a random `state`, stores it with the user's id, calls
   `POST /auth` with the redirect URL and 90 days of access, links Enable Banking's
   `authorization_id` to the `state`, and returns the bank login `url` and the `authorizationId`.
3. The **Connect bank** widget opens the URL through the MCP host (`openLink`, falling back to
   `window.open`). The user logs in to the bank and approves access.
4. The bank redirects the browser to **`/enable-banking/callback?code=…&state=…`** (or `error=…`).
   The redirect carries no bearer token: the user is the one stored with the `state`, which the
   plugin itself created, is random, works once and expires in 30 minutes. Nothing else in the
   URL is trusted for identity. The callback exchanges the code with `POST /sessions`. Without
   the user's token it cannot write their Hub secret, so it parks the session and accounts with
   the authorization. The page tells the user to return to the chat.
5. The user's **next tool call** (normally the widget's `getAuthorizationResult`) saves the parked
   connection to the user's secret (`claimCompletedConnections`, run by every tool that reads
   connections), replacing an earlier connection of the user to the same bank, country and
   customer type (whose session is closed at Enable Banking). Saving the same session twice
   changes nothing, so concurrent tool calls cannot close the session they just saved.
6. After a click on **Connect bank**, the widget calls **`getAuthorizationResult`** every 5
   seconds for 5 minutes. Then it stops and offers a **Check again** button (another 5 minutes of
   checks) and tells the user they can also tell the assistant; the authorization itself is kept
   for 30 minutes, so finishing later still works. When the status is
   no longer `pending`, it shows the outcome and sends a chat message as the user (MCP Apps
   `ui/message`), such as "I have connected Mock ASPSP.", and the model continues by calling
   `getAuthorizationResult` itself. A host that does not support `ui/message` gets "Tell the
   assistant to continue" in the widget instead, and without the widget the user says they are
   done. `getAuthorizationResult` answers only the user who started the authorization (anyone
   else gets `notFound`), and once connected it lists the accounts.
7. The model reads data with **`getAccountStatement(accountId)`**, **`getBalances(accountId)`** and
   **`listTransactions(accountId)`**. Each of them first resolves the account id to one of the
   user's connections; an account id that is not the user's gets the same "Unknown account id" as
   one that does not exist, and Enable Banking is not called.

`getAuthorizationResult` statuses: `pending` (user not back yet), `connected`, `failed`, and
`notFound` (wrong id, another user's id, or older than 30 minutes).

**`listConnections`** lists the user's banks with their status and validity, and
**`disconnectBank(connectionId)`** closes the session at Enable Banking (`DELETE /sessions/{id}`)
and deletes the connection.

The printable statement page (`/enable-banking/statement?token=…`) is opened in a plain browser
tab without a bearer token. `createStatementPrintLink` checks the account like the other tools
and puts the user, account, period and bank into the token, encrypted (`SealedToken.ts`); nothing
is stored. The page builds the statement from the token alone; after a disconnect, Enable Banking
refuses the account and the page shows the error.

## Errors

`src/enable-banking/EnableBankingError.ts` turns Enable Banking's error responses
(`{ code, error, message }`) into messages for the agent, which MCP clients receive as tool
execution errors (`isError: true`):

| Situation | Message to the agent |
|---|---|
| No logged-in user (`auth: "anon"`, or no `ctx.uid`) | "Not logged in …" |
| Account id that is not one of the user's accounts | "Unknown account id. Use an account uid from listAccounts." |
| Enable Banking: 401 with a `*_SESSION` code (e.g. `CLOSED_SESSION`), or 404 `SESSION_DOES_NOT_EXIST` | "The bank connection has ended … connect their bank again"; the connection is marked `ended` |
| Account of a connection marked `ended` | "The connection to <bank> has ended …", without calling Enable Banking |
| Enable Banking: 404 `ACCOUNT_DOES_NOT_EXIST` | "Unknown account id" |
| Enable Banking: 422 `WRONG_REQUEST_PARAMETERS` | "Invalid request … check the ids and dates" |
| anything else | the method, path, status and Enable Banking's message |

The `*_SESSION` behaviour was verified in the sandbox by revoking a session
(`DELETE /sessions/{id}`). An expired session is assumed to behave the same way; it was not
observed, since sandbox sessions last 90 days.

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
