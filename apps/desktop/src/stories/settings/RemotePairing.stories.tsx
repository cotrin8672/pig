import type { Meta } from "@storybook/react-vite";
import { Laptop, Link2 } from "lucide-react";
import { useState } from "react";
import { ContentPage } from "../../mainview/ContentPage";
import { ConfirmButton } from "../../mainview/patterns/ConfirmButton";
import { SettingsCard } from "../../mainview/patterns/SettingsCard";
import { SettingsRow } from "../../mainview/patterns/SettingsRow";
import { Button } from "../../mainview/primitives/Button";
import { SegmentedControl } from "../../mainview/primitives/SegmentedControl";
import { Switch } from "../../mainview/primitives/Switch";
import { TextField } from "../../mainview/primitives/TextField";
import { installPreview, previewDefaults } from "../current-ui/fixtures";
import SidebarPreview from "../current-ui/SidebarPreview";
import "../current-ui/preview.css";
import "./remote-pairing-story.css";

function Pairing({ registered = false }: { registered?: boolean }) {
  const [visible, setVisible] = useState(true);
  const [role, setRole] = useState<"host" | "client">("host");
  const [enabled, setEnabled] = useState(registered);
  const [expanded, expand] = useState(false);
  const [device, setDevice] = useState(registered);
  const [issued, issue] = useState(false);
  const [value, setValue] = useState("");
  const [message, report] = useState("");
  const host = role === "host";
  function close() {
    expand(false);
    setValue("");
    report("");
  }
  return (
    <SidebarPreview
      afterStatistics={
        <button
          type="button"
          className={`sidebar-icon ${visible ? "active" : ""}`}
          aria-label="Pairing"
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          <Link2 size={16} />
        </button>
      }
      main={
        visible && (
          <ContentPage title="Pairing" className="pairing-page">
            <div className="pairing-stack">
              <SegmentedControl
                aria-label="操作するPC"
                value={role}
                onChange={(next) => {
                  close();
                  setRole(next);
                }}
                options={[
                  { value: "host", label: "このPCを公開" },
                  { value: "client", label: "別PCに接続" },
                ]}
              />
              <SettingsCard>
                {host && (
                  <SettingsRow label="接続を受け付ける">
                    <label>
                      <Switch
                        aria-label="接続を受け付ける"
                        checked={enabled}
                        onChange={(event) => {
                          setEnabled(event.target.checked);
                          close();
                          issue(false);
                        }}
                      />
                    </label>
                  </SettingsRow>
                )}
                {(!host || enabled) && (
                  <SettingsRow label={host ? "別PCを招待" : "招待で接続"}>
                    <Button
                      aria-expanded={expanded}
                      aria-controls="pairing-invite"
                      onClick={() => (expanded ? close() : expand(true))}
                    >
                      {expanded
                        ? "閉じる"
                        : host
                          ? issued
                            ? "招待を見る"
                            : "招待を作る"
                          : "招待を入力"}
                    </Button>
                  </SettingsRow>
                )}
                <div
                  className="pairing-reveal"
                  data-open={expanded || undefined}
                  inert={!expanded}
                  id="pairing-invite"
                >
                  <div>
                    <div className="pairing-form">
                      {host ? (
                        <>
                          <small>
                            自分のPC専用。登録すると会話を読め、ホスト負担でツールを実行できます。
                          </small>
                          {issued ? (
                            <>
                              <code>PIG-DEMO</code>
                              <Button
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(
                                      "PIG-DEMO",
                                    );
                                    report("コピーしました");
                                  } catch {
                                    report(
                                      "コードを選択してコピーしてください",
                                    );
                                  }
                                }}
                              >
                                コピー
                              </Button>
                              <ConfirmButton
                                onConfirm={() => {
                                  issue(false);
                                  close();
                                }}
                              >
                                招待を取消
                              </ConfirmButton>
                            </>
                          ) : (
                            <Button
                              variant="primary"
                              onClick={() => issue(true)}
                            >
                              1回限りの招待を発行
                            </Button>
                          )}
                          <small>12時間有効</small>
                        </>
                      ) : (
                        <>
                          <TextField
                            aria-label="招待コード"
                            value={value}
                            placeholder="デモ用コード：PIG-DEMO"
                            onChange={(e) => {
                              setValue(e.target.value);
                              report("");
                            }}
                          />
                          <Button
                            disabled={!value.trim()}
                            variant="primary"
                            onClick={() => {
                              if (!issued || value.trim() !== "PIG-DEMO")
                                return report(
                                  "このPCで招待を発行してから入力してください",
                                );
                              setDevice(true);
                              issue(false);
                              close();
                            }}
                          >
                            登録
                          </Button>
                        </>
                      )}
                      <span role="status">{message}</span>
                    </div>
                  </div>
                </div>
              </SettingsCard>
              {device && (
                <SettingsCard>
                  <SettingsRow
                    label={
                      <span className="pairing-device">
                        <Laptop size={16} />
                        {host ? "研究室PC" : "自宅PC"} <small>登録済み</small>
                      </span>
                    }
                  >
                    {host && (
                      <ConfirmButton onConfirm={() => setDevice(false)}>
                        解除
                      </ConfirmButton>
                    )}
                  </SettingsRow>
                </SettingsCard>
              )}
            </div>
          </ContentPage>
        )
      }
    />
  );
}

export default {
  title: "Settings/Remote Pairing",
  parameters: { appPreview: true },
  beforeEach: () => installPreview(previewDefaults),
} satisfies Meta;

export const Off = { name: "初回", render: () => <Pairing /> };
// Keep the sidebar review permalink usable across redesigns.
export const SidebarEntryStates = {
  name: "サイドバーの Pairing",
  render: Off.render,
};
export const Connected = {
  name: "登録済み",
  render: () => <Pairing registered />,
};
