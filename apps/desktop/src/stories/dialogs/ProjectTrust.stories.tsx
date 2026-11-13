import type { Meta } from "@storybook/react-vite";
import { useState } from "react";
import { ProjectTrustPrompt } from "../../mainview/ProjectTrustPrompt";
import { useStore } from "../../mainview/store";
import type { UIRequest } from "../../shared/extension-ui";
import "../../mainview/sdk-ui.css";

useStore.setState((state) => ({
  settings: { ...state.settings, language: "ja" },
}));

type Resources = Extract<UIRequest, { kind: "project-trust" }>["resources"];
const cwd =
  "C:\\Users\\gummy\\ghq\\github.com\\cotrin8672\\url-product-compare";
const single: Resources = [{ kind: "instructions", path: `${cwd}\\AGENTS.md` }];
const many: Resources = [
  { kind: "code", path: `${cwd}\\.pi\\extensions\\review.ts` },
  { kind: "code", path: `${cwd}\\.pi\\extensions\\deploy-guard.ts` },
  { kind: "settings", path: `${cwd}\\.pi\\settings.json` },
  { kind: "instructions", path: `${cwd}\\AGENTS.md` },
  { kind: "instructions", path: `${cwd}\\packages\\web\\AGENTS.md` },
  { kind: "skill", path: `${cwd}\\.pi\\skills\\release\\SKILL.md` },
  { kind: "skill", path: `${cwd}\\.pi\\skills\\scraper\\SKILL.md` },
  { kind: "prompt", path: `${cwd}\\.pi\\prompts\\fix-issue.md` },
  { kind: "prompt", path: `${cwd}\\.pi\\prompts\\compare.md` },
  { kind: "instructions", path: "C:\\Users\\gummy\\.pi\\agent\\AGENTS.md" },
];

function Dialog({ resources }: { resources: Resources }) {
  const [remember, setRemember] = useState(true);
  return (
    <div className="sdk-request trust-request" role="dialog">
      <ProjectTrustPrompt
        cwd={cwd}
        resources={resources}
        remember={remember}
        onRemember={setRemember}
        submitting={false}
        onCancel={() => {}}
        onSafe={() => {}}
        onAccept={() => {}}
      />
    </div>
  );
}

export default {
  title: "Dialogs/Project Trust",
  parameters: { gallery: true },
} satisfies Meta;

export const Single = () => <Dialog resources={single} />;
export const ManyFiles = () => <Dialog resources={many} />;
