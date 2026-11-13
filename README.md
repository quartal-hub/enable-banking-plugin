# Enable Banking Plugin

Bank account information for AI agents through [Enable Banking](https://enablebanking.com): an
agent connects the user's bank account and reads accounts, balances and transactions. Users log in
at the Quartal test Keycloak ([docs/authentication.md](docs/authentication.md)), and each user's
bank connections are kept on the server under their own login, across conversations. Built with
[Quartal Plugins](https://plugin.quartal.com), so the same tools are served over MCP (with an MCP
Apps widget) and as a REST API.

> **Status: sandbox prototype.** Tested against Enable Banking's sandbox only. See
> [Limitations](#limitations).

## Tools

| Tool | REST | What it does |
|---|---|---|
| `listBanks` | `GET /api/enable-banking/banks?country=FI` | Banks (ASPSPs) available in a country. |
| `startAuthorization` | `POST /api/enable-banking/start-authorization` | Starts connecting a bank: returns the bank login URL and an `authorizationId`. Has the **Connect bank** widget. |
| `getAuthorizationResult` | `GET /api/enable-banking/authorization-result?authorizationId=…` | Whether the user has finished at the bank (`pending`, `connected`, `failed`, `notFound`); once connected, the accounts. |
| `listConnections` | `GET /api/enable-banking/connections` | The user's connected banks: status (`active`, `ended`), validity, number of accounts. |
| `listAccounts` | `GET /api/enable-banking/accounts` | Accounts of all the user's connected banks (optionally one `connectionId`): bank, name, IBAN, type (`CACC`, `CARD`, …), currency. |
| `getBalances` | `GET /api/enable-banking/balances?accountId=…` | Balances of an account (e.g. available `ITAV`, closing booked `CLBD`). |
| `listTransactions` | `GET /api/enable-banking/transactions?accountId=…` | Transactions of an account, newest first: signed amounts (negative for money out), counterparty, description. Optional `dateFrom`/`dateTo`; pages with `continuationKey`. |
| `getAccountStatement` | `GET /api/enable-banking/account-statement?accountId=…&dateFrom=…&dateTo=…` | **Account statement (tiliote)** for a period (default: the previous calendar month): opening and closing balance, every booked transaction with the running balance, money in and out, pending transactions separately. Has the **Account statement** widget. |
| `disconnectBank` | `POST /api/enable-banking/disconnect-bank` | Ends the plugin's access to a bank at Enable Banking and forgets the connection. |

Every tool needs a logged-in user and works only on that user's own connections: an account id
from another user's bank is "unknown". All tools except `startAuthorization` and `disconnectBank`
(destructive) are read-only and marked so for MCP hosts. How connecting a bank works, step by
step, what is stored, and the error messages the agent gets:
[docs/bank-connection.md](docs/bank-connection.md).

### Account statement

Banks report only the *current* balance, so the statement's balances are calculated backwards:
the closing balance is the current booked balance (`CLBD`/`ITBD`, falling back to an available
balance) minus the transactions booked after the period, and the opening balance is the closing
balance minus the period's transactions. This is exact when the bank returns every booked
transaction since the period start; the statement's `notes` say which balance it was calculated
from and warn when not all transaction pages could be fetched. A period reaching past the balance
date ends at that date. The calculation is in `src/enable-banking/buildAccountStatement.ts`.

The widget shows the statement as a document (English labels). MCP hosts run widgets in a
sandboxed iframe that blocks the print dialog, so its **Print / save as PDF** button calls the
widget-only tool `createStatementPrintLink` (`@visibility app`) and opens the returned link in a
browser tab: `/enable-banking/statement?token=…` renders the same statement on the server and opens
the print dialog. The token is random, works for 10 minutes and only for the user who created it;
the account id is not in the URL.
The layout is shared by both (`src/components/StatementView.tsx`).

### Agent skill

The **`bank-accounts`** [Agent Skill](https://agentskills.io/) (`skills/bank-accounts/SKILL.md`) is
the playbook for agents: when to connect a bank, how to read balances and signed amounts, paging,
spending summaries, errors and privacy. It is served at `/skills/catalog.json` and included in
`/plugin.zip`.

## Setup

Requirements: Node.js 22.23.4 or later (Astro 7), pnpm 11.

1. **Register an application** in the control panel on [enablebanking.com](https://enablebanking.com)
   (start with *Sandbox*). Add the redirect URL `http://localhost:4321/enable-banking/callback`.
   Registering downloads the application's private key (`<application id>.pem`); keep it safe,
   it cannot be downloaded again.
2. **Configure** the plugin: copy `.env.example` to `.env` and set
   - `ENABLE_BANKING_APP_ID`: the application id,
   - `ENABLE_BANKING_PRIVATE_KEY`: the contents of the `.pem` file, in double quotes over several
     lines, or on one line with `\n` for the line breaks (`.env` is gitignored),
   - `ENABLE_BANKING_REDIRECT_URL`: only when not running on `http://localhost:4321`; it must
     exactly match a redirect URL registered for the application,
   - `ENABLE_BANKING_DATA_DIR`: where the bank connections are stored, default `.data`
     (gitignored). The directory holds Enable Banking session ids, which give access to the
     users' bank data: keep it private.
3. **Run:**

   ```bash
   pnpm install
   pnpm dev
   ```

The plugin runs on <http://localhost:4321>: docs and REST tester at `/`, the MCP server at `/mcp`.

### Try it with an agent

- [MCPJam](https://www.mcpjam.com/): `npx @mcpjam/inspector@latest`, add the server
  `http://localhost:4321/mcp` (HTTP, OAuth with a pre-registered client) and use the
  **Playground** chat, which renders the widget.
- Claude Code: `claude mcp add --transport http enable-banking http://localhost:4321/mcp`.

Both log in at the Quartal test Keycloak. Setting up the Keycloak client and MCPJam:
[docs/authentication.md](docs/authentication.md). Logging in from Claude Code has not been tried
yet. With `auth: "anon"` in `qrtl.config.ts` the tools answer "Not logged in", since every bank
connection belongs to a user.

Then ask, for example: *"Connect my bank: Mock ASPSP in Finland"*, and after approving:
*"What's my balance, and how much did I spend on groceries this month?"* A new conversation
remembers the connection: *"What's my balance?"* works there without connecting again.

Claude Desktop, claude.ai and ChatGPT cannot reach `localhost`: they need a deployment or an HTTPS
tunnel, whose callback URL must also be registered with Enable Banking.

### Sandbox test data

In the sandbox, use the bank **Mock ASPSP** (any country, no credentials). Its accounts start
empty: add accounts, balances and transactions in the control panel under *Upload accounts data*
(JSON in the format of Enable Banking's
[synthetic sample](https://enablebanking.com/sample-data/DK-Danske_Bank-synthetic-1.json)).
Mock ASPSP supports `date_from`/`date_to` filtering; its docs say it pages transactions in batches
of 10, though a 20-transaction account came back in one page.

## Styling

The widgets and the plugin's own pages use the plugin's Bootstrap skin: the same `style.skin` as
the docs site, by default Quartal's (`https://cdn.quartal.com/skins/default.css`), so they follow
the look of Quartal Hub; components use its Bootstrap classes. Widgets run in the MCP host's
sandbox, so `qrtl.config.ts` declares the skin's origin and every origin it imports from in the
widget CSP: Google Fonts, jsDelivr for Bootstrap Icons, and the CDNs of the table libraries'
styles (DataTables, Tabulator), which these widgets do not use.

## Scripts

| Command | What |
|---|---|
| `pnpm dev` | Dev server on port 4321 (loads `.env`). |
| `pnpm typecheck` | `astro check` (TypeScript 6; see the `@emnapi/runtime` override in `pnpm-workspace.yaml`). |
| `pnpm lint` | ESLint: typescript-eslint's type-aware recommended rules (e.g. promise misuse) and the React hooks rules for the widgets (`eslint.config.js`). TypeScript stays on `~6.0`, the newest typescript-eslint supports. |
| `pnpm test` | Unit tests ([Vitest](https://vitest.dev/)) in `test/`, e.g. for the account statement calculation. |
| `pnpm build` | Production build into `dist/`; run with `node ./dist/server/entry.mjs`. |

## Code

| Path | What |
|---|---|
| `src/tools/EnableBanking.ts` | The tools (exported from `src/tools/mod.ts`). |
| `src/tools/model/BankingModel.ts` | Tool input and output types. |
| `src/enable-banking/EnableBankingClient.ts` | Enable Banking API client; signs RS256 JWTs with [`jose`](https://github.com/panva/jose), which also runs on Cloudflare Workers. |
| `src/enable-banking/PluginStore.ts` | The persistent store ([unstorage](https://unstorage.unjs.io); files under `.data/` by default). |
| `src/enable-banking/AuthorizationStore.ts` | Started authorizations, the user who started each, and their outcome. |
| `src/enable-banking/Connections.ts` | Each user's bank connections and the account ownership check. |
| `src/enable-banking/AccountData.ts` | Balances, transactions and statements from Enable Banking. |
| `src/pages/enable-banking/callback.astro` | The redirect URL: exchanges the code for a session and saves it as the user's connection. |
| `src/components/StartAuthorization.tsx`, `src/pages/widgets/startAuthorization.astro` | The Connect bank widget (React). |
| `src/layouts/WidgetLayout.astro` | The widget layout, which links the skin (`SKIN_URL` in `qrtl.config.ts`). |
| `src/enable-banking/buildAccountStatement.ts` | Account statement calculation (balances worked back from the current balance, in cents). |
| `src/components/AccountStatement.tsx`, `src/pages/widgets/getAccountStatement.astro` | The Account statement widget (React). |
| `src/components/StatementView.tsx` | The statement layout, shared by the widget and the print page. |
| `src/pages/enable-banking/statement.astro`, `src/enable-banking/PrintLinks.ts` | The printable statement page and its short-lived links. |

## Limitations

- **One process, local files:** the store is files on the server's disk (unstorage's `fs`
  driver), which survive restarts but are not shared between instances. Several instances or
  serverless hosting need a shared store: set another unstorage driver (e.g. Redis or Cloudflare
  KV) in `getPluginStore()` in `src/enable-banking/PluginStore.ts`.
- **Session ids are stored unencrypted.** Keep the data directory (or the shared store) private
  to the plugin.
- **Not tried with real logins yet:** the per-user checks are covered by unit tests
  (`test/userConnections.test.ts`); connecting a bank and reading it with two Keycloak users has
  not been done end to end.
- **Sandbox only:** production needs a separate, activated Enable Banking application and the
  deployed callback URL registered.
- **No payments:** account information only, no payment initiation.

How per-user authentication was planned, and where the implementation differs:
[docs/user-authentication.md](docs/user-authentication.md). A framework workaround in the code (`notFound` status) is explained in
[docs/bank-connection.md](docs/bank-connection.md#framework-workarounds).
