import { createFileRoute } from "@tanstack/react-router";
import { EnvironmentId } from "@t3tools/contracts";
import { GlobalTerminalPanel } from "../components/terminal/GlobalTerminalPanel";

export const Route = createFileRoute("/global-terminal/$environmentId")({
  validateSearch: (search: Record<string, unknown>): { terminalId?: string } =>
    typeof search.terminalId === "string" ? { terminalId: search.terminalId } : {},
  component: GlobalTerminalRoute,
});

function GlobalTerminalRoute() {
  const { environmentId } = Route.useParams();
  const { terminalId } = Route.useSearch();
  return (
    <div className="h-dvh">
      <GlobalTerminalPanel
        environmentId={EnvironmentId.make(environmentId)}
        terminalId={terminalId}
      />
    </div>
  );
}
