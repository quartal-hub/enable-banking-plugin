import type { QuartalPluginContext } from "@quartal/plugin";

/** Local time as `22:45:12`, like the timestamps of the Astro dev server's log */
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// On globalThis so the tool modules and the Astro pages log the same id even if the dev server
// loads this module more than once.
const GLOBAL_KEY = "__enableBankingInstanceId";

/**
 * A random id of this server instance, logged with every tool call and callback. Pending bank
 * authorizations live in instance memory, so on a host with several instances (Vercel) the
 * callback and the user's next tool call must share an id for a connect to work.
 */
export const INSTANCE_ID: string = ((globalThis as Record<string, unknown>)[GLOBAL_KEY] ??= crypto
  .randomUUID()
  .slice(0, 8)) as string;

/**
 * Logs a tool call with the id of the logged-in user (`ctx.uid`, the token's `sub`)
 * @param tool Tool name
 * @param ctx The logged-in user, from the access token
 */
export function logToolCall(tool: string, ctx: QuartalPluginContext | undefined): void {
  console.info(`${TIME.format(new Date())} [tool] ${tool} uid=${ctx?.uid ?? "(none)"} instance=${INSTANCE_ID}`);
}

/**
 * Logs a bank callback and whether this instance knew its authorization
 * @param found Whether the callback's `state` named a pending authorization here
 */
export function logCallback(found: boolean): void {
  console.info(`${TIME.format(new Date())} [callback] ${found ? "found" : "unknown state"} instance=${INSTANCE_ID}`);
}
