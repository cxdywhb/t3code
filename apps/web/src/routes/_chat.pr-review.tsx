import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_chat/pr-review")({
  beforeLoad: () => {
    throw redirect({
      to: "/pull-requests",
      search: { involvement: "all", state: "all", reviewWorkspace: true },
      replace: true,
    });
  },
});
