import { t } from "./i18n.mjs";
import { escapeHTML as e } from "./model.mjs";
import { automaticSections, itemChoices } from "./workspace-model.mjs";
import {
  createDialog,
  saveWorkspace,
  localizeValidation,
} from "./workspace-api.mjs";

export function openLayoutEditor(root, state) {
  const catalog = state.workspace,
    choices = itemChoices(catalog);
  let sections = structuredClone(
    catalog.layout.sections ?? automaticSections(catalog),
  );
  const dialog = createDialog(root, t("dashboard.organize"));
  dialog.classList.add("layout-dialog");
  const form = document.createElement("form");
  form.className = "workspace-form";
  localizeValidation(form);
  form.innerHTML = `<p>${t("layout.help")}</p><div id="section-editor"></div><div class="top-actions"><button class="button" type="button" id="add-section">${t("layout.add_section")}</button><button class="button" type="button" id="automatic-layout">${t("layout.automatic")}</button></div><p class="form-error" role="alert"></p><button class="button primary" type="submit">${t("layout.save")}</button>`;
  dialog.append(form);
  const target = form.querySelector("#section-editor");
  function move(list, index, delta) {
    [list[index], list[index + delta]] = [list[index + delta], list[index]];
    render();
  }
  function render() {
    target.innerHTML = "";
    if (sections === null) {
      target.innerHTML = `<p class="notice">${t("layout.automatic_note")}</p>`;
      return;
    }
    if (!sections.length) target.innerHTML = `<p>${t("layout.empty")}</p>`;
    sections.forEach((section, i) => {
      const field = document.createElement("fieldset");
      field.className = "section-editor";
      field.innerHTML = `<legend>${t("layout.section", { number: i + 1 })}</legend><label>${t("layout.title")}<input class="input" maxlength="80" required value="${e(section.title)}"></label><div class="top-actions"><button class="button" type="button" data-up ${i === 0 ? "disabled" : ""} aria-label="${t("layout.section_up", { number: i + 1 })}">${t("layout.up")}</button><button class="button" type="button" data-down ${i === sections.length - 1 ? "disabled" : ""} aria-label="${t("layout.section_down", { number: i + 1 })}">${t("layout.down")}</button><button class="button" type="button" data-remove>${t("layout.remove_section")}</button></div><ol class="layout-items"></ol><div class="item-picker"><label>${t("layout.add_to")}<select class="input" ${choices.length ? "" : "disabled"}><option value="">${t("layout.choose")}</option>${choices.map((c, n) => `<option value="${n}">${e(c.label)}</option>`).join("")}</select></label><button class="button" type="button" data-add>${t("layout.add_item")}</button></div>`;
      field
        .querySelector("input")
        .addEventListener(
          "input",
          (event) => (section.title = event.target.value),
        );
      field
        .querySelector("[data-up]")
        .addEventListener("click", () => move(sections, i, -1));
      field
        .querySelector("[data-down]")
        .addEventListener("click", () => move(sections, i, 1));
      field.querySelector("[data-remove]").addEventListener("click", () => {
        sections.splice(i, 1);
        render();
      });
      const list = field.querySelector("ol");
      section.items.forEach((item, j) => {
        const choice = choices.find(
          (c) => JSON.stringify(c.item) === JSON.stringify(item),
        );
        const li = document.createElement("li");
        li.innerHTML = `<span>${e(choice?.label ?? t("layout.unavailable"))}</span><div class="top-actions"><button class="button" type="button" ${j === 0 ? "disabled" : ""} aria-label="${t("layout.item_up", { number: j + 1 })}">↑</button><button class="button" type="button" ${j === section.items.length - 1 ? "disabled" : ""} aria-label="${t("layout.item_down", { number: j + 1 })}">↓</button><button class="button" type="button" aria-label="${t("layout.remove_item", { number: j + 1 })}">${t("layout.remove")}</button></div>`;
        const [up, down, remove] = li.querySelectorAll("button");
        up.addEventListener("click", () => move(section.items, j, -1));
        down.addEventListener("click", () => move(section.items, j, 1));
        remove.addEventListener("click", () => {
          section.items.splice(j, 1);
          render();
        });
        list.append(li);
      });
      field.querySelector("[data-add]").addEventListener("click", () => {
        const index = field.querySelector("select").value;
        if (index === "") return;
        const item = choices[Number(index)].item;
        if (
          !section.items.some(
            (old) => JSON.stringify(old) === JSON.stringify(item),
          ) &&
          section.items.length < 50
        ) {
          section.items.push({ ...item });
          render();
        }
      });
      target.append(field);
    });
  }
  form.querySelector("#add-section").addEventListener("click", () => {
    if (sections === null) sections = [];
    if (sections.length < 20) {
      sections.push({ title: "", items: [] });
      render();
      target.querySelector("fieldset:last-child input").focus();
    }
  });
  form.querySelector("#automatic-layout").addEventListener("click", () => {
    sections = null;
    render();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await saveWorkspace(state, "dashboard/layout", {
        revision: catalog.layout.revision,
        sections:
          sections?.map((s) => ({ ...s, title: s.title.trim() })) ?? null,
      });
      location.reload();
    } catch (error) {
      form.querySelector('[role="alert"]').textContent = error.message;
      button.disabled = false;
    }
  });
  render();
  dialog.showModal();
}
