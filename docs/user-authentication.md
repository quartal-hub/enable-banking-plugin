# Plan: per-user authentication

> **Implemented.** The current flow is described in [bank-connection.md](./bank-connection.md).
> This plan is kept for its reasoning. Where the implementation differs:
>
> - **Store:** instead of a `ConnectionStore` with one method per record, a small key-value
>   `PluginStore` with expiry (`src/enable-banking/PluginStore.ts`) over
>   [unstorage](https://unstorage.unjs.io), with the record logic in `AuthorizationStore.ts`,
>   `Connections.ts` and `PrintLinks.ts`. The backend is unstorage's `fs` driver (files under
>   `.data/`); another driver (Redis, Cloudflare KV, …) is a one-line change in
>   `getPluginStore()` once the hosting target is chosen.
> - **No encryption at rest:** session ids are stored as they are; the store must stay private to
>   the plugin.
> - **Connection ids:** connections get a random `connectionId` of their own, used by
>   `listConnections`, `disconnectBank` and an optional filter of `listAccounts`.
> - **Reconnecting** to the same bank, country and customer type replaces the earlier connection
>   and closes its session at Enable Banking, so accounts are not listed twice.
> - **Ended sessions** are kept as `status: "ended"` connections (shown by `listConnections`,
>   left out of `listAccounts`) until their validity runs out or the user disconnects.
> - **Auth mode** stays `custom` with the Quartal test Keycloak ([authentication.md](./authentication.md)),
>   not `quartal-hub`.
> - **Testing:** the two-user, restart and ended-session cases are unit tests
>   (`test/userConnections.test.ts`); an end-to-end run with two Keycloak users is still to do.

How to replace the anonymous bank connection flow with one where every request has an
authenticated user, bank sessions are stored per user on the server, and the session id never
reaches the model. Also lists what code can then be removed.

## Goal

- Every tool call is made by a known user.
- A user's bank connections are stored server-side under that user and survive restarts and new
  conversations: "what's my balance?" works without any id.
- A user can only read their own accounts.
- The model never sees a session id.

## 1. Turn on plugin authentication

In `qrtl.config.ts`:

```ts
export default defineQrtlConfig({
  auth: "quartal-hub", // or "custom" with OAUTH_* variables for another OAuth2/OIDC server
  deploy: { org: "<org>", app: "enable-banking-plugin" },
});
```

The framework then requires a JWT bearer token on `/api/*` and `/mcp`, MCP clients run the login
flow automatically, and every tool method receives a `QuartalPluginContext` as its second
parameter (`ctx.uid`, `ctx.email`, `ctx.orgs`, …). Widget pages, the docs site and our own Astro
routes (the callback) stay public. Note the framework docs mark OAuth as experimental.

## 2. Store connections per user

Add a persistent store with two record types:

| Record | Key | Contents | Lifetime |
|---|---|---|---|
| Pending authorization | `state` | `uid`, bank, `authorizationId`, status, error | 30 minutes |
| Bank connection | `uid` + `sessionId` | bank, country, accounts (uid, name, IBAN, type, currency), `validUntil`, created | until `validUntil` or disconnect |
| Print token | token | account id and period of a printable statement | 10 minutes |

Behind a small interface (`ConnectionStore`) so the backend can follow the hosting target:
Cloudflare KV or D1, Upstash Redis on Vercel, Postgres or Redis on Railway. Pending
authorizations and print tokens need a TTL; connections need a lookup by user. The store is
provisioned with each deployment.

Treat session ids as secrets: they are bank-data credentials for whoever holds the application
key. Encrypt them at rest if the store is shared with anything else.

## 3. Bind the callback to the user

The callback is a browser redirect from the bank, so it carries no bearer token; the user is
identified through `state` instead:

1. `startAuthorization(input, ctx)` stores the pending authorization with `ctx.uid`.
2. The callback looks up the pending record by `state`, exchanges the code, and saves the
   connection under that record's `uid`.

`state` is random, single-use and short-lived, which is what makes this safe. Nothing in the
callback URL is trusted for identity except the `state` the plugin itself created.

## 4. Change the tools

| Tool | Now | With authentication |
|---|---|---|
| `listBanks` | as is | as is (still requires login) |
| `startAuthorization` | stores `state` | stores `state` + `ctx.uid` |
| `getAuthorizationResult` | returns status, session id and accounts | returns status and accounts only; only for the user who started it |
| **`listConnections`** (new) | — | the user's connected banks and their validity |
| `listAccounts` | `{ sessionId }` | no input: accounts across all of the user's connections |
| `getBalances` / `listTransactions` / `getAccountStatement` | `{ accountId, … }`, unchecked | same input, but the account must belong to one of the user's connections (otherwise "not found") |
| `createStatementPrintLink` | `{ accountId, … }`, unchecked | the same ownership check before the token is created; the print page accepts only tokens the plugin created |
| **`disconnectBank`** (new) | — | `DELETE /sessions/{id}` at Enable Banking and remove the stored connection |

The account ownership check in every tool that takes an `accountId` is essential: account ids are
plain UUIDs, and without the check any logged-in user could read any account the plugin has a
session for. Resolve the account id to the user's connection first, then call Enable Banking.

Expired or revoked sessions: when Enable Banking answers 401/403 for a stored session, mark the
connection expired and tell the model to ask the user to reconnect.

## 5. What can be removed

| Code | Why it goes |
|---|---|
| `sessionId` input of `listAccounts` (`src/tools/EnableBanking.ts`) | Sessions are looked up by `ctx.uid`. |
| `sessionId` in `AuthorizationResult` (`src/tools/model/BankingModel.ts`) and in `findAuthorizationResult()` | The model never needs it. |
| The in-memory LRU caches and their `globalThis` workarounds in `src/enable-banking/AuthorizationStore.ts` and `src/enable-banking/PrintLinks.ts` | Replaced by the persistent `ConnectionStore`, so pending authorizations and print links also work across restarts and instances; the modules become thin wrappers over it, or go entirely. |
| The Limitations section of the README | Solved; remove those items and update `bank-connection.md` to describe the authenticated flow. |
| Session-id wording in tool descriptions ("Session id shown after connecting a bank", "gives the session id for `listAccounts`") | The model never handles session ids. |

What stays: `EnableBankingClient.ts`, the callback route (now saving per user), the widget's
**Connect bank** button, `getAuthorizationResult` (status only), the
`listBanks`/`getBalances`/`listTransactions` mappings, and `toAccount.ts`.

## Testing

- Two different users: user B must not see user A's connections, and `getBalances`,
  `getAccountStatement` and `createStatementPrintLink` with one of user A's account ids must fail
  for user B.
- Restart the server between connecting and reading: connections must survive.
- A new conversation: "what's my balance?" must work without any id.
- An expired or revoked session: the model must get a clear "reconnect" message.
