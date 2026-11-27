import {
  AuthOrchestrationOperateScope,
  GLOBAL_AGENT_INSTRUCTIONS_MAX_LENGTH,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useState } from "react";

import { useAtomValue } from "@effect/atom-react";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
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
  const supported =
    environment?.serverConfig?.environment.capabilities.globalAgentInstructions === true;
  const canWrite = useAtomValue(serverEnvironment.updateSettings.permissionAtom(environmentId));
  const editable = supported && canWrite && canOperate;
  const updateSettings = useAtomCommand(
    serverEnvironment.updateSettings,
    "global agent instructions update",
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? saved;

  return (
    <SettingsPageContainer>
      <SettingsSection title={gt("Agent global settings")}>
        <SettingsRow
          serverScoped
          managed={
            !supported
              ? gt("Update older servers to save this setting.")
              : !canWrite || !canOperate
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
              disabled={saving || !editable}
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
                disabled={saving || !editable || value === saved}
                onClick={async () => {
                  if (!environmentId || !editable) return;
                  setSaving(true);
                  const result = await updateSettings({
                    environmentId,
                    input: { patch: { globalAgentInstructions: value } },
                  });
                  setSaving(false);
                  if (result._tag !== "Success") return;
                  // 旧服务器可能成功响应却丢弃未知字段；确认回读一致后才能清除草稿。
                  if (result.value.globalAgentInstructions !== value) {
                    toastManager.add({
                      type: "error",
                      title: gt("Setting not saved"),
                      description: gt("Update older servers to save this setting."),
                    });
                    return;
                  }
                  setDraft(null);
                  toastManager.add({
                    type: "success",
                    title: gt("Saved", { $context: "settings save confirmation" }),
                  });
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
