import { useEffect, useRef, useState } from "react";
import { connectWidget, type WidgetBridge } from "@quartal/plugin/widget";
import type { AuthorizationResult, AuthorizationStart } from "../tools/model/BankingModel.ts";

/** How often the widget checks whether the user has finished at the bank */
const POLL_INTERVAL_MS = 5_000;

/**
 * How long the widget keeps checking after the button is clicked. A bank login usually takes a
 * minute or two; after this the user checks again with a button or tells the assistant (the plugin
 * keeps a started authorization for 30 minutes).
 */
const POLL_DURATION_MS = 5 * 60 * 1000;

/**
 * Widget for the `startAuthorization` tool: a button that opens the bank login URL through the MCP
 * host. After the button is clicked, the widget checks `getAuthorizationResult` every 5 seconds
 * for 5 minutes; once the bank is connected (or the connection failed), it shows the outcome and
 * sends a chat message, so the assistant continues without the user having to say they are done.
 * When the 5 minutes pass, a Check again button checks for another 5 minutes.
 */
export default function StartAuthorization() {
  const bridge = useRef<WidgetBridge<AuthorizationStart> | null>(null);
  const [start, setStart] = useState<AuthorizationStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [outcome, setOutcome] = useState<AuthorizationResult | null>(null);
  /** Whether the chat message about the outcome reached the host */
  const [messageSent, setMessageSent] = useState(false);
  /**
   * A new value for each click that (re)starts the checks (Connect bank, its reopen, Check
   * again), and whether that round's first check runs at once (Check again) or after an interval
   */
  const [poll, setPoll] = useState<{ round: number; immediately: boolean }>({ round: 0, immediately: false });
  /** Whether the checks of the current round have run out */
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    void connectWidget<AuthorizationStart>({
      name: "StartAuthorizationApp",
      version: "0.4.0",
      onResult: (result) => {
        setStart(result);
        setError(null);
      },
      onError: setError,
    }).then((b) => {
      bridge.current = b;
    });
  }, []);

  // Poll for POLL_DURATION_MS after each click, until the authorization is no longer pending.
  // Check again checks at once; after opening the bank login, the first check waits an interval.
  const authorizationId = start?.authorizationId;
  const finished = outcome !== null;
  useEffect(() => {
    if (poll.round === 0 || !authorizationId || finished) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const deadline = Date.now() + POLL_DURATION_MS;

    const check = async () => {
      const result = await bridge.current
        ?.callTool<AuthorizationResult>("getAuthorizationResult", { authorizationId })
        .catch(() => undefined);
      if (stopped) return;
      if (result && result.status !== "pending") {
        setOutcome(result);
        setMessageSent(await notifyChat(bridge.current, result));
        return;
      }
      if (Date.now() < deadline) timer = setTimeout(() => void check(), POLL_INTERVAL_MS);
      else setTimedOut(true);
    };
    timer = setTimeout(() => void check(), poll.immediately ? 0 : POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [poll, authorizationId, finished]);

  const startPolling = (immediately: boolean) => {
    setTimedOut(false);
    setPoll((p) => ({ round: p.round + 1, immediately }));
  };

  const openBank = async () => {
    if (!start) return;
    setOpened(true);
    startPolling(false);
    // Fall back to a plain new tab when the host cannot open links (no bridge, error or rejection).
    const res = await bridge.current?.app.openLink({ url: start.url }).catch(() => undefined);
    if (!res || res.isError) window.open(start.url, "_blank", "noopener");
  };

  if (error) {
    return (
      <div className="alert alert-danger m-3" role="alert">
        {error}
      </div>
    );
  }
  if (!start) return <div className="p-3 text-body-secondary">Preparing the bank login…</div>;
  if (outcome) return <Outcome result={outcome} messageSent={messageSent} />;
  return (
    <div className="p-3">
      <p>Log in to your bank to approve access to your account information.</p>
      <button type="button" className="btn btn-primary" onClick={() => void openBank()}>
        <i className="bi bi-bank me-2" aria-hidden="true" />
        {opened ? "Open bank login again" : "Connect bank"}
      </button>
      {timedOut ? (
        <div className="mt-3">
          <p className="small text-body-secondary mb-2">
            Still at the bank? When you have approved access, check again or tell the assistant you are done.
          </p>
          <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => startPolling(true)}>
            <i className="bi bi-arrow-clockwise me-2" aria-hidden="true" />
            Check again
          </button>
        </div>
      ) : (
        <p className="small text-body-secondary mt-2 mb-0">
          {opened
            ? "Waiting for your bank… This updates by itself once you have approved access."
            : "After you approve access at your bank, the assistant continues by itself."}
        </p>
      )}
    </div>
  );
}

/**
 * The outcome of the authorization
 * @param props The result, and whether the chat was told about it
 */
function Outcome({ result, messageSent }: { result: AuthorizationResult; messageSent: boolean }) {
  const tellAssistant = messageSent ? null : (
    <p className="small text-body-secondary mt-2 mb-0">Tell the assistant to continue.</p>
  );
  if (result.status === "connected") {
    const count = result.accounts?.length ?? 0;
    return (
      <div className="p-3">
        <p className="mb-0">
          <i className="bi bi-check-circle-fill text-success me-2" aria-hidden="true" />
          {result.bank ?? "Bank"} connected: {count} account{count === 1 ? "" : "s"} shared.
        </p>
        {tellAssistant}
      </div>
    );
  }
  return (
    <div className="p-3">
      <div className="alert alert-warning mb-0" role="alert">
        Connecting the bank did not succeed{result.error ? `: ${result.error}` : "."}
      </div>
      {tellAssistant}
    </div>
  );
}

/**
 * Sends a chat message about the outcome as the user, so the assistant continues. Returns whether
 * the host accepted it; hosts without `ui/message` support reject it.
 * @param bridge The widget bridge
 * @param result The authorization's outcome
 */
async function notifyChat(bridge: WidgetBridge | null, result: AuthorizationResult): Promise<boolean> {
  const bank = result.bank ?? "my bank";
  const text =
    result.status === "connected"
      ? `I have connected ${bank}.`
      : result.status === "failed"
        ? `Connecting ${bank} failed${result.error ? `: ${result.error}` : "."}`
        : `The connection to ${bank} expired before I finished.`;
  const res = await bridge?.app
    .sendMessage({ role: "user", content: [{ type: "text", text }] })
    .catch(() => undefined);
  return res !== undefined && !res.isError;
}
