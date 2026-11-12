/** "missing", "unreadable" and "invalid" are distinct: never treat them as empty. */
export type PiDataState = "ok" | "missing" | "unreadable" | "invalid";

export type PiDataAuthSource = {
  file: string;
  state: PiDataState;
  error?: string;
  /** Provider IDs only — never credential values. */
  missing: string[];
  same: string[];
  conflict: string[];
};

export type PiDataReport = {
  agentDir: string;
  agentDirSource: "env" | "default";
  authFile: string;
  authState: PiDataState;
  modelsFile: string;
  sessionDir: string;
  sessionDirSource: "env" | "settings" | "default";
  /** Old private pig profile, when it differs from the effective agent dir. */
  legacyDir?: string;
  legacyAuth: PiDataAuthSource[];
  legacySessions?: {
    state: PiDataState;
    error?: string;
    missing: number;
    same: number;
    conflict: number;
    invalid: number;
  };
  legacyModels: boolean;
  legacyDurable: boolean;
};

export type PiDataImportResult = { copied: number; skipped: number };
