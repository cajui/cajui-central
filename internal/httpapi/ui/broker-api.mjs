import { t } from "./i18n.mjs";
export async function brokerSnapshot(state, signal) {
  const response = await fetch("/ui-api/broker", {
    headers: { "X-Cajui-Workspace": state.ui_token },
    signal: signal ?? AbortSignal.timeout(10000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(t("broker.load_error"));
  return response.json();
}
export async function receiverCredentials(state) {
  const response = await fetch("/ui-api/receiver-credentials", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cajui-Workspace": state.ui_token,
    },
    body: "{}",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(t("setup.credential_error"));
  return response.json();
}

export async function receiverStates(state) {
  const response = await fetch("/ui-api/receiver-states", {
    headers: { "X-Cajui-Workspace": state.ui_token },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(t("setup.check_error"));
  const result = await response.json();
  if (
    !Array.isArray(result.device_states) ||
    !Number.isFinite(Date.parse(result.generated_at))
  )
    throw new Error(t("setup.check_error"));
  return result;
}
