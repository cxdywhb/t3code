import { useAtomCommand } from "~/state/use-atom-command";
import type { EnvironmentId, PullRequestLabelCandidate, PullRequestRef } from "@t3tools/contracts";
import { CheckIcon, PlusIcon, TagIcon } from "lucide-react";
import { msg, useGT, useMessages } from "gt-react";
import { useState, type ReactNode } from "react";

import { m } from "~/i18n/messages";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useEnvironmentQuery } from "~/state/query";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  emptySelection,
  isSelected,
  changeBatches,
  selectionChanges,
  toggleSelection,
} from "@t3tools/client-runtime/pull-request-selection";

import { toastManager } from "../ui/toast";
import { PullRequestCandidatePicker } from "./PullRequestCandidatePicker";
import { readableFailure } from "./pullRequestDetail.logic";
import { pullRequestLabelColor } from "./pullRequestList.logic";

function matches(candidate: PullRequestLabelCandidate, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return (
    candidate.name.toLowerCase().includes(needle) ||
    (candidate.description ?? "").toLowerCase().includes(needle)
  );
}

export function PullRequestLabelPicker({
  environmentId,
  reference,
  allowed,
  canCreate,
  triggerText,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  allowed: boolean;
  canCreate: boolean;
  triggerText: ReactNode;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptySelection<PullRequestLabelCandidate>);

  const candidatesQuery = useEnvironmentQuery(
    open ? pullRequestEnvironment.labelCandidates({ environmentId, input: reference }) : null,
    useMessages(),
  );
  const setLabels = useAtomCommand(pullRequestEnvironment.setLabels, {
    reportFailure: false,
  });

  const newName = query.trim();
  const candidates = (candidatesQuery.data?.candidates ?? []).filter((entry) =>
    matches(entry, newName),
  );
  const createOption =
    canCreate &&
    !creating &&
    candidatesQuery.isSuccess &&
    newName &&
    !candidates.some((candidate) => candidate.name.toLowerCase() === newName.toLowerCase())
      ? { name: newName, create: true as const }
      : null;
  const send = async (labels: ReadonlyArray<PullRequestLabelCandidate>, applied: boolean) => {
    for (const batch of changeBatches(labels))
      await sendBatch(
        batch.map((label) => label.name),
        applied,
      );
  };
  const sendBatch = async (
    names: ReadonlyArray<string>,
    applied: boolean,
    createIfMissing?: true,
  ) => {
    const result = await setLabels({
      environmentId,
      input: {
        ...reference,
        labels: names,
        applied,
        ...(createIfMissing ? { createIfMissing } : {}),
      },
    });
    if (result._tag === "Success") return true;
    toastManager.add({
      type: "error",
      title: applied
        ? m(msg("Could not put {names} on", { names: names.join(", ") }))
        : m(msg("Could not take {names} off", { names: names.join(", ") })),
      description: readableFailure(
        squashAtomCommandFailure(result),
        m(msg("The host refused it. Check that you have triage access on this repository.")),
      ),
    });
    return false;
  };

  const create = (name: string) => {
    setCreating(true);
    return sendBatch([name], true, true)
      .then((created) => {
        if (created) {
          setQuery((current) => (current.trim() === name ? "" : current));
          candidatesQuery.refresh();
        }
      })
      .finally(() => setCreating(false));
  };

  const onOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) return;
    const latest = candidatesQuery.data?.candidates ?? [];
    const { add, remove } = selectionChanges(
      draft,
      (name, label) => latest.find((entry) => entry.name === name)?.isApplied ?? label.isApplied,
    );
    setDraft(emptySelection());
    // Adding first keeps the Labels row from showing empty between the two writes.
    void send(add, true).then(() => send(remove, false));
  };

  return (
    <PullRequestCandidatePicker<PullRequestLabelCandidate | { name: string; create: true }>
      icon={<TagIcon className="size-3.5" />}
      label={gt("Change labels")}
      triggerText={triggerText}
      allowed={allowed}
      disabledReason={gt("Changing labels needs triage access on this repository")}
      open={open}
      onOpenChange={onOpenChange}
      query={query}
      onQueryChange={setQuery}
      searchLabel={gt("Search labels")}
      isPending={creating || (candidatesQuery.isPending && candidatesQuery.data === null)}
      error={candidatesQuery.data === null ? candidatesQuery.error : null}
      candidates={createOption ? [...candidates, createOption] : candidates}
      emptyLabel={gt("This repository has no labels.")}
      noMatchLabel={gt("No label matches that.")}
      errorLabel={gt("The labels could not be read.")}
      truncated={candidatesQuery.data?.truncated === true}
      truncatedLabel={gt(
        "This repository has more labels than are listed here. Apply the rest on the host.",
      )}
      candidateKey={(candidate) => candidate.name}
      onSelect={(candidate) => {
        if ("create" in candidate) {
          void create(candidate.name);
          return;
        }
        setDraft((current) =>
          toggleSelection(current, candidate.name, candidate, candidate.isApplied),
        );
      }}
    >
      {(candidate) => {
        if ("create" in candidate) {
          return (
            <>
              <PlusIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {gt("Create label “{name}”", { name: candidate.name })}
              </span>
            </>
          );
        }
        const dot = pullRequestLabelColor(candidate.color);
        return (
          <>
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-muted-foreground"
              {...(dot ? { style: { backgroundColor: dot } } : {})}
            />
            <span className="min-w-0 flex-1 truncate">
              {candidate.name}
              {candidate.description ? (
                <span className="text-muted-foreground"> · {candidate.description}</span>
              ) : null}
            </span>
            {isSelected(draft, candidate.name, candidate.isApplied) ? (
              <CheckIcon
                aria-label={gt("Applied", { $context: "label is applied" })}
                className="size-3.5 shrink-0"
              />
            ) : null}
          </>
        );
      }}
    </PullRequestCandidatePicker>
  );
}
