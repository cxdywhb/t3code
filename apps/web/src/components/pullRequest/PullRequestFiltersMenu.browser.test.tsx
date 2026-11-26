import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { CircleDotIcon, GitForkIcon, GlobeIcon, LayersIcon, ServerIcon } from "lucide-react";
import { useId } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

const state = vi.hoisted(() => ({
  updateSettings: vi.fn(),
}));

vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.updateSettings) as never,
}));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentsWithScope: () => new Set([EnvironmentId.make("env-1")]),
}));

import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { render } from "../../../test/render";
import { PullRequestFiltersMenu } from "./PullRequestListFilters";
import { usePullRequestOriginOnlyControl } from "./usePullRequestListView";

import "~/index.css";

function renderFiltersMenu(overrides?: {
  readonly originOnly?: boolean;
  readonly originOnlyVisible?: boolean;
  readonly originOnlyDisabled?: boolean;
  readonly onOriginOnly?: (originOnly: boolean) => void;
}) {
  return (
    <PullRequestFiltersMenu
      state="open"
      stateOptions={[{ value: "open", label: "Open", Icon: CircleDotIcon }]}
      onState={() => {}}
      involvement="all"
      involvementOptions={[{ value: "all", label: "All PRs", Icon: LayersIcon }]}
      onInvolvement={() => {}}
      filters={{}}
      onFilters={() => {}}
      optionScope={[]}
      host={undefined}
      hostOptions={[{ value: "__all_hosts__", label: "All hosts", Icon: GlobeIcon }]}
      onHost={() => {}}
      server={undefined}
      serverOptions={[{ value: "__all_servers__", label: "All servers", Icon: ServerIcon }]}
      onServer={() => {}}
      projects={[
        {
          id: ProjectId.make("p1"),
          environmentId: EnvironmentId.make("env-1"),
          workspaceRoot: "/repo",
          title: "Repo",
          faviconPath: null,
          projectIcon: null,
        },
      ]}
      projectId={undefined}
      projectEnvironmentId={undefined}
      unavailable={new Map()}
      onProject={() => {}}
      {...overrides}
    />
  );
}

describe("PullRequestFiltersMenu origin-only control", () => {
  it("shows, counts off-default state, and toggles the origin remote filter when visible", async () => {
    const onOriginOnly = vi.fn();
    await using screen = await render(
      renderFiltersMenu({
        originOnly: true,
        originOnlyVisible: true,
        onOriginOnly,
      }),
    );

    const trigger = page.getByRole("button", { name: "Filters" });
    await expect.element(trigger).not.toHaveTextContent("1");

    await userEvent.click(trigger);
    const originOnlyItem = page.getByRole("menuitemcheckbox", { name: "Origin remote only" });
    await expect.element(originOnlyItem).toBeInTheDocument();
    await expect.element(originOnlyItem).toHaveAttribute("aria-checked", "true");
    expect(originOnlyItem.element().querySelector("svg")).not.toBeNull();
    await userEvent.click(originOnlyItem);
    expect(onOriginOnly).toHaveBeenCalledWith(false);

    await screen.rerender(
      renderFiltersMenu({
        originOnly: false,
        originOnlyVisible: true,
        onOriginOnly,
      }),
    );
    await expect
      .element(page.getByRole("button", { name: /Filters/ }))
      .toHaveTextContent("Filters1");
  });

  it("disables the origin remote filter when originOnlyDisabled is true", async () => {
    const onOriginOnly = vi.fn();
    await using _screen = await render(
      renderFiltersMenu({
        originOnly: true,
        originOnlyVisible: true,
        originOnlyDisabled: true,
        onOriginOnly,
      }),
    );

    await userEvent.click(page.getByRole("button", { name: "Filters" }));
    const originOnlyItem = page.getByRole("menuitemcheckbox", { name: "Origin remote only" });
    await expect.element(originOnlyItem).toHaveAttribute("aria-disabled", "true");
  });
});

function OriginOnlySwitchHarness({ pullRequestOriginOnly }: { pullRequestOriginOnly: boolean }) {
  const id = useId();
  const control = usePullRequestOriginOnlyControl([
    {
      environmentId: EnvironmentId.make("env-1"),
      serverConfig: {
        settings: {
          ...DEFAULT_SERVER_SETTINGS,
          pullRequestOriginOnly,
        },
      },
    } as never,
  ]);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <label htmlFor={id}>
            <GitForkIcon aria-hidden="true" />
            <span>Origin only</span>
            <Switch
              id={id}
              size="sm"
              aria-label="Origin only"
              checked={control.checked}
              mixed={control.mixed}
              disabled={control.disabled}
              onCheckedChange={(checked) => {
                void control.toggle(Boolean(checked));
              }}
            />
          </label>
        }
      />
      <TooltipPopup>Ignore upstream remotes</TooltipPopup>
    </Tooltip>
  );
}

describe("usePullRequestOriginOnlyControl", () => {
  it("sends { environmentId, input: { patch } } and updates optimistically when clicked", async () => {
    const deferred = Promise.withResolvers<{
      readonly _tag: "Success";
      readonly value: undefined;
    }>();
    state.updateSettings.mockReset();
    state.updateSettings.mockReturnValueOnce(deferred.promise);

    await using _screen = await render(<OriginOnlySwitchHarness pullRequestOriginOnly={true} />);
    const toggle = page.getByRole("switch", { name: "Origin only" });
    await expect.element(toggle).toHaveAttribute("aria-checked", "true");

    await userEvent.click(page.getByText("Origin only"));
    expect(state.updateSettings).toHaveBeenCalledWith({
      environmentId: EnvironmentId.make("env-1"),
      input: { patch: { pullRequestOriginOnly: false } },
    });
    await expect.element(toggle).toHaveAttribute("aria-checked", "false");

    deferred.resolve({ _tag: "Success", value: undefined });
  });
});
