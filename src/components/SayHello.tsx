import { useEffect, useState } from "react";
import { connectWidget } from "@quartal/plugin/widget";

/**
 * Widget for the `sayHello` tool: the MCP host runs the tool and delivers the result
 * (the greeting string) over the framework-agnostic `@quartal/plugin/widget` bridge.
 */
export default function SayHello() {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void connectWidget<string>({
      name: "SayHelloApp",
      version: "0.1.0",
      onResult: (greeting) => {
        setResult(greeting);
        setError(null);
      },
      onError: setError,
    });
  }, []);

  const style = { fontFamily: "system-ui, sans-serif", padding: "1rem" };
  if (error) {
    return (
      <div style={style} role="alert">
        {error}
      </div>
    );
  }
  return <div style={style}>{result ? <h2>{result}</h2> : "Waiting for the tool result…"}</div>;
}
