import { assert, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import migration from "../persistence/Migrations/125_CollaborationTemplates.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as CollaborationTemplates from "./CollaborationTemplates.ts";
import * as Workflows from "./Workflows.ts";

const projectId = ProjectId.make("project");
const template = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "研发团队",
  stages: [{ role: "开发", instruction: "实现需求" }],
};
const request = {
  templateId: template.id,
  projectId,
  title: "需求",
  description: "实现功能",
  key: "request",
};
const project: ProjectStore.ProjectRow = {
  projectId,
  title: "Project",
  hasCustomTitle: false,
  workspaceRoot: "/project",
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  trackedFolders: [],
  pinnedAt: null,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};
const projects = Layer.succeed(ProjectStore.ProjectStoreV2, {
  apply: () => Effect.void,
  get: (id) => Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
  list: () => Effect.succeed([project]),
  findActiveByWorkspaceRoot: () => Effect.succeedNone,
  getShell: () => Effect.succeedNone,
  listShells: () => Effect.succeed([]),
});

it.effect("persists immutable templates and requirement keys across service rebuilds", () =>
  Effect.gen(function* () {
    yield* migration;
    const starts = new Map<string, unknown>();
    let calls = 0;
    const workflows = Layer.succeed(Workflows.Workflows, {
      ...Workflows.disabled,
      start: (_workflow, input, options) =>
        Effect.sync(() => {
          calls++;
          starts.set(options.idempotencyKey, input);
          return { runId: options.idempotencyKey };
        }),
    });
    const use = <A, E>(
      effect: Effect.Effect<A, E, CollaborationTemplates.CollaborationTemplates>,
    ) =>
      effect.pipe(
        Effect.provide(
          CollaborationTemplates.layer.pipe(Layer.provide(workflows), Layer.provide(projects)),
        ),
      );
    yield* use(
      Effect.gen(function* () {
        const service = yield* CollaborationTemplates.CollaborationTemplates;
        assert.deepStrictEqual(yield* service.list, { templates: [] });
        assert.deepStrictEqual(yield* service.create(template), { id: template.id });
        yield* Effect.all([service.create(template), service.create(template)], {
          concurrency: "unbounded",
        });
        assert.match(
          (yield* Effect.flip(service.create({ ...template, name: "other" }))).message,
          /different template/,
        );
        const first = yield* service.start(request);
        assert.deepStrictEqual(yield* service.start(request), first);
        assert.match(
          (yield* Effect.flip(service.start({ ...request, title: "other" }))).message,
          /different request/,
        );
        assert.match(
          (yield* Effect.flip(service.start({ ...request, projectId: ProjectId.make("missing") })))
            .message,
          /not registered/,
        );
        assert.match(
          (yield* Effect.flip(
            service.start({ ...request, templateId: "22222222-2222-4222-8222-222222222222" }),
          )).message,
          /not found/,
        );
        assert.match(
          (yield* Effect.flip(service.start({ ...request, key: " " }))).message,
          /Invalid collaboration requirement/,
        );
      }),
    );
    yield* use(
      Effect.gen(function* () {
        const service = yield* CollaborationTemplates.CollaborationTemplates;
        assert.deepStrictEqual(yield* service.list, { templates: [template] });
        yield* service.start(request);
        assert.match(
          (yield* Effect.flip(service.start({ ...request, description: "other" }))).message,
          /different request/,
        );
      }),
    );
    assert.equal(calls, 3);
    assert.equal(starts.size, 1);
    assert.deepStrictEqual([...starts.values()][0], {
      template,
      project: projectId,
      title: request.title,
      description: request.description,
    });
  }).pipe(
    Effect.provide(
      Layer.merge(
        ServerSettings.layerTest({ workflowsEnabled: true }),
        NodeSqliteClient.layer({ filename: ":memory:" }),
      ),
    ),
  ),
);

it.effect("refuses all operations while workflows are off without storing data", () =>
  Effect.gen(function* () {
    yield* migration;
    const settings = yield* ServerSettings.ServerSettingsService;
    const service = yield* CollaborationTemplates.CollaborationTemplates;
    for (const operation of [
      service.list.pipe(Effect.asVoid),
      service.create(template).pipe(Effect.asVoid),
      service.start(request).pipe(Effect.asVoid),
    ]) {
      assert.equal((yield* Effect.flip(operation)).message, Workflows.OFF);
    }
    yield* settings.updateSettings({ workflowsEnabled: true });
    assert.deepStrictEqual(yield* service.list, { templates: [] });
  }).pipe(
    Effect.provide(
      CollaborationTemplates.layer.pipe(
        Layer.provide(Layer.succeed(Workflows.Workflows, Workflows.disabled)),
        Layer.provide(projects),
        Layer.provideMerge(
          Layer.merge(
            ServerSettings.layerTest({ workflowsEnabled: false }),
            NodeSqliteClient.layer({ filename: ":memory:" }),
          ),
        ),
      ),
    ),
  ),
);
