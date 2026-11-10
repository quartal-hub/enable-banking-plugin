import { useEffect, useState } from "react";
import { connectWidget } from "@quartal/plugin/widget";
import type { AccountStatement as Statement } from "../tools/model/BankingModel.ts";
import StatementView from "./StatementView.tsx";

/** Widget for the `getAccountStatement` tool: the statement (tiliote) as a document */
export default function AccountStatement() {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void connectWidget<Statement>({
      name: "AccountStatementApp",
      version: "0.2.0",
      onResult: (s) => {
        setStatement(s);
        setError(null);
      },
      onError: setError,
    });
  }, []);

  if (error) {
    return (
      <div className="alert alert-danger m-3" role="alert">
        {error}
      </div>
    );
  }
  if (!statement) return <div className="p-3 text-body-secondary">Preparing the account statement…</div>;
  return <StatementView statement={statement} />;
}
