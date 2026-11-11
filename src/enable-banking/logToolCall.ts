import type { QuartalPluginContext } from "@quartal/plugin";

/** Local time as `22:45:12`, like the timestamps of the Astro dev server's log */
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/**
 * Logs a tool call with the id of the logged-in user (`ctx.uid`, the token's `sub`)
 * @param tool Tool name
 * @param ctx The logged-in user, from the access token
 */
export function logToolCall(tool: string, ctx: QuartalPluginContext | undefined): void {
  console.info(`${TIME.format(new Date())} [tool] ${tool} uid=${ctx?.uid ?? "(none)"}`);
}
