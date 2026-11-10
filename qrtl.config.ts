import { defineQrtlConfig } from "@quartal/plugin";

/** The Bootstrap skin of the docs site, the widgets and the plugin's own pages (Quartal default). */
export const SKIN_URL = "https://cdn.quartal.com/skins/default.css";

// Plugin metadata and options — see https://plugin.quartal.com for the full reference.
export default defineQrtlConfig({
  title: "Enable Banking Plugin",
  description: "Bank account data via Enable Banking",
  // Auth mode: "anon" (no authentication), "quartal-hub" (OAuth2 via Quartal Hub), or
  // "custom" (your own OAuth2 / OIDC server).
  auth: {
    mode: "custom",
    issuer: "https://iam2026.test.qrtl.com/auth/realms/quartal",
    scope: "quartal-hub-test",
    audience: "https://hub.test.qrtl.com",
  },
  // Logo and icons shown by MCP clients and the docs site can be added here too (`logo`, `icons`).
  style: { skin: SKIN_URL },
  widgets: {
    // Widgets run in the MCP host's sandbox, which loads only the origins declared here: the skin and
    // everything it imports: fonts (Google Fonts), Bootstrap Icons (jsDelivr), and the table libraries'
    // styles (DataTables, Tabulator), which these widgets do not use.
    csp: {
      resourceDomains: [
        new URL(SKIN_URL).origin,
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "https://cdn.jsdelivr.net",
        "https://cdn.datatables.net",
        "https://cdnjs.cloudflare.com",
        "https://unpkg.com",
      ],
      // `astro dev` only: the hot-reload WebSocket of the Vite client the dev widgets load.
      connectDomains: process.argv.includes("dev") ? ["ws://localhost:4321"] : [],
    },
  },
  // Publishing to Quartal Hub:
  // deploy: { org: "my-org", app: "enable-banking-plugin" },
});
