import {
  isSecretReference,
  type EnvironmentId,
  type SecretReference,
  type SettingsSecretValue,
} from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import {
  readHostCredentialSettings,
  type SourceControlDefinition,
  type SourceControlHostCredentials,
} from "@t3tools/client-runtime/source-control-clients";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SecretSourceInput, useSecretSources } from "./SecretSourceInput";

const hasToken = (token: SettingsSecretValue | undefined) =>
  typeof token === "string" ? token.length > 0 : token !== undefined;

function normalizeHostInput(rawHost: string): string {
  const trimmed = rawHost.trim();
  if (trimmed.length === 0) return "";
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes("/")) {
    try {
      const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      if (parsed.host) return parsed.host.toLowerCase();
    } catch {
      // Fall back to trimming slashes below.
    }
  }
  return trimmed.replace(/\/+$/u, "").toLowerCase();
}

export function SourceControlTokenSettings({
  environmentId,
  definition,
  credentials,
  onSaved,
}: {
  readonly environmentId: EnvironmentId;
  readonly definition: SourceControlDefinition;
  readonly credentials: SourceControlHostCredentials;
  readonly onSaved: () => void;
}) {
  const gt = useGT();
  // Translates each provider definition's English `tokenAccess`.
  const tokenAccess =
    definition.kind === "github"
      ? gt("read and write access to pull requests and contents")
      : definition.kind === "gitlab"
        ? gt("read_api (and read_repository for HTTPS clone)")
        : credentials.tokenAccess;
  const { tokens } = useEnvironmentSettings(environmentId, (settings) =>
    readHostCredentialSettings(settings, definition.kind),
  );
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: `save ${definition.label} token`,
  });
  const defaultHost = definition.publicHost ?? "";
  const [host, setHost] = useState(defaultHost);
  const secretSources = useSecretSources(environmentId);
  const [pending, setPending] = useState<{
    readonly key: string;
    readonly draft: string | SecretReference;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const normalizedHost = normalizeHostInput(host);
  const savedToken = tokens[normalizedHost];
  const isSaved = hasToken(savedToken);
  const savedHosts = Object.entries(tokens)
    .filter(([, value]) => hasToken(value))
    .map(([saved]) => saved);
  const sourceKey = JSON.stringify([normalizedHost, savedToken ?? ""]);
  const draft =
    pending?.key === sourceKey ? pending.draft : isSecretReference(savedToken) ? savedToken : "";
  const submission = typeof draft === "string" ? draft.trim() : draft;

  const save = async (target: string, token: SettingsSecretValue) => {
    setSaving(true);
    const result = await updateSettings({
      environmentId,
      // Send the whole map; other tokens' redaction markers preserve their values.
      input: {
        patch: {
          sourceControlHosts: { [definition.kind]: { tokens: { ...tokens, [target]: token } } },
        },
      },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setPending(null);
      onSaved();
    }
  };

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (normalizedHost && submission !== "") void save(normalizedHost, submission);
      }}
    >
      {/* Locked while saving: a successful save clears the draft, which would drop edits made mid-request. */}
      <fieldset disabled={saving} className="contents">
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          <T>
            A token saved here is used before{" "}
            <code className="rounded bg-muted px-1 py-px text-2xs">
              <Var>{credentials.tokenEnvVar}</Var>
            </code>{" "}
            and the{" "}
            <code className="rounded bg-muted px-1 py-px text-2xs">
              <Var>{credentials.cliName}</Var>
            </code>{" "}
            login, so <Var>{definition.label}</Var> works without the{" "}
            <Var>{credentials.cliLabel}</Var>. Give it <Var>{tokenAccess}</Var>.
          </T>{" "}
          {normalizedHost || defaultHost ? (
            <InlineButton
              render={
                <a
                  href={credentials.newTokenUrl(normalizedHost || defaultHost)}
                  target="_blank"
                  rel="noreferrer noopener"
                />
              }
            >
              <T>Create a token</T>
              <ExternalLinkIcon aria-hidden className="size-3" />
            </InlineButton>
          ) : null}
        </p>
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <div className="grid gap-1.5">
            <Label htmlFor={`${definition.kind}-token-host-${environmentId}`}>
              <T>Host</T>
            </Label>
            <Input
              id={`${definition.kind}-token-host-${environmentId}`}
              autoComplete="off"
              size="sm"
              placeholder={defaultHost}
              value={host}
              onChange={(event) => setHost(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${definition.kind}-token-${environmentId}`}>
              <T>Token</T>
            </Label>
            <SecretSourceInput
              id={`${definition.kind}-token-${environmentId}`}
              size="sm"
              aria-label={gt("{host} token", { host: definition.label })}
              environmentId={environmentId}
              configured={isSaved && !isSecretReference(savedToken)}
              value={draft}
              sources={secretSources}
              onChange={(event) => setPending({ key: sourceKey, draft: event.target.value })}
              onSecretChange={(secret) => setPending({ key: sourceKey, draft: secret ?? "" })}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {savedHosts.length === 0 ? (
              <span>
                {gt("No token saved; the server uses {envVar} or the {cliName} login.", {
                  envVar: credentials.tokenEnvVar,
                  cliName: credentials.cliName,
                })}
              </span>
            ) : (
              <>
                <span>{gt("Saved for:")}</span>
                {savedHosts.map((savedHost) => (
                  <button
                    key={savedHost}
                    type="button"
                    onClick={() => setHost(savedHost)}
                    className={`rounded border px-1.5 py-0.5 font-mono text-2xs transition-colors ${
                      savedHost === normalizedHost
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border bg-muted/50 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {savedHost}
                  </button>
                ))}
              </>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            {isSaved ? (
              <Button
                size="xs"
                variant="outline"
                disabled={saving}
                onClick={() => void save(normalizedHost, "")}
              >
                <T>Remove</T>
              </Button>
            ) : null}
            <Button
              type="submit"
              size="xs"
              disabled={!normalizedHost || submission === "" || saving}
            >
              <T>Save</T>
            </Button>
          </div>
        </div>
      </fieldset>
    </form>
  );
}
