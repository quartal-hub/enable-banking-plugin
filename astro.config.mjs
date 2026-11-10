import process from "node:process";
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import qrtlPlugin from "@quartal/plugin/astro";

// The dev server blocks cross-origin requests for its modules (Sec-Fetch-Site: cross-site). MCP
// hosts render widgets in a sandbox on their own origin, e.g. MCPJam's http://<id>.localhost:<port>,
// so allow those during `astro dev`. Not in production: there this option decides which
// X-Forwarded-Host values to trust, and the built widgets are plain files the check does not cover.
const dev = process.argv.includes("dev");

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react(), qrtlPlugin()],
  security: dev ? { allowedDomains: [{ hostname: "**.localhost", protocol: "http" }] } : {},
});
