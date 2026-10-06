import { t } from "./i18n.mjs";
import { escapeHTML as e, receiverLabel } from "./model.mjs";
import { createDialog, localizeValidation } from "./workspace-api.mjs";
import { brokerSnapshot, receiverCredentials } from "./broker-api.mjs";
import { fetchSnapshot } from "./snapshot-api.mjs";

export async function openReceiverSetup(root, state, onDone) {
  const dialog = createDialog(root, t("setup.add"));
  dialog.classList.add("receiver-wizard");
  const body = document.createElement("div");
  body.className = "receiver-setup";
  dialog.append(body);
  body.innerHTML = `<p role="status">${t("setup.loading")}</p>`;
  dialog.showModal();
  let timer = null,
    busy = false,
    generation = 0,
    step = 1;
  let password = "",
    showPassword = false,
    host = "",
    port = 1883;
  const alive = () => dialog.isConnected && dialog.open;
  dialog.addEventListener(
    "close",
    () => {
      clearInterval(timer);
      generation++;
      password = "";
      body.replaceChildren();
    },
    { once: true },
  );
  try {
    const [broker, baseline] = await Promise.all([
      brokerSnapshot(state),
      fetchSnapshot("/receivers"),
    ]);
    if (!alive()) return;
    if (!broker.configured || !broker.connected) {
      body.innerHTML = `<p class="notice">${t(!broker.configured ? "setup.no_broker" : "setup.offline_broker")}</p><a class="button" href="/broker">${t("broker.title")}</a>`;
      return;
    }
    const openedAt = Date.parse(baseline.generated_at);
    const identity = (r) => JSON.stringify([r.source_id, r.device_id]);
    const alreadyOnline = new Set(
      (baseline.device_states ?? [])
        .filter(
          (r) =>
            r.role === "receiver" && r.availability === "online" && !r.retained,
        )
        .map(identity),
    );
    host = broker.receiver_host || "";
    port = broker.receiver_port || 1883;
    const titles = [
      "setup.connect_title",
      "setup.transfer_title",
      "setup.find_title",
    ];
    function notice(message) {
      if (!alive()) return;
      body.querySelector("#setup-error").textContent = message;
    }
    function render(focus = true) {
      clearInterval(timer);
      generation++;
      body.innerHTML = `<nav aria-label="${e(t("setup.progress"))}" class="receiver-progress"><ol>${titles.map((key, i) => `<li ${i + 1 === step ? 'aria-current="step"' : ""}><span>${i + 1}</span>${t(key)}</li>`).join("")}</ol></nav><section class="receiver-step"><h3 tabindex="-1" id="receiver-step-title">${t(titles[step - 1])}</h3><div id="receiver-step-content"></div><p id="setup-error" role="status"></p></section><footer class="receiver-footer"><button class="button" id="setup-back" ${step === 1 ? "hidden" : ""}>${t("setup.back")}</button><button class="button primary" id="setup-next" ${step === 3 ? "hidden" : ""}>${t(step === 1 ? "setup.wifi_ready" : "setup.settings_ready")}</button></footer>`;
      const content = body.querySelector("#receiver-step-content");
      if (step === 1) {
        content.innerHTML = `<p class="muted">${t("setup.on_phone")}</p><ol class="receiver-instructions"><li>${t("setup.press")}</li><li>${t("setup.join")}</li><li>${t("setup.open_page")}</li><li>${t("setup.save_wifi")}</li></ol><p class="muted">${t("setup.keep_open")}</p>`;
      } else if (step === 2) {
        content.innerHTML = `<p>${t("setup.transfer_hint")}</p><dl class="receiver-values" id="receiver-values"></dl><details class="receiver-address" ${host ? "" : "open"}><summary>${t(host ? "setup.change_address" : "setup.missing_address")}</summary><p class="muted">${t("setup.address_help")}</p><form id="receiver-address-form"><label>${t("setup.host")}<input class="input" name="host" value="${e(host)}" required maxlength="253" autocomplete="off"></label><label>${t("broker.port")}<input class="input" name="port" value="${e(port)}" required type="number" min="1" max="65535"></label><button class="button" type="submit">${t("setup.use_address")}</button></form></details><details class="receiver-help"><summary>${t("setup.help")}</summary><p>${t("setup.copy_devices")}</p><p>${t("setup.shared_credential")}</p><p>${t("setup.transport", { mode: broker.tls ? "TLS" : "TCP" })}</p></details>`;
        values();
        const form = content.querySelector("form");
        localizeValidation(form);
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const value = form.elements.host.value.trim();
          if (
            !value ||
            ["localhost", "broker", "127.0.0.1", "::1"].includes(
              value.toLowerCase(),
            ) ||
            /[\s/]/.test(value)
          ) {
            notice(t("setup.invalid_host"));
            return;
          }
          host = value;
          port = Number(form.elements.port.value);
          render();
        });
      } else {
        content.innerHTML = `<p class="muted">${t("setup.find_hint")}</p><div id="setup-result" role="status"></div><details class="receiver-help"><summary>${t("setup.not_found")}</summary><p>${t("setup.waiting")}</p></details>`;
        startSearch();
      }
      body.querySelector("#setup-back").addEventListener("click", () => {
        step--;
        showPassword = false;
        render();
      });
      body.querySelector("#setup-next").addEventListener("click", () => {
        if (step === 2 && !host) {
          notice(t("setup.invalid_host"));
          body.querySelector('[name="host"]').focus();
          return;
        }
        step++;
        showPassword = false;
        render();
      });
      if (focus) body.querySelector("h3").focus();
    }
    async function copy(value) {
      try {
        await navigator.clipboard.writeText(value);
        notice(t("setup.copied"));
      } catch {
        notice(t("setup.copy_error"));
      }
    }
    function values() {
      const dl = body.querySelector("#receiver-values");
      dl.replaceChildren();
      function row(label, value, copyValue = value) {
        const wrap = document.createElement("div");
        wrap.className = "receiver-value-row";
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value || "—";
        const actions = document.createElement("div");
        actions.className = "receiver-value-actions";
        if (copyValue) {
          const button = document.createElement("button");
          button.className = "button";
          button.textContent = t("setup.copy_value");
          button.setAttribute(
            "aria-label",
            t("setup.copy_field", { field: label }),
          );
          button.addEventListener("click", () => copy(copyValue));
          actions.append(button);
        }
        dd.append(actions);
        wrap.append(dt, dd);
        dl.append(wrap);
        return { dd, actions };
      }
      row(t("setup.host"), host);
      row(t("broker.port"), String(port));
      row(t("setup.user"), broker.receiver_username || "");
      const secret = row(
        t("setup.password"),
        password
          ? showPassword
            ? password
            : "••••••••••••"
          : t("setup.secret_hidden"),
        password,
      );
      if (broker.credentials_available) {
        const button = document.createElement("button");
        button.className = "button";
        button.id = "receiver-show";
        button.textContent = t(showPassword ? "setup.hide" : "setup.show");
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            if (!password) {
              const credential = await receiverCredentials(state);
              if (!alive()) return;
              password = credential.password;
              broker.receiver_username = credential.username;
            }
            if (step !== 2) return;
            showPassword = !showPassword;
            values();
            body.querySelector("#receiver-show").focus();
          } catch {
            notice(t("setup.credential_error"));
            button.disabled = false;
          }
        });
        secret.actions.append(button);
      } else {
        const help = document.createElement("p");
        help.className = "muted";
        help.textContent = t("setup.external_credentials");
        dl.after(help);
      }
    }
    function startSearch() {
      const attempt = generation;
      const result = body.querySelector("#setup-result");
      function showSearching() {
        const status = document.createElement("p");
        status.className = "receiver-search-status";
        const spinner = document.createElement("span");
        spinner.className = "receiver-search-spinner";
        spinner.setAttribute("aria-hidden", "true");
        status.append(spinner, document.createTextNode(t("setup.searching")));
        result.replaceChildren(status);
      }
      showSearching();
      async function check() {
        if (busy || !alive()) return;
        busy = true;
        try {
          const next = await fetchSnapshot("/receivers");
          if (!alive() || attempt !== generation) return;
          const matches = (next.device_states ?? []).filter(
            (r) =>
              r.role === "receiver" &&
              r.retained === false &&
              !alreadyOnline.has(identity(r)) &&
              r.availability === "online" &&
              Date.parse(r.received_at) >= openedAt,
          );
          const signature = JSON.stringify(matches.map(identity).sort());
          if (result.dataset.matches === signature) return;
          result.dataset.matches = signature;
          if (!matches.length) {
            showSearching();
            return;
          }
          result.replaceChildren();
          const p = document.createElement("p");
          p.textContent = t(
            matches.length
              ? matches.length === 1
                ? "setup.found_one"
                : "setup.found_many"
              : "setup.searching",
          );
          result.append(p);
          for (const receiver of matches) {
            const item = document.createElement("div");
            item.className = "panel";
            const name = receiverLabel(receiver.device_id);
            const details = document.createElement("p");
            details.textContent = `${name} · ${receiver.source_id} · ${receiver.device_id}`;
            const button = document.createElement("button");
            button.className = "button primary";
            button.textContent = t("setup.confirm", { name });
            button.addEventListener("click", () => {
              dialog.close();
              onDone();
            });
            item.append(details, button);
            result.append(item);
          }
        } catch {
          if (alive() && attempt === generation) {
            delete result.dataset.matches;
            result.textContent = t("setup.check_error");
          }
        } finally {
          busy = false;
        }
      }
      timer = setInterval(check, 2000);
      check();
    }
    render(false);
  } catch (err) {
    if (alive()) body.textContent = err.message;
  }
}
