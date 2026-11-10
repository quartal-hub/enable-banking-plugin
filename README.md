# Enable Banking Plugin

Bank account information for AI agents through [Enable Banking](https://enablebanking.com): an
agent connects the user's bank account and reads accounts, balances and transactions. Built with
[Quartal Plugins](https://plugin.quartal.com), so the same tools are served over MCP (with an MCP
Apps widget) and as a REST API.

> **Status: sandbox prototype.** The plugin runs anonymously, keeps pending authorizations in
> memory and is tested against Enable Banking's sandbox only. Do not deploy it for real bank data
> before the per-user authentication in [docs/user-authentication.md](docs/user-authentication.md)
> is in place. See [Limitations](#limitations).

## Tools

| Tool | REST | What it does |
|---|---|---|
| `listBanks` | `GET /api/enable-banking/banks?country=FI` | Banks (ASPSPs) available in a country. |
| `startAuthorization` | `POST /api/enable-banking/start-authorization` | Starts connecting a bank: returns the bank login URL and an `authorizationId`. Has the **Connect bank** widget. |
| `getAuthorizationResult` | `GET /api/enable-banking/authorization-result?authorizationId=…` | Whether the user has finished at the bank (`pending`, `connected`, `failed`, `notFound`); once connected, the session id and accounts. |
| `listAccounts` | `GET /api/enable-banking/accounts?sessionId=…` | Accounts of a connected session: name, IBAN, type (`CACC`, `CARD`, …), currency. |
| `getBalances` | `GET /api/enable-banking/balances?accountId=…` | Balances of an account (e.g. available `ITAV`, closing booked `CLBD`). |
| `listTransactions` | `GET /api/enable-banking/transactions?accountId=…` | Transactions of an account, newest first: signed amounts (negative for money out), counterparty, description. Optional `dateFrom`/`dateTo`; pages with `continuationKey`. |
| `getAccountStatement` | `GET /api/enable-banking/account-statement?accountId=…&dateFrom=…&dateTo=…` | **Account statement (tiliote)** for a period (default: the previous calendar month): opening and closing balance, every booked transaction with the running balance, money in and out, pending transactions separately. Has the **Account statement** widget. |

All tools except `startAuthorization` are read-only and marked so for MCP hosts. How connecting a
bank works, step by step, and the error messages the agent gets: [docs/bank-connection.md](docs/bank-connection.md).

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
the print dialog. The token is random and works for 10 minutes; the account id is not in the URL.
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
     exactly match a redirect URL registered for the application.
3. **Run:**

   ```bash
   pnpm install
   pnpm dev
   ```

The plugin runs on <http://localhost:4321>: docs and REST tester at `/`, the MCP server at `/mcp`.

### Try it with an agent

- [MCPJam](https://www.mcpjam.com/): `npx @mcpjam/inspector@latest`, add the server
  `http://localhost:4321/mcp` (HTTP, no auth) and use the **Playground** chat, which renders the
  widget.
- Claude Code: `claude mcp add --transport http enable-banking http://localhost:4321/mcp`.

Then ask, for example: *"Connect my bank: Mock ASPSP in Finland"*, and after approving:
*"What's my balance, and how much did I spend on groceries this month?"*

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
| `src/enable-banking/AuthorizationStore.ts` | Started authorizations and their outcome (in memory). |
| `src/pages/enable-banking/callback.astro` | The redirect URL: exchanges the code for a session. |
| `src/components/StartAuthorization.tsx`, `src/pages/widgets/startAuthorization.astro` | The Connect bank widget (React). |
| `src/layouts/WidgetLayout.astro` | The widget layout, which links the skin (`SKIN_URL` in `qrtl.config.ts`). |
| `src/enable-banking/buildAccountStatement.ts` | Account statement calculation (balances worked back from the current balance, in cents). |
| `src/components/AccountStatement.tsx`, `src/pages/widgets/getAccountStatement.astro` | The Account statement widget (React). |
| `src/components/StatementView.tsx` | The statement layout, shared by the widget and the print page. |
| `src/pages/enable-banking/statement.astro`, `src/enable-banking/PrintLinks.ts` | The printable statement page and its short-lived links. |

## Limitations

- **No authentication.** Anyone who can reach the plugin can call every tool. Enable Banking only
  accepts a session or account id together with the application's private key, but the plugin
  holds that key, so through the plugin an id alone is enough to read someone's data.
- **The session id passes through the conversation**, and a new conversation does not know about
  earlier connections.
- **In-memory state:** a restart loses pending authorizations, and several instances would not
  share them; the callback then answers "Unknown or expired request" even though the bank login
  succeeded.
- **Sandbox only:** production needs a separate, activated Enable Banking application and the
  deployed callback URL registered.
- **No payments:** account information only, no payment initiation. Nothing revokes a session
  either; it expires after the requested 90 days.

The plan to fix the first three: [docs/user-authentication.md](docs/user-authentication.md).
A framework workaround in the code (`notFound` status) is explained in
[docs/bank-connection.md](docs/bank-connection.md#framework-workarounds).
