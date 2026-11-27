import { createFileRoute } from "@tanstack/react-router";
import { AgentSettingsPanel } from "../components/settings/AgentSettings";

export const Route = createFileRoute("/_chat/settings/agents")({
  component: AgentSettingsPanel,
});
