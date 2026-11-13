# Hosting on Vercel

How to run the plugin on [Vercel](https://vercel.com), so that hosted MCP clients (claude.ai,
Claude Desktop, ChatGPT) can reach it and Enable Banking has a public callback URL.

## What you need

- A **Vercel account**. The plugin runs as one Vercel Function with Fluid compute (Vercel's
  default for new projects).
- A **Redis database** reachable through a `REDIS_URL`, e.g. from Vercel's Redis integration in
  the Marketplace, or any Redis you run yourself. The plugin sends it only a few commands per bank
  connect, so the smallest plan is enough.
- An **Enable Banking application** ([Setup](../README.md#setup)); a sandbox application works.
- Users log in through the Quartal test Keycloak (`auth: "quartal-hub"`), and each MCP client
  needs a Keycloak client: [authentication.md](authentication.md).

## Where the data lives

| Data | Lifetime | Where |
|---|---|---|
| Bank connections (Enable Banking session ids) | up to the bank access's end (90 days requested) | each user's Quartal Hub secret |
| Bank logins in progress (start → callback → next tool call) | at most 30 minutes | Redis |
| Print links | 10 minutes | nowhere: encrypted inside the link |

Nothing is kept on the function's disk or in its memory between requests, which suits Vercel:
functions have no persistent disk, and their memory is lost on deploys and idle shutdowns.
Details: [bank-connection.md](bank-connection.md#stored-records).

### Why Redis is needed

The bank sends the user's browser back to `/enable-banking/callback`. That redirect carries no
login token, so the callback can't write the user's Quartal Hub secrets. It parks the new
connection with the started authorization, and the user's next tool call (normally the Connect
bank widget's status check) moves it to their secret.

The started authorization and the parked connection must therefore be visible to every instance
of the function. Vercel may serve the callback from another instance than the one that started
the authorization: in a test with a single user and Fluid compute on, a new instance took over 19
seconds after `startAuthorization`. Without a shared store, the callback then answers "Unknown or
expired request". So on Vercel the plugin requires `REDIS_URL`: without it, the bank tools fail
with an error that names it.

## Steps

1. **Create the project and deploy.** Either import the Git repository in the Vercel dashboard,
   or deploy this folder with the CLI:

   ```bash
   npx vercel link              # create or pick the project
   npx vercel deploy --prod
   ```

   Vercel detects Astro and sets `VERCEL=1` when it builds, which selects `@astrojs/vercel` in
   `astro.config.mjs`. `vercel.json` asks for the Frankfurt region (`fra1`); change it to suit
   your users and your Redis. The CLI uploads the folder as the deployment's source and doesn't
   read `.gitignore`; `.vercelignore` keeps `.env`, private keys and build output out of the
   upload.

   The first deploy gives the production domain, e.g. `https://<project>.vercel.app`, which the
   next steps need.

2. **Add Redis.** In the project's **Storage** tab, create a Redis database (or pick an existing
   one) and **Connect** it to the project; that sets `REDIS_URL`. With your own Redis, set
   `REDIS_URL` yourself (`redis://…` or `rediss://…`). Put the database in or near the
   functions' region.

3. **Set the environment variables** for Production (Settings → Environment Variables, or
   `npx vercel env add`):

   | Variable | Value |
   |---|---|
   | `ENABLE_BANKING_APP_ID` | the Enable Banking application id |
   | `ENABLE_BANKING_PRIVATE_KEY` | the application's private key: the whole PEM over several lines; mark it Sensitive |
   | `ENABLE_BANKING_REDIRECT_URL` | `https://<your domain>/enable-banking/callback` |
   | `REDIS_URL` | set by step 2 |

   Deploy again afterwards: variables take effect in new deployments only.

4. **Register the callback URL** `https://<your domain>/enable-banking/callback` as a redirect URL
   of the application in the Enable Banking control panel. It must match
   `ENABLE_BANKING_REDIRECT_URL` exactly.

5. **Use the production domain.** Vercel's standard Deployment Protection puts a Vercel login in
   front of the per-deployment URLs but not the production domain. MCP clients can't get past that
   login, so connect them to `https://<your domain>/mcp`.

6. **Allow the MCP clients in Keycloak:** add their OAuth redirect URIs to the Keycloak client,
   e.g. `https://claude.ai/api/mcp/auth_callback` for claude.ai
   ([authentication.md](authentication.md)).

## Checks

- `https://<your domain>/plugin.json` and `/.well-known/oauth-protected-resource` answer `200`,
  and `POST /mcp` without a token answers `401`.
- In an MCP client (e.g. MCPJam, see [authentication.md](authentication.md)): log in, connect **Mock ASPSP** with
  `startAuthorization`, and check that the callback page says the bank is connected and
  `listConnections` lists it. Then try `getAccountStatement` and its print link.
- The logs show which instance served each step: every tool call and callback logs
  `instance=<id>`, e.g. with `npx vercel logs --since 1h`. A connect should work even when the
  ids differ.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Bank tools fail with "REDIS_URL is not set" | Redis isn't connected to the project, or the deployment predates it: connect it and deploy again. |
| The callback page says "Unknown or expired request" | The user took more than 30 minutes at the bank, or Redis is not shared (e.g. `REDIS_URL` differs between deployments). |
| Enable Banking shows a redirect URL error | The callback URL isn't registered, or differs from `ENABLE_BANKING_REDIRECT_URL`. |
| MCP clients get an HTML login page instead of `401` | They use a per-deployment URL behind Deployment Protection; use the production domain. |
| Tools fail with "The Quartal Hub services need …" | `qrtl.config.ts` doesn't use `auth: "quartal-hub"`, which the Hub secrets require. |
