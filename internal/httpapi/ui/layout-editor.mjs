import { escapeHTML as e } from "./model.mjs";
import { automaticSections, itemChoices } from "./workspace-model.mjs";
import { createDialog, saveWorkspace } from "./workspace-api.mjs";

export function openLayoutEditor(root, state) {
  const catalog = state.workspace,
    choices = itemChoices(catalog);
  let sections = structuredClone(
    catalog.layout.sections ?? automaticSections(catalog),
  );
  const dialog = createDialog(root, "Organize dashboard");
  dialog.classList.add("layout-dialog");
  const form = document.createElement("form");
  form.className = "workspace-form";
  form.innerHTML =
    '<p>Create sections and choose devices, complete sensors or individual measurements. Removing an item here keeps its registration and history.</p><div id="section-editor"></div><div class="top-actions"><button class="button" type="button" id="add-section">Add section</button><button class="button" type="button" id="automatic-layout">Use automatic layout</button></div><p class="form-error" role="alert"></p><button class="button primary" type="submit">Save dashboard</button>';
  dialog.append(form);
  const target = form.querySelector("#section-editor");
  function move(list, index, delta) {
    [list[index], list[index + delta]] = [list[index + delta], list[index]];
    render();
  }
  function render() {
    target.innerHTML = "";
    if (sections === null) {
      target.innerHTML =
        '<p class="notice">Automatic layout: registered sensors and devices will appear in separate sections.</p>';
      return;
    }
    if (!sections.length)
      target.innerHTML =
        "<p>No sections yet. Add one to start, or save an empty dashboard.</p>";
    sections.forEach((section, i) => {
      const field = document.createElement("fieldset");
      field.className = "section-editor";
      field.innerHTML = `<legend>Section ${i + 1}</legend><label>Section title<input class="input" maxlength="80" required value="${e(section.title)}"></label><div class="top-actions"><button class="button" type="button" data-up ${i === 0 ? "disabled" : ""} aria-label="Move section ${i + 1} up">Move up</button><button class="button" type="button" data-down ${i === sections.length - 1 ? "disabled" : ""} aria-label="Move section ${i + 1} down">Move down</button><button class="button" type="button" data-remove>Remove section</button></div><ol class="layout-items"></ol><div class="item-picker"><label>Add to this section<select class="input" ${choices.length ? "" : "disabled"}><option value="">Choose an item…</option>${choices.map((c, n) => `<option value="${n}">${e(c.label)}</option>`).join("")}</select></label><button class="button" type="button" data-add>Add item</button></div>`;
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
        li.innerHTML = `<span>${e(choice?.label ?? "Unavailable item")}</span><div class="top-actions"><button class="button" type="button" ${j === 0 ? "disabled" : ""} aria-label="Move item ${j + 1} up">↑</button><button class="button" type="button" ${j === section.items.length - 1 ? "disabled" : ""} aria-label="Move item ${j + 1} down">↓</button><button class="button" type="button" aria-label="Remove item ${j + 1}">Remove</button></div>`;
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
