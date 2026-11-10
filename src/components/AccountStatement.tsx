import { useEffect, useRef, useState } from "react";
import { connectWidget, type WidgetBridge } from "@quartal/plugin/widget";
import type { AccountStatement as Statement, StatementPrintLink } from "../tools/model/BankingModel.ts";
import StatementView from "./StatementView.tsx";

/**
 * Widget for the `getAccountStatement` tool: the statement (tiliote) as a document. MCP hosts run
 * widgets in a sandboxed iframe where `window.print()` is blocked, so the print button asks the
 * plugin for a short-lived print link and opens it in a browser tab, where the print dialog works.
 */
export default function AccountStatement() {
  const bridge = useRef<WidgetBridge<Statement> | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printState, setPrintState] = useState<"idle" | "opening" | "failed">("idle");

  useEffect(() => {
    void connectWidget<Statement>({
      name: "AccountStatementApp",
      version: "0.2.0",
      onResult: (s) => {
        setStatement(s);
        setError(null);
      },
      onError: setError,
    }).then((b) => {
      bridge.current = b;
    });
  }, []);

  const openPrintable = async () => {
    if (!statement || !bridge.current) return;
    setPrintState("opening");
    const link = await bridge.current
      .callTool<StatementPrintLink>("createStatementPrintLink", {
        accountId: statement.account.uid,
        dateFrom: statement.periodStart,
        dateTo: statement.periodEnd,
      })
      .catch(() => undefined);
    if (!link) {
      setPrintState("failed");
      return;
    }
    // Fall back to a plain new tab when the host cannot open links (error or rejection).
    const res = await bridge.current.app.openLink({ url: link.url }).catch(() => undefined);
    if (!res || res.isError) window.open(link.url, "_blank", "noopener");
    setPrintState("idle");
  };

  if (error) {
    return (
      <div className="alert alert-danger m-3" role="alert">
        {error}
      </div>
    );
  }
  if (!statement) return <div className="p-3 text-body-secondary">Preparing the account statement…</div>;
  return (
    <StatementView
      statement={statement}
      actions={
        <>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() => void openPrintable()}
            disabled={printState === "opening"}
          >
            <i className="bi bi-printer me-2" aria-hidden="true" />
            {printState === "opening" ? "Opening…" : "Print / save as PDF"}
          </button>
          {printState === "failed" ? (
            <span className="small text-danger" role="alert">
              Could not open the printable statement.
            </span>
          ) : null}
        </>
      }
    />
  );
}
