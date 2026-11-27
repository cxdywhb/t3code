import {
  AuthOrchestrationOperateScope,
  GLOBAL_AGENT_INSTRUCTIONS_MAX_LENGTH,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { useEnvironmentScope } from "../../state/session";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { useScopedSettings } from "./useScopedSettings";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";

export function AgentSettingsPanel() {
  const gt = useGT();
  const setting = useSearchableSetting();
  const { environment } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const saved = useScopedSettings((settings) => settings.globalAgentInstructions);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? saved;

  return (
    <SettingsPageContainer>
      <SettingsSection title={gt("Agent global settings")}>
        <SettingsRow
          serverScoped
          managed={
            !canOperate
              ? gt(
                  "This connection lacks permission to change settings on the selected environment.",
                )
              : undefined
          }
          settingKeys={["globalAgentInstructions"]}
          {...setting("global-agents-md")}
          description={gt(
            "Shared instructions for all projects and agents on this environment. Project instructions and your explicit requests take precedence.",
          )}
        >
          <div className="space-y-3 pt-3 pb-3.5">
            <Textarea
              aria-label={gt("Global AGENTS.md")}
              rows={12}
              value={value}
              disabled={saving || !canOperate}
              maxLength={GLOBAL_AGENT_INSTRUCTIONS_MAX_LENGTH}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              <T>
                Loaded when an agent session starts. Restart the app to apply changes to existing
                sessions. Leave empty to disable. Project files are not modified.
              </T>
            </p>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {gt("{count} / {max} characters", {
                  count: value.length,
                  max: GLOBAL_AGENT_INSTRUCTIONS_MAX_LENGTH,
                })}
              </p>
              <Button
                size="sm"
                disabled={saving || !canOperate || value === saved}
                onClick={() => {
                  setSaving(true);
                  updateSettings(
                    { globalAgentInstructions: value },
                    {
                      onFailed: () => setSaving(false),
                      onSaved: () => {
                        setSaving(false);
                        setDraft(null);
                        toastManager.add({ type: "success", title: gt("Saved") });
                      },
                    },
                  );
                }}
              >
                <T>Save</T>
              </Button>
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
