/** What the agent should do when the bank access behind a connection has ended */
const RECONNECT =
  "Ask the user to connect their bank again (startAuthorization), then call listAccounts for the new account ids.";

// Errors from the Enable Banking API, with messages written for the agent: what happened and what
// to do next. Tool errors reach MCP clients as the error message (`isError: true`).

/** An error from the Enable Banking API */
export class EnableBankingError extends Error {
  /**
   * @param message Message for the agent
   * @param sessionEnded Whether the session behind the request is closed, expired, revoked or gone
   */
  constructor(
    message: string,
    readonly sessionEnded = false,
  ) {
    super(message);
    this.name = "EnableBankingError";
  }
}

/**
 * The error for a failed API response
 * @param status HTTP status
 * @param body Response body (Enable Banking sends `{ code, message, error, detail }`)
 * @param method HTTP method, for the fallback message
 * @param path API path, for the fallback message
 */
export function errorFromResponse(status: number, body: string, method: string, path: string): EnableBankingError {
  let code: string | undefined;
  let apiMessage: string | undefined;
  try {
    const json = JSON.parse(body) as { error?: string; message?: string };
    code = json.error;
    apiMessage = json.message;
  } catch {
    // Not JSON: keep the raw body in the fallback message.
  }
  const reason = apiMessage ?? (body.slice(0, 300) || `HTTP ${status}`);

  if (status === 401 && code?.endsWith("_SESSION")) {
    return new EnableBankingError(`The bank connection has ended (${reason}). ${RECONNECT}`, true);
  }
  if (code === "SESSION_DOES_NOT_EXIST") {
    return new EnableBankingError(`The bank connection no longer exists. ${RECONNECT}`, true);
  }
  if (code === "ACCOUNT_DOES_NOT_EXIST") {
    return new EnableBankingError("Unknown account id. Use an account uid from listAccounts.");
  }
  if (code === "WRONG_REQUEST_PARAMETERS") {
    return new EnableBankingError(`Invalid request: ${reason}. Check the ids and dates (YYYY-MM-DD).`);
  }
  const route = path.split("?")[0];
  return new EnableBankingError(`Enable Banking ${method} ${route} failed (${status}): ${reason}`);
}

/** The error for an account id that is not one of the logged-in user's accounts */
export function unknownAccountError(): Error {
  return new Error("Unknown account id. Use an account uid from listAccounts.");
}

/** The error for a connection that has ended earlier */
export function connectionEndedError(bank: string): Error {
  return new Error(`The connection to ${bank} has ended. ${RECONNECT}`);
}
