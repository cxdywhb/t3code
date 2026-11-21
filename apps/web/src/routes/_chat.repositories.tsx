import { createFileRoute } from "@tanstack/react-router";

import { RepositoriesPage } from "../components/repositories/RepositoriesPage";

export const Route = createFileRoute("/_chat/repositories")({
  component: RepositoriesPage,
});
