import { useT } from "../../mainview/i18n";
import { shellTip, ToolBlock } from "../../mainview/ToolBlock";
import { TooltipBody, tooltipClass } from "../../mainview/Tooltip";

/** The clipped-command Tooltip of shell headers, pinned under the real header. */
export type ShellPhase = "running" | "done" | "error";
type Sample = {
  shell: "bash" | "powershell";
  command: string;
  timeout?: number;
  seconds: number;
  exitCode: number;
  output: string;
};

const samples: Sample[] = [
  {
    shell: "bash",
    command:
      "pnpm --filter @pig/desktop exec vitest run src/mainview/ToolBlock.test.tsx src/mainview/tooltip-ui.test.ts --reporter=verbose --coverage.enabled=false",
    timeout: 120,
    seconds: 12.4,
    exitCode: 1,
    output:
      " ✓ ToolBlock.test.tsx (12)\n × tooltip-ui.test.ts (3)\n\n Tests  1 failed | 14 passed",
  },
  {
    shell: "powershell",
    command: [
      "Get-ChildItem apps/desktop/src -Recurse -File -Filter *.test.ts |",
      "  Where-Object { $_.Length -gt 4kb } |",
      "  Sort-Object Length -Descending |",
      "  Select-Object -First 20 Name, Length",
    ].join("\n"),
    seconds: 0.8,
    exitCode: 1,
    output:
      "Name             Length\n----             ------\napp.test.ts        1824",
  },
];

function toolData(sample: Sample, phase: ShellPhase) {
  const exitCode = phase === "done" ? 0 : sample.exitCode;
  const text =
    phase === "done"
      ? sample.output
      : `${sample.output}\nCommand exited with code ${exitCode}`;
  return {
    call: {
      id: `${sample.shell}-${phase}`,
      name: sample.shell,
      arguments: { command: sample.command, timeout: sample.timeout },
    },
    live: phase === "running",
    state:
      phase === "running"
        ? undefined
        : {
            status: phase,
            result: {
              content: [{ type: "text", text }],
              structuredContent: {
                exit_code: exitCode,
                wall_time_seconds: sample.seconds,
              },
            },
          },
  } as Parameters<typeof ToolBlock>[0];
}

export function ShellCommandTips({ phase }: { phase: ShellPhase }) {
  const t = useT();
  return (
    <div className="sct-grid">
      {samples.map((sample) => (
        <div key={sample.shell} className="sct-case">
          <div className="sct-chat">
            <ToolBlock {...toolData(sample, phase)} />
          </div>
          <div className={`${tooltipClass("detail")} sct-tip`}>
            <TooltipBody
              content={shellTip(t, {
                command: sample.command,
                language: sample.shell,
                status: phase,
                exitCode: phase === "error" ? sample.exitCode : undefined,
                seconds: phase === "running" ? undefined : sample.seconds,
                timeout: sample.timeout,
                lines: sample.output.split("\n").length,
              })}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
