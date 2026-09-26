import { t } from "./i18n.mjs";
export async function saveWorkspace(state, path, value) {
  let response;
  try {
    response = await fetch(`/ui-api/${path}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Cajui-Workspace": state.ui_token,
      },
      body: JSON.stringify(value),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error(t("errors.save"));
  }
  if (!response.ok) {
    if (response.status === 409) throw new Error(t("errors.conflict"));
    if (response.status === 403) throw new Error(t("errors.session"));
    if (response.status === 400) throw new Error(t("errors.invalid"));
    throw new Error(t("errors.save"));
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
  close.textContent = t("common.cancel");
  close.addEventListener("click", () => dialog.close());
  head.append(close);
  dialog.append(head);
  root.append(dialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  return dialog;
}

// Native validation bubbles use the browser UI language, not necessarily the
// page language. Supply messages for the constraints used by workspace forms.
export function localizeValidation(form) {
  form.addEventListener(
    "invalid",
    (event) => {
      const input = event.target;
      if (input.validity.valueMissing)
        input.setCustomValidity(t("errors.required"));
      else if (input.validity.tooLong)
        input.setCustomValidity(
          t("errors.too_long", { count: input.maxLength }),
        );
    },
    true,
  );
  form.addEventListener("input", (event) => {
    if (typeof event.target.setCustomValidity === "function")
      event.target.setCustomValidity("");
  });
}
