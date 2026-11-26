import "~/index.css";

import { EnvironmentId, type PrReviewSkillDescriptor } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { render } from "../../../test/render";
import { useFavoriteReviewSkills } from "~/state/prReview";
import { SkillMultiPicker } from "./PrReviewLaunchModal";

const skills: PrReviewSkillDescriptor[] = Array.from({ length: 373 }, (_, index) => ({
  name: `skill-${index}`,
  displayName: `Skill ${index}`,
  description: "",
  source: "workspace",
  path: `/skills/${index}/SKILL.md`,
}));

it("searches beyond the first page and persists only chosen skills for preset bindings", async () => {
  const environmentId = EnvironmentId.make("skill-picker-test");
  function Picker({ catalog }: { catalog: boolean }) {
    const [favorites, save] = useFavoriteReviewSkills(environmentId);
    return (
      <SkillMultiPicker
        catalog={catalog}
        availableSkills={catalog ? skills : favorites}
        selectedNames={favorites.map((skill) => skill.name)}
        onChange={(names) => save(skills.filter((skill) => names.includes(skill.name)))}
      />
    );
  }
  await using catalog = await render(<Picker catalog />);
  expect(catalog.container.querySelectorAll('[role="checkbox"]')).toHaveLength(30);
  await catalog.getByRole("textbox").fill("372");
  await catalog.getByRole("checkbox").click();
  await catalog.unmount();
  await using preset = await render(<Picker catalog={false} />);
  expect(preset.container.querySelectorAll('[role="checkbox"]')).toHaveLength(1);
  await expect.element(preset.getByText("Skill 372")).toBeVisible();
  await preset.getByRole("checkbox").click();
  await expect.element(preset.getByText("Add favorite skills on the Presets tab.")).toBeVisible();
});
