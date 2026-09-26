import catalogs from "./catalogs.mjs";

export const supportedLocales = Object.freeze(["en-US", "pt-BR"]);
let activeLocale = "en-US";

export function locale() {
  return activeLocale;
}
export function setLocale(value) {
  activeLocale = supportedLocales.includes(value) ? value : "en-US";
}

// Catalogs contain plain text. Callers escape the complete interpolated string
// when inserting HTML; names and identifiers are never translation keys.
export function t(key, values = {}) {
  const lookup = (language) => {
    const catalog = catalogs[language];
    const message = (name) =>
      Object.hasOwn(catalog, name) ? catalog[name] : undefined;
    if (Object.hasOwn(values, "count")) {
      if (values.count === 0 && message(`${key}.zero`))
        return message(`${key}.zero`);
      const category = new Intl.PluralRules(language).select(values.count);
      return (
        message(`${key}.${category}`) ?? message(`${key}.other`) ?? message(key)
      );
    }
    return message(key);
  };
  const message = lookup(activeLocale) ?? lookup("en-US") ?? key;
  return message.replace(/%\{([a-z_]+)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

export function metricLabel(metric, fallback) {
  const key = `metrics.${metric}`;
  return Object.hasOwn(catalogs["en-US"], key) ? t(key) : fallback;
}
