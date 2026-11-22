const button = document.querySelector("button");
button.addEventListener("click", async () => {
  let isolated = false;
  try {
    void parent.document;
  } catch (error) {
    isolated = error.name === "SecurityError";
  }
  const api = window.__TAURI_INTERNALS__;
  let ipc = "absent";
  if (typeof api?.invoke === "function") {
    ipc = await Promise.race([
      api.invoke("preview_ipc_ping", { frame: true }).then(
        () => "accepted",
        () => "rejected",
      ),
      new Promise((resolve) => setTimeout(() => resolve("no reply"), 750)),
    ]);
  }
  button.textContent =
    isolated && ipc !== "accepted" ? "隔離を確認" : "隔離に失敗";
  parent.postMessage(
    {
      type: "pig-tauri-preview-isolation",
      isolated,
      ipc,
    },
    "*",
  );
});
button.click();
