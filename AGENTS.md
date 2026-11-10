# Enable Banking Plugin — guide for coding agents

This is a **Quartal Plugin**: an Astro app where plain TypeScript classes become MCP tools,
REST actions, widgets and Agent Skills. Full documentation: <https://plugin.quartal.com>
(machine-readable index: <https://plugin.quartal.com/llms.txt>).

## Commands

- `pnpm install` — install dependencies
- `pnpm dev` — dev server on <http://localhost:4321>
- `pnpm build && node ./dist/server/entry.mjs` — production build and run

The server serves the plugin's docs site (with tool and widget testers) at `/`, the MCP server
at `/mcp`, REST operations at `/api/<class>/...` (see the Tools guide for the naming convention), widget pages at `/widgets/<toolId>` and the
Agent Plugins manifest at `/plugin.json`.

## Conventions

- **Tools** are classes in `src/tools/`, exported from `src/tools/mod.ts`. Every public method
  of an exported class becomes an MCP tool and a REST action.
- **Types of tool inputs and outputs** go in `src/tools/` (e.g. `src/tools/model/`) and are re-exported
  from `src/tools/mod.ts`. The generator follows every type that a tool method's first parameter and
  return type reach and describes it with its JSDoc; a type it cannot resolve becomes `{}`, so check
  the schema at `/open-api.json` after adding a type.
- **Tools that only read** are marked `@readOnly` in their JSDoc (`@destructive`, `@idempotent` and
  `@openWorld` also exist), so MCP hosts can run them without asking the user to approve each call.
- **Method names follow CRUD verbs** on both surfaces: `get`/`list`/`find` → GET and read-only, `create` → POST,
  `update` → PUT and idempotent, `delete`/`remove` → DELETE and destructive, anything else → POST; a required
  `id` input becomes `/{id}`; a bare verb such as `Invoices.get` is the MCP tool `getInvoice`. GET and DELETE
  inputs must be string/number/boolean properties. `@rest [METHOD] [path]` overrides the route; `@rest hidden`
  or `@mcp hidden` keeps a tool to one surface.
- **Schemas are generated** from the TypeScript types and JSDoc — including tags like
  `@format`, `@example` and `@visibility`. Never hand-write JSON Schema and never add a schema
  library (zod etc.); improve the types and JSDoc instead.
- **Widgets** are Astro pages in `src/pages/widgets/`; a page's file name must be the id of
  the tool it visualizes (`listInvoices.astro` is the UI for a `listInvoices` tool).
- **Skills**: to ship know-how alongside the tools, add folders with a `SKILL.md` under
  `skills/`.
- **Plugin options** (title, description, auth, deploy) live in `qrtl.config.ts`.
- **Auth**: this plugin is anonymous (`auth: "anon"` in `qrtl.config.ts`).

## Verify changes

1. `pnpm build` must succeed — the build analyzes the tool types and fails on schema problems.
2. Start `pnpm dev` and check the tools respond over MCP at `http://localhost:4321/mcp`
   (JSON-RPC `tools/list` / `tools/call`), or use the testers on the docs site at `/`.
