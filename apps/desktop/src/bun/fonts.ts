import { execFile } from "node:child_process";

export function parseFontFamilies(output: string): string[] {
  try {
    return [
      ...new Set(
        output
          .split(/\r?\n/)
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b));
  } catch (cause) {
    throw new Error("Could not read installed font names.", { cause });
  }
}

export async function listFontFamilies(): Promise<string[]> {
  // shortcut: pig currently targets Windows; add native enumeration when supporting other OSes.
  if (process.platform !== "win32")
    throw new Error("Installed font discovery requires Windows.");
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$ErrorActionPreference = 'Stop'; " +
          "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); " +
          "Add-Type -AssemblyName PresentationCore; " +
          "[System.Windows.Media.Fonts]::SystemFontFamilies | " +
          "ForEach-Object { $_.Source; $_.FamilyNames.Values }",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
  return parseFontFamilies(output);
}
