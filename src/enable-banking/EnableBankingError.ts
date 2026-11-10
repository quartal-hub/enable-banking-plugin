/** The bank access behind a session has ended: the session is closed, expired or revoked */
const RECONNECT =
  "Ask the user to connect their bank again (startAuthorization), then use the new session.";

// Errors from the Enable Banking API, with messages written for the agent: what happened and what
// to do next. Tool errors reach MCP clients as the error message (`isError: true`).

/**
 * The error for a failed API response
 * @param status HTTP status
 * @param body Response body (Enable Banking sends `{ code, message, error, detail }`)
 * @param method HTTP method, for the fallback message
 * @param path API path, for the fallback message
 */
export function errorFromResponse(status: number, body: string, method: string, path: string): Error {
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
    return new Error(`The bank connection has ended (${reason}). ${RECONNECT}`);
  }
  if (code === "SESSION_DOES_NOT_EXIST") {
    return new Error("Unknown session id. Use the session id from getAuthorizationResult, or connect the bank again.");
  }
  if (code === "ACCOUNT_DOES_NOT_EXIST") {
    return new Error("Unknown account id. Use an account uid from listAccounts for the current session.");
  }
  if (code === "WRONG_REQUEST_PARAMETERS") {
    return new Error(`Invalid request: ${reason}. Check the ids and dates (YYYY-MM-DD).`);
  }
  const route = path.split("?")[0];
  return new Error(`Enable Banking ${method} ${route} failed (${status}): ${reason}`);
}

/**
 * The error for a session that exists but no longer gives access
 * @param sessionStatus The session's status, e.g. `CLOSED` or `EXPIRED`
 */
export function sessionEndedError(sessionStatus: string): Error {
  return new Error(`The bank connection has ended (session status ${sessionStatus}). ${RECONNECT}`);
}
