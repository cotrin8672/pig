import { expect, test } from "bun:test";
import { patchNativeSource } from "../../scripts/windows-native";

const source = `view->setWebView(webview);
windowStyle = WS_VISIBLE | WS_CAPTION | WS_THICKFRAME | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
            // WebView2 operations must be called from main thread to avoid TYPE_E_BADVARTYPE
            MainThreadDispatcher::dispatch_async([this, frame]() {
                HRESULT result = controller->put_Bounds(frame);
                if (FAILED(result)) {
                    char errorLog[256];
                    sprintf_s(errorLog, "[WebView2] put_Bounds failed for webview %u, HRESULT: 0x%08X", webviewId, result);
                    ::log(errorLog);
                }
            });`;

test("native drag backport enables WebView2 regions and standard caption styles", () => {
  const patched = patchNativeSource(source);
  expect(patched).toContain("put_IsNonClientRegionSupportEnabled(TRUE)");
  expect(patched).toContain("ComPtr<ICoreWebView2Settings9>");
  expect(patched).toContain("WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX");
  expect(patched.match(/view->setWebView\(webview\);/g)).toHaveLength(1);
});

test("native resize runs inline on the UI thread and resolves current bounds", () => {
  const patched = patchNativeSource(source);
  expect(patched).toContain(
    "if (GetCurrentThreadId() == g_mainThreadId) applyBounds();",
  );
  expect(patched).toContain(
    "else MainThreadDispatcher::dispatch_async(applyBounds);",
  );
  expect(patched).toContain("RECT bounds = frame;");
  expect(patched).toContain(
    "if (fullSize && (!GetClientRect(hwnd, &bounds) || IsIconic(hwnd) || IsRectEmpty(&bounds))) return;",
  );
  expect(patched).toContain("controller->put_Bounds(bounds)");
  expect(patched).not.toContain("controller->put_Bounds(frame)");
  expect(patched).toContain("if (FAILED(result))");
  expect(patched).toContain("::log(errorLog);");
});

test("native resize patch rejects missing or ambiguous resize implementations", () => {
  const resize = source.slice(source.indexOf("            // WebView2"));
  expect(() => patchNativeSource(source.replace(resize, ""))).toThrow();
  expect(() => patchNativeSource(`${source}\n${resize}`)).toThrow();
});

test("native drag backport rejects unknown, ambiguous, and already-patched sources", () => {
  expect(() => patchNativeSource("")).toThrow(
    "Unexpected Electrobun native source",
  );
  expect(() => patchNativeSource(`${source}\n${source}`)).toThrow();
  expect(() => patchNativeSource(patchNativeSource(source))).toThrow();
});
