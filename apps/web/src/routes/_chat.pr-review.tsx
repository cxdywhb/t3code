import { createFileRoute } from "@tanstack/react-router";

import { PrReviewWorkstationPage } from "../components/prReview/PrReviewWorkstationPage";

export const Route = createFileRoute("/_chat/pr-review")({
  component: PrReviewWorkstationPage,
});
