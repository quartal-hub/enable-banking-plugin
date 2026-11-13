---
name: bank-accounts
description: Use this skill when the user wants to connect a bank account, or asks about their bank accounts, balances, transactions, account statements (tiliote), spending or income, using the Enable Banking tools of this plugin (listBanks, startAuthorization, getAuthorizationResult, listConnections, listAccounts, getBalances, listTransactions, getAccountStatement, disconnectBank).
---

# Bank accounts through Enable Banking

These tools read bank account information (accounts, balances, transactions) after the user has
connected their bank. They cannot make payments or move money. The plugin keeps the user's bank
connections on the server, across conversations: every tool works on the logged-in user's own
banks, and no id has to be carried over from earlier.

## 1. Connect a bank (only when needed)

Start with `listAccounts`. If it returns the accounts the user asks about, skip to step 2. If it
returns nothing, or not the bank the user means, call `listConnections`: a connection with
`status: "ended"` must be connected again; otherwise connect the bank:

1. If the user has not named their bank, ask for it and the country. Call `listBanks` with the
   two-letter country code (`FI`, `SE`, `DE`, …) and use the bank's `name` **exactly** as returned.
   If several banks match (for example "Nordea" and "Nordea Corporate"), ask which one; use
   `psuType: "business"` only for a business account.
2. Call `startAuthorization` once. The **Connect bank** widget shows a button that opens the bank
   login. If no widget is shown, give the user the returned `url` as a link.
3. Tell the user to log in at their bank, approve access, and come back. Do not call
   `startAuthorization` again while they are doing this: each call creates a new, separate login.
4. When the user says they are done, call `getAuthorizationResult` with the `authorizationId`:
   - `connected`: the bank's `accounts` are connected; they are now also in `listAccounts`.
   - `pending`: the user has not finished yet. Ask them to complete the login, then check again.
     Do not poll in a loop.
   - `failed`: tell the user the `error` and offer to start again.
   - `notFound`: the attempt expired or the id is wrong. Start again.

## 2. Read accounts, balances and transactions

- `listAccounts` returns the accounts of all the user's connected banks, each with its `bank`
  (pass a `connectionId` from `listConnections` for one bank only). Each account has a `uid`: use
  it as the `accountId` for `getBalances`, `listTransactions` and `getAccountStatement`. The `uid`
  changes when the bank is connected again, so get it from `listAccounts`, not from memory.
- Account `type`: `CACC` current account, `SVGS` savings, `CARD` card account, `LOAN` loan,
  `CASH` cash account, `TRAN` transaction account. Use these words with the user, not the codes.
- When the user has several accounts and does not say which, use the current account (`CACC`) for
  "my balance", and mention the others briefly. For totals across accounts, say which you included.

### Balances

`getBalances` may return several balances for one account. Prefer, in this order:

1. `ITAV` (interim available) or `CLAV` (closing available): what the user can spend now.
2. `CLBD` (closing booked) or `ITBD` (interim booked): the booked balance.
3. Anything else, by its `name`.

State the date (`referenceDate`) and the currency. If two balance types have the same amount, give
the amount once. An empty list means the bank reports no balance for that account (common for
card accounts); say so rather than reporting zero.

### Transactions

- `amount` is a signed decimal string: **negative is money out**, positive is money in. Do not
  change signs when summing; report spending as a positive amount ("you spent €348.90").
- Use `dateFrom` and `dateTo` (`YYYY-MM-DD`) to limit the period. Not every bank supports date
  filtering: still check `bookingDate` yourself and drop transactions outside the period.
- If the result has a `continuationKey`, there are more transactions: call `listTransactions`
  again with it, and repeat until there is none, before you compute totals for a period.
- `status: "PDNG"` is pending, not yet booked. Include pending transactions only when the user
  asks for the latest activity, and say that they are pending.

### Account statements (tiliote)

`getAccountStatement`'s widget shows the statement as a printable document, so do not repeat
every transaction in your reply: summarize the opening and closing balance, money in and out, and
anything notable, and mention the statement's `notes` if they say the balances may be incomplete.
The opening and closing balances are calculated back from the bank's current balance.

### Spending and income questions

Group transactions by `counterparty` and `description`, and categorize by merchant name: for
example K-Supermarket, K-Market, Prisma, S-market, Alepa, Lidl and Sale are groceries; R-kioski is
a kiosk, not groceries; restaurants and cafés are eating out; HSL, VR and taxis are transport.
Show the categories you used and the per-merchant amounts, so the user can check the total, and
say which transactions you left out and why. If a merchant's category is unclear, say so instead
of guessing.

## 3. Errors

Tool errors say what happened and what to do; follow them. In addition:

- After "The bank connection has ended", do not retry: ask the user to connect the bank again
  (step 1), then call `listAccounts` for the new account ids.
- `listBanks` returns no matching bank: the bank may not be supported in that country; show the
  closest names returned.

## 4. Disconnecting

`disconnectBank` with a `connectionId` from `listConnections` ends the plugin's access to that
bank. Call it only when the user asks to disconnect or remove a bank, and confirm which bank first.

## 5. Privacy

- Bank data is personal. Show only what the user asked for.
- Do not repeat account `uid`s or `connectionId`s to the user; they are internal. Refer to accounts
  by name and type, and to an IBAN by its last four digits (`… 0785`) unless the user asks for the
  full IBAN.
- Never ask the user for their bank password or login codes: they enter those only on the bank's
  own page.
