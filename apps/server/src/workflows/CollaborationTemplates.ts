import { CollaborationTemplate, StartCollaborationRequirementInput } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Workflows from "./Workflows.ts";

export class CollaborationStorageError extends Schema.TaggedError<CollaborationStorageError>()(
  "CollaborationStorageError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Collaboration storage operation '${this.operation}' failed.`;
  }
}

type CollaborationError = Workflows.WorkflowError | CollaborationStorageError;

export class CollaborationTemplates extends Context.Service<
  CollaborationTemplates,
  {
    readonly list: Effect.Effect<
      { readonly templates: ReadonlyArray<CollaborationTemplate> },
      CollaborationError
    >;
    readonly create: (
      input: CollaborationTemplate,
    ) => Effect.Effect<{ readonly id: string }, CollaborationError>;
    readonly start: (
      input: typeof StartCollaborationRequirementInput.Type,
    ) => Effect.Effect<{ readonly runId: string }, CollaborationError>;
  }
>()("t3/workflows/CollaborationTemplates") {}

const isInputError = Schema.is(Workflows.WorkflowInputError);

const readTemplate = Schema.decodeEffect(CollaborationTemplate);

const encodeTemplate = Schema.encodeEffect(Schema.fromJsonString(CollaborationTemplate));

const readRequirement = Schema.decodeEffect(StartCollaborationRequirementInput);

const encodeRequirement = Schema.encodeEffect(
  Schema.fromJsonString(StartCollaborationRequirementInput),
);

const encodeSnapshot = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));

const decodeSnapshot = Schema.decodeEffect(Schema.fromJsonString(Schema.Json));

const decode = Schema.decodeEffect(Schema.fromJsonString(CollaborationTemplate));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* ServerSettings.ServerSettingsService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const workflows = yield* Workflows.Workflows;
  const enabled = Effect.gen(function* () {
    if (!(yield* settings.getSettings).workflowsEnabled) {
      return yield* new Workflows.WorkflowInputError({ problem: Workflows.OFF });
    }
  }).pipe(
    Effect.mapError((cause) =>
      isInputError(cause) ? cause : new CollaborationStorageError({ operation: "settings", cause }),
    ),
  );
  const storageError = (operation: string) => (cause: unknown) =>
    new CollaborationStorageError({ operation, cause });

  return CollaborationTemplates.of({
    list: Effect.gen(function* () {
      yield* enabled;
      const rows = yield* sql<{
        template_json: string;
      }>`SELECT template_json FROM collaboration_templates ORDER BY id`.pipe(
        Effect.mapError(storageError("list")),
      );
      const templates = yield* Effect.forEach(rows, (row) =>
        decode(row.template_json).pipe(Effect.mapError(storageError("decode"))),
      );
      return { templates };
    }).pipe(Effect.withSpan("CollaborationTemplates.list")),
    create: Effect.fn("CollaborationTemplates.create")(function* (input) {
      yield* enabled;
      const template = yield* readTemplate(input).pipe(
        Effect.mapError(
          () => new Workflows.WorkflowInputError({ problem: "Invalid collaboration template." }),
        ),
      );
      const json = yield* encodeTemplate(template).pipe(Effect.mapError(storageError("encode")));
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT INTO collaboration_templates (id, template_json) VALUES (${template.id}, ${json}) ON CONFLICT(id) DO NOTHING`;
            const rows = yield* sql<{
              template_json: string;
            }>`SELECT template_json FROM collaboration_templates WHERE id = ${template.id}`;
            if (rows[0]?.template_json !== json) {
              return yield* new Workflows.WorkflowInputError({
                problem: "Template id already belongs to a different template.",
              });
            }
            return { id: template.id };
          }),
        )
        .pipe(
          Effect.mapError((cause) => (isInputError(cause) ? cause : storageError("create")(cause))),
        );
    }),
    start: Effect.fn("CollaborationTemplates.start")(function* (request) {
      yield* enabled;
      const input = yield* readRequirement(request).pipe(
        Effect.mapError(
          () => new Workflows.WorkflowInputError({ problem: "Invalid collaboration requirement." }),
        ),
      );
      const project = yield* projects
        .get(input.projectId)
        .pipe(Effect.mapError(storageError("project")));
      if (Option.isNone(project)) {
        return yield* new Workflows.WorkflowInputError({
          problem: "Collaboration project is not registered.",
        });
      }
      const rows = yield* sql<{
        template_json: string;
      }>`SELECT template_json FROM collaboration_templates WHERE id = ${input.templateId}`.pipe(
        Effect.mapError(storageError("template")),
      );
      if (rows[0] === undefined) {
        return yield* new Workflows.WorkflowInputError({
          problem: "Collaboration template was not found.",
        });
      }
      const template = yield* decode(rows[0].template_json).pipe(
        Effect.mapError(storageError("decode")),
      );
      const canonicalRequest = yield* encodeRequirement(input).pipe(
        Effect.mapError(storageError("encode")),
      );
      const snapshot = yield* encodeSnapshot({
        template,
        project: input.projectId,
        title: input.title,
        description: input.description,
      }).pipe(Effect.mapError(storageError("encode")));
      const stored = yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT INTO collaboration_requirements (key, request_json, input_json) VALUES (${input.key}, ${canonicalRequest}, ${snapshot}) ON CONFLICT(key) DO NOTHING`;
            const saved = yield* sql<{
              request_json: string;
              input_json: string;
            }>`SELECT request_json, input_json FROM collaboration_requirements WHERE key = ${input.key}`;
            if (saved[0]?.request_json !== canonicalRequest) {
              return yield* new Workflows.WorkflowInputError({
                problem: "Requirement key already belongs to a different request.",
              });
            }
            return saved[0].input_json;
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            isInputError(cause) ? cause : storageError("reserve")(cause),
          ),
        );
      const payload = yield* decodeSnapshot(stored).pipe(Effect.mapError(storageError("decode")));
      return yield* workflows.start("team-collaboration", payload, {
        idempotencyKey: `collaboration:${input.key}`,
      });
    }),
  });
});

export const layer = Layer.effect(CollaborationTemplates, make);
