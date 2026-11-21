import { createFileRoute } from "@tanstack/react-router";

import { IssueAutomationPage } from "../components/issueAutomation/IssueAutomationPage";

export const Route = createFileRoute("/_chat/issue-automation")({
  component: IssueAutomationPage,
});
