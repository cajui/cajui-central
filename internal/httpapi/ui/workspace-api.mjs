export async function saveWorkspace(state, path, value) {
  const response = await fetch(`/ui-api/${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Cajui-Workspace": state.ui_token,
    },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    if (response.status === 409)
      throw new Error(
        "These settings changed or the parent is not registered. Reload this page before saving again.",
      );
    if (response.status === 403)
      throw new Error(
        "Your editing session expired. Reload this local page and try again.",
      );
    if (response.status === 400)
      throw new Error("Check the names and selected items, then try again.");
    throw new Error(
      "Could not save. Your changes remain here; check the connection and retry.",
    );
  }
}
export function createDialog(root, title) {
  const dialog = document.createElement("dialog");
  dialog.className = "workspace-dialog";
  const heading = document.createElement("h2");
  heading.id = "workspace-dialog-title";
  heading.textContent = title;
  dialog.setAttribute("aria-labelledby", heading.id);
  const head = document.createElement("div");
  head.className = "dialog-head";
  head.append(heading);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "button";
  close.textContent = "Cancel";
  close.addEventListener("click", () => dialog.close());
  head.append(close);
  dialog.append(head);
  root.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  return dialog;
}
