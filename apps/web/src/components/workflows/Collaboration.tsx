import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { workflowRunState } from "@t3tools/client-runtime/workflows";
import { ChevronRightIcon, ListOrderedIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useGT, useMessages } from "gt-react";
import { formatDateTimeTimestamp } from "../../timestampFormat";
import { randomUUID } from "../../lib/utils";
import { useEffect, useRef, useState } from "react";
import { useProjects } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogPanel } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

const newStage = () => ({ id: randomUUID(), role: "", instruction: "" });

export function Collaboration({
  environmentId,
  onSelect,
}: {
  readonly environmentId: EnvironmentId;
  readonly onSelect: (id: string) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const templates = useEnvironmentQuery(
    serverEnvironment.collaborationTemplates({ environmentId, input: {} }),
  );
  const live = useEnvironmentQuery(serverEnvironment.workflowsLive({ environmentId, input: {} }));
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const canCreate = useAtomValue(
    serverEnvironment.createCollaborationTemplate.permissionAtom(environmentId),
  );
  const canStart = useAtomValue(
    serverEnvironment.startCollaborationRequirement.permissionAtom(environmentId),
  );
  const create = useAtomCommand(serverEnvironment.createCollaborationTemplate);
  const start = useAtomCommand(serverEnvironment.startCollaborationRequirement);
  const [form, setForm] = useState<"template" | "requirement" | null>(null);
  const [name, setName] = useState("");
  const [stages, setStages] = useState(() => [newStage()]);
  const [templateId, setTemplateId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState<string | null>(null);
  const lock = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const templateKey = useRef(randomUUID());
  const selectedTemplateId = templateId || templates.data?.templates[0]?.id || "";
  const project = projects.find((item) => item.id === projectId);
  const online = Boolean(live.data) && !live.error;
  const visible = live.data?.runs.find((run) => run.runId === launched);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the detail route resolves the run from the websocket snapshot, which can arrive after the launch response
  useEffect(() => {
    if (visible) onSelect(visible.runId);
  }, [visible, onSelect]);
  async function save() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const result = await create({
      environmentId,
      input: {
        id: templateKey.current,
        name: name.trim(),
        stages: stages.map((s) => ({ role: s.role.trim(), instruction: s.instruction.trim() })),
      },
    });
    lock.current = false;
    setBusy(false);
    if (result._tag === "Failure") {
      setError(String(squashAtomCommandFailure(result)));
      return;
    }
    setTemplateId(templateKey.current);
    templateKey.current = randomUUID();
    setName("");
    setStages([newStage()]);
    setForm(null);
  }
  async function launch() {
    if (lock.current) return;
    if (!project) return;
    const input = {
      templateId: selectedTemplateId,
      projectId: project.id,
      title: title.trim(),
      description: description.trim(),
    };
    const payload = JSON.stringify(input);
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: randomUUID() };
    lock.current = true;
    setBusy(true);
    setError(null);
    const result = await start({ environmentId, input: { ...input, key: attempt.current.key } });
    lock.current = false;
    setBusy(false);
    if (result._tag === "Failure") {
      setError(String(squashAtomCommandFailure(result)));
      return;
    }
    setLaunched(result.value.runId);
  }
  const selected = templates.data?.templates.find((template) => template.id === selectedTemplateId);
  const runs = live.data?.runs.filter(
    (run) =>
      run.workflow === "team-collaboration" && run.tags?.includes(`template:${selectedTemplateId}`),
  );
  return (
    <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-7">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              {gt("Collaboration workflows")}
            </h1>
            <p role="status" className="mt-1 text-xs text-muted-foreground">
              {live.error ?? (online ? gt("Connected · Live updates") : gt("Connecting…"))}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={!canCreate || !online}
            onClick={() => {
              setError(null);
              setForm("template");
            }}
          >
            <PlusIcon />
            {gt("New template")}
          </Button>
        </header>
        {(!form && error) || templates.error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {templates.error ?? error}
          </p>
        ) : null}
        {!canCreate || !canStart ? (
          <p className="text-sm text-muted-foreground">
            {gt("You do not have permission to manage collaboration workflows.")}
          </p>
        ) : null}
        <div className="grid overflow-hidden rounded-xl border sm:grid-cols-[minmax(12rem,1fr)_2fr]">
          <section className="min-w-0 space-y-2 bg-muted/25 p-4 sm:border-r">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{gt("Templates")}</h2>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={gt("Refresh")}
                onClick={templates.refresh}
              >
                <RefreshCwIcon />
              </Button>
            </div>
            {templates.data?.templates.map((template) => (
              <button
                type="button"
                key={template.id}
                aria-pressed={selected?.id === template.id}
                onClick={() => setTemplateId(template.id)}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-start text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:font-medium"
              >
                <ListOrderedIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 break-words">{template.name}</span>
                <ChevronRightIcon aria-hidden className="size-3.5 shrink-0" />
              </button>
            ))}
            {templates.data?.templates.length === 0 && (
              <p className="py-2 text-sm text-muted-foreground">
                {gt("Create your first collaboration template.")}
              </p>
            )}
          </section>
          <section className="min-w-0 space-y-4 border-t p-4 sm:border-t-0 sm:p-5">
            {selected && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-semibold break-words">{selected.name}</h2>
                  <Button
                    size="sm"
                    disabled={!canStart || !online}
                    onClick={() => {
                      setError(null);
                      setForm("requirement");
                    }}
                  >
                    <PlusIcon />
                    {gt("New requirement")}
                  </Button>
                </div>
                <ol className="divide-y">
                  {selected.stages.map((stage, index) => (
                    <li
                      key={JSON.stringify([selected.id, stage.role, index])}
                      className="flex gap-3 py-3"
                    >
                      <span className="grid size-6 shrink-0 place-content-center rounded-full bg-muted text-xs tabular-nums">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-medium break-words">{stage.role}</h3>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                          {stage.instruction}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </section>
        </div>
        <Dialog
          open={form !== null}
          onOpenChange={(open) => {
            if (!open && !busy) setForm(null);
          }}
        >
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>
                {form === "template" ? gt("New template") : gt("New requirement")}
              </DialogTitle>
            </DialogHeader>
            <DialogPanel>
              {error ? <p role="alert">{error}</p> : null}
              <div className="space-y-3">
                {form === "template" ? (
                  <>
                    <Input
                      maxLength={120}
                      aria-label={gt("Template name")}
                      placeholder={gt("Template name")}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                    {stages.map((stage, index) => (
                      <fieldset key={stage.id} className="space-y-2 rounded border p-3">
                        <legend>{index + 1}</legend>
                        <Input
                          maxLength={80}
                          aria-label={gt("Role")}
                          placeholder={gt("Role")}
                          value={stage.role}
                          onChange={(event) =>
                            setStages(
                              stages.map((item, i) =>
                                i === index ? { ...item, role: event.target.value } : item,
                              ),
                            )
                          }
                        />
                        <Textarea
                          maxLength={20000}
                          aria-label={gt("Task instructions")}
                          placeholder={gt("Task instructions")}
                          value={stage.instruction}
                          onChange={(event) =>
                            setStages(
                              stages.map((item, i) =>
                                i === index ? { ...item, instruction: event.target.value } : item,
                              ),
                            )
                          }
                        />
                        <Button
                          variant="outline"
                          disabled={stages.length === 1}
                          onClick={() => setStages(stages.filter((_, i) => i !== index))}
                        >
                          {gt("Remove role")}
                        </Button>
                      </fieldset>
                    ))}
                    <Button
                      variant="outline"
                      disabled={stages.length >= 12}
                      onClick={() => setStages([...stages, newStage()])}
                    >
                      {gt("Add role")}
                    </Button>
                    <Button
                      disabled={
                        busy ||
                        !online ||
                        !canCreate ||
                        !name.trim() ||
                        stages.some((stage) => !stage.role.trim() || !stage.instruction.trim())
                      }
                      onClick={() => void save()}
                    >
                      {gt("Save template")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Select value={projectId} onValueChange={(value) => setProjectId(value ?? "")}>
                      <SelectTrigger aria-label={gt("Select project")}>
                        <SelectValue>{project?.title ?? gt("Select project")}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {project.title}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                    <Input
                      maxLength={200}
                      aria-label={gt("Requirement title")}
                      placeholder={gt("Requirement title")}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                    <Textarea
                      maxLength={50000}
                      aria-label={gt("Requirement description")}
                      placeholder={gt("Requirement description")}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                    <Button
                      disabled={
                        busy ||
                        !online ||
                        !canStart ||
                        launched !== null ||
                        !selectedTemplateId ||
                        !project ||
                        !title.trim() ||
                        !description.trim()
                      }
                      onClick={() => void launch()}
                    >
                      {busy || launched ? gt("Submitting…") : gt("Start collaboration")}
                    </Button>
                  </>
                )}
              </div>
            </DialogPanel>
          </DialogPopup>
        </Dialog>
        {selected && (
          <section className="space-y-2">
            <h2 className="font-semibold">{gt("Tasks")}</h2>
            {runs?.length === 0 && (
              <p className="rounded-lg border px-4 py-5 text-sm text-muted-foreground">
                {gt("No workflow runs yet")}
              </p>
            )}
            <div className="divide-y">
              {runs?.map((run) => (
                <button
                  key={run.runId}
                  type="button"
                  onClick={() => onSelect(run.runId)}
                  className="flex w-full cursor-pointer flex-wrap items-center gap-3 rounded-md px-3 py-3 text-start text-sm hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="min-w-0 flex-1 font-medium break-words">{run.title}</span>
                  <span>
                    {
                      workflowRunState(
                        {
                          run,
                          questions:
                            live.data?.questions.filter((q) => q.runId === run.runId) ?? [],
                          children: [],
                        },
                        m,
                      ).word
                    }
                  </span>
                  <time dateTime={run.updatedAt} className="text-xs text-muted-foreground">
                    {formatDateTimeTimestamp(run.updatedAt, "locale")}
                  </time>
                  <ChevronRightIcon aria-hidden className="size-4" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
