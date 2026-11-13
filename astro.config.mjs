import process from "node:process";
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import vercel from "@astrojs/vercel";
import react from "@astrojs/react";
import qrtlPlugin from "@quartal/plugin/astro";

// The dev server blocks cross-origin requests (Sec-Fetch-Site: cross-site) that do not come from
// an allowed origin. During `astro dev`, allow:
// - the widget sandboxes MCP hosts render on their own origin, e.g. MCPJam's http://<id>.localhost:<port>
// - MCP inspectors running in the browser, e.g. MCPJam at http://127.0.0.1:6274, which call /mcp
// Not in production: there this option decides which X-Forwarded-Host values to trust, and the
// built widgets are plain files the check does not cover.
const dev = process.argv.includes("dev");

export default defineConfig({
  output: "server",
  // Vercel sets VERCEL=1 when it builds; everywhere else the plugin is a standalone Node.js server
  // (`node ./dist/server/entry.mjs`).
  adapter: process.env.VERCEL ? vercel() : node({ mode: "standalone" }),
  integrations: [react(), qrtlPlugin()],
  security: dev
    ? {
        allowedDomains: [
          { hostname: "**.localhost", protocol: "http" },
          { hostname: "localhost", protocol: "http" },
          { hostname: "127.0.0.1", protocol: "http" },
        ],
      }
    : {},
});
