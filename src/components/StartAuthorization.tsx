import { useEffect, useRef, useState } from "react";
import { connectWidget, type WidgetBridge } from "@quartal/plugin/widget";
import type { AuthorizationStart } from "../tools/model/BankingModel.ts";

/**
 * Widget for the `startAuthorization` tool: a button that opens the bank login URL through the MCP
 * host. When the user is done at the bank, they tell the assistant, which then calls
 * `getAuthorizationResult` for the new session.
 */
export default function StartAuthorization() {
  const bridge = useRef<WidgetBridge<AuthorizationStart> | null>(null);
  const [start, setStart] = useState<AuthorizationStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    void connectWidget<AuthorizationStart>({
      name: "StartAuthorizationApp",
      version: "0.3.0",
      onResult: (result) => {
        setStart(result);
        setError(null);
      },
      onError: setError,
    }).then((b) => {
      bridge.current = b;
    });
  }, []);

  const openBank = async () => {
    if (!start) return;
    setOpened(true);
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
  return (
    <div className="p-3">
      <p>Log in to your bank to approve access to your account information.</p>
      <button type="button" className="btn btn-primary" onClick={() => void openBank()}>
        <i className="bi bi-bank me-2" aria-hidden="true" />
        {opened ? "Open bank login again" : "Connect bank"}
      </button>
      <p className="small text-body-secondary mt-2 mb-0">
        When you have approved access at your bank, come back and tell the assistant you are done.
      </p>
    </div>
  );
}
