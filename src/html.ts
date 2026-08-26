import type {
  BucketRow,
  LocalizedSiteName,
  MonitorRow,
  Snapshot,
} from "./schema.ts";
import { formatTimestamp } from "./time.ts";

interface OverallState {
  readonly label: string;
  readonly tone: string;
}

const uptimeIcon = `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17h6l3-7 5 13 3-7h5" /></svg>`;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
type Locale = "en" | "fr";

const frenchRange = (range: string): string =>
  range === "hours" ? "heures" : range === "days" ? "jours" : "minutes";

const copy = {
  en: {
    currentStatus: "Current status",
    summary: "Availability and uptime for every monitored service.",
    services: "Services",
    systemAvailability: "System availability",
    systems: "Systems",
    uptimeRange: "Uptime range",
    minutes: "Minutes",
    hours: "Hours",
    days: "Days",
    noMonitors: "No monitors have been configured yet.",
    operational: "Operational",
    majorOutage: "Major outage",
    awaitingCheck: "Awaiting first check",
    groupOperational: (operational: number, total: number) =>
      `${operational}/${total} operational`,
    aggregate: (range: string) => `90-${range.slice(0, -1)} aggregate`,
    ago: (range: string) => `90 ${range} ago`,
    now: "Now",
    noData: "No data",
    uptime: "uptime",
    failedChecks: (count: number) => `Failed check${count === 1 ? "" : "s"}`,
    uptimeFor: (range: string, name: string) =>
      `90-${range} uptime for ${name}`,
  },
  fr: {
    currentStatus: "État actuel",
    summary: "Disponibilité de chaque service surveillé.",
    services: "Services",
    systemAvailability: "Disponibilité des systèmes",
    systems: "Systèmes",
    uptimeRange: "Période de disponibilité",
    minutes: "Minutes",
    hours: "Heures",
    days: "Jours",
    noMonitors: "Aucun moniteur n’est encore configuré.",
    operational: "Opérationnel",
    majorOutage: "Panne majeure",
    awaitingCheck: "En attente du premier contrôle",
    groupOperational: (operational: number, total: number) =>
      `${operational}/${total} opérationnels`,
    aggregate: (range: string) => `Agrégat sur 90 ${frenchRange(range)}`,
    ago: (range: string) => `Il y a 90 ${frenchRange(range)}`,
    now: "Maintenant",
    noData: "Aucune donnée",
    uptime: "de disponibilité",
    failedChecks: (count: number) =>
      `Contrôle${count === 1 ? "" : "s"} échoué${count === 1 ? "" : "s"}`,
    uptimeFor: (range: string, name: string) =>
      `Disponibilité sur 90 ${frenchRange(range)} pour ${name}`,
  },
} as const;

const escapeHtml = (value: string | number): string =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatDuration = (minutes: number, locale: Locale): string => {
  const labels =
    locale === "fr"
      ? (["jour", "heure", "minute"] as const)
      : (["day", "hour", "minute"] as const);
  const units = [
    [Math.floor(minutes / (24 * 60)), labels[0]],
    [Math.floor((minutes % (24 * 60)) / 60), labels[1]],
    [minutes % 60, labels[2]],
  ] as const;
  return units
    .filter(([value]) => value > 0)
    .map(([value, unit]) => `${value} ${unit}${value === 1 ? "" : "s"}`)
    .join(" ");
};

export const overallState = (snapshot: Snapshot): OverallState => {
  const activeMonitors = snapshot.monitors.filter((monitor) => monitor.active);
  if (
    activeMonitors.length > 0 &&
    activeMonitors.every((monitor) => monitor.last_ok === 0)
  ) {
    return { label: "All Systems Are Experiencing Issues", tone: "major" };
  }
  if (activeMonitors.some((monitor) => monitor.last_ok === 0)) {
    return { label: "Some Systems Are Experiencing Issues", tone: "partial" };
  }
  if (activeMonitors.some((monitor) => monitor.last_ok === null)) {
    return { label: "Some Systems Are Awaiting Checks", tone: "unknown" };
  }
  return { label: "All Systems Operational", tone: "operational" };
};

const overallLabel = (state: OverallState, locale: Locale): string => {
  if (locale === "en") return state.label;
  switch (state.tone) {
    case "major":
      return "Tous les systèmes rencontrent des problèmes";
    case "partial":
      return "Certains systèmes rencontrent des problèmes";
    case "unknown":
      return "Certains systèmes attendent un contrôle";
    default:
      return "Tous les systèmes sont opérationnels";
  }
};

const renderBars = (
  monitor: MonitorRow,
  rows: ReadonlyArray<BucketRow>,
  interval: number,
  now: number,
  timeZone: string,
  locale: Locale,
): string => {
  const messages = copy[locale];
  const byBucket = new Map(
    rows
      .filter((row) => row.monitor_id === monitor.id)
      .map((row) => [row.bucket, row]),
  );
  const bars: Array<string> = [];
  for (let offset = 89; offset >= 0; offset--) {
    const bucket = Math.floor(now / interval) - offset;
    const timestamp = bucket * interval;
    const row = byBucket.get(bucket);
    const percent =
      row && row.total > 0 ? (row.successful / row.total) * 100 : null;
    const tone =
      percent === null
        ? "empty"
        : percent === 100
          ? "good"
          : percent >= 95
            ? "warn"
            : "bad";
    const label =
      percent === null
        ? messages.noData
        : `${percent.toFixed(2)}% ${messages.uptime}`;
    const failed = row ? row.total - row.successful : 0;
    const failures =
      failed > 0
        ? locale === "en"
          ? ` · ${messages.failedChecks(failed)}: ${formatDuration(failed, locale)}`
          : ` · ${messages.failedChecks(failed)} : ${formatDuration(failed, locale)}`
        : "";
    const separator = locale === "en" ? ": " : " : ";
    const tooltip = `${formatTimestamp(timestamp, timeZone, locale)}${separator}${label}${failures}`;
    bars.push(
      `<i class="uptime-bar ${tone}" role="img" aria-label="${escapeHtml(tooltip)}" data-tooltip="${escapeHtml(tooltip)}"></i>`,
    );
  }
  return bars.join("");
};

const aggregateUptime = (
  monitorIds: ReadonlySet<string>,
  rows: ReadonlyArray<BucketRow>,
  locale: Locale,
): string => {
  const messages = copy[locale];
  const monitorRows = rows.filter((row) => monitorIds.has(row.monitor_id));
  const total = monitorRows.reduce((sum, row) => sum + row.total, 0);
  const successful = monitorRows.reduce((sum, row) => sum + row.successful, 0);
  return total === 0
    ? messages.noData
    : `${((successful / total) * 100).toFixed(2)}% ${messages.uptime}`;
};

const monitorUptime = (
  monitorId: string,
  rows: ReadonlyArray<BucketRow>,
  locale: Locale,
): string => aggregateUptime(new Set([monitorId]), rows, locale);

const renderRange = (
  monitor: MonitorRow,
  rows: ReadonlyArray<BucketRow>,
  range: "minutes" | "hours" | "days",
  interval: number,
  now: number,
  timeZone: string,
  locale: Locale,
): string => `<div class="range-view" data-range-view="${range}">
    <div class="uptime-bars" aria-label="${escapeHtml(copy[locale].uptimeFor(range, monitor.name))}">${renderBars(monitor, rows, interval, now, timeZone, locale)}</div>
    <div class="range"><span>${copy[locale].ago(range)}</span><span>${monitorUptime(monitor.id, rows, locale)}</span><span>${copy[locale].now}</span></div>
  </div>`;

const renderMonitor = (
  monitor: MonitorRow,
  snapshot: Snapshot,
  now: number,
  timeZone: string,
  locale: Locale,
): string => {
  const tone =
    monitor.last_ok === null
      ? "unknown"
      : monitor.last_ok
        ? "operational"
        : "major";
  const messages = copy[locale];
  const label =
    monitor.last_ok === null
      ? messages.awaitingCheck
      : monitor.last_ok
        ? messages.operational
        : messages.majorOutage;
  return `<article class="component">
    <div class="component-line">
      <div class="component-name"><strong>${escapeHtml(monitor.name)}</strong><a href="${escapeHtml(monitor.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(monitor.url)}</a></div>
      <span class="component-status ${tone}"><i></i>${label}</span>
    </div>
    ${renderRange(monitor, snapshot.minutes, "minutes", MINUTE, now, timeZone, locale)}
    ${renderRange(monitor, snapshot.hours, "hours", HOUR, now, timeZone, locale)}
    ${renderRange(monitor, snapshot.days, "days", DAY, now, timeZone, locale)}
  </article>`;
};

const renderGroupAggregate = (
  monitors: ReadonlyArray<MonitorRow>,
  rows: ReadonlyArray<BucketRow>,
  range: "minutes" | "hours" | "days",
  locale: Locale,
): string => {
  const uptime = aggregateUptime(
    new Set(monitors.map((monitor) => monitor.id)),
    rows,
    locale,
  );
  return `<div class="group-aggregate range-view" data-range-view="${range}"><strong>${uptime}</strong><span>${copy[locale].aggregate(range)}</span></div>`;
};

const renderGroup = (
  group: string,
  monitors: ReadonlyArray<MonitorRow>,
  snapshot: Snapshot,
  now: number,
  timeZone: string,
  locale: Locale,
): string => {
  const operational = monitors.filter(
    (monitor) => monitor.last_ok === 1,
  ).length;
  return `<section class="service-group" aria-labelledby="group-${locale}-${escapeHtml(group)}">
    <div class="group-heading">
      <div class="group-title"><h3 id="group-${locale}-${escapeHtml(group)}">${escapeHtml(group)}</h3><span>${copy[locale].groupOperational(operational, monitors.length)}</span></div>
      ${renderGroupAggregate(monitors, snapshot.minutes, "minutes", locale)}
      ${renderGroupAggregate(monitors, snapshot.hours, "hours", locale)}
      ${renderGroupAggregate(monitors, snapshot.days, "days", locale)}
    </div>
    ${monitors.map((monitor) => renderMonitor(monitor, snapshot, now, timeZone, locale)).join("")}
  </section>`;
};

const renderLocalizedStatus = (
  snapshot: Snapshot,
  state: OverallState,
  groups: ReadonlyMap<string, ReadonlyArray<MonitorRow>>,
  now: number,
  timeZone: string,
  locale: Locale,
): string => {
  const messages = copy[locale];
  return `<div data-copy="${locale}"${locale === "fr" ? ' lang="fr"' : ""}>
    <section class="overall ${state.tone}">
      <span class="status-icon" aria-hidden="true">${uptimeIcon}</span>
      <p class="eyebrow">${messages.currentStatus}</p>
      <h1>${overallLabel(state, locale)}</h1>
      <p class="summary">${messages.summary}</p>
    </section>
    <section class="components" aria-label="${messages.systems}">
      <div class="section-heading"><div><p class="eyebrow">${messages.services}</p><h2>${messages.systemAvailability}</h2></div><div class="status-tools">
        <div class="range-controls" aria-label="${messages.uptimeRange}">
          <button type="button" data-range-button="minutes" aria-pressed="false">${messages.minutes}</button>
          <button type="button" data-range-button="hours" aria-pressed="false">${messages.hours}</button>
          <button type="button" data-range-button="days" aria-pressed="true">${messages.days}</button>
        </div>
      </div></div>
      ${
        snapshot.monitors.length === 0
          ? `<div class="empty-state">${messages.noMonitors}</div>`
          : [...groups]
              .map(([group, monitors]) =>
                renderGroup(group, monitors, snapshot, now, timeZone, locale),
              )
              .join("")
      }
    </section>
  </div>`;
};

export const renderStatus = (
  snapshot: Snapshot,
  now = Date.now(),
  timeZone = "UTC",
): string => {
  const state = overallState(snapshot);
  const groups = new Map<string, Array<MonitorRow>>();
  for (const monitor of snapshot.monitors) {
    const group = groups.get(monitor.group) ?? [];
    group.push(monitor);
    groups.set(monitor.group, group);
  }
  return `<main id="status-content" data-range="days">
    ${renderLocalizedStatus(snapshot, state, groups, now, timeZone, "en")}
    ${renderLocalizedStatus(snapshot, state, groups, now, timeZone, "fr")}
  </main>`;
};

export const renderPage = (
  siteName: LocalizedSiteName,
  content: string,
): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#6f5c51">
  <title>${escapeHtml(`${siteName.label} | ${siteName.en}`)}</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%3Crect%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%226%22%20fill%3D%22%236f5c51%22%2F%3E%3Cpath%20d%3D%22M5%2017h6l3-7%205%2013%203-7h5%22%20fill%3D%22none%22%20stroke%3D%22white%22%20stroke-width%3D%222.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&amp;display=swap">
  <script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.2/bundles/datastar.js"></script>
  <script>
    const uptimeRanges = new Set(["minutes", "hours", "days"]);
    let selectedUptimeRange = "days";
    let selectedLanguage = navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
    try {
      const savedRange = localStorage.getItem("uptime-range");
      if (savedRange && uptimeRanges.has(savedRange)) selectedUptimeRange = savedRange;
      const savedLanguage = localStorage.getItem("status-language");
      if (savedLanguage === "en" || savedLanguage === "fr") selectedLanguage = savedLanguage;
    } catch {}
    const applyUptimeRange = () => {
      const content = document.querySelector("#status-content");
      if (!content) return;
      content.dataset.range = selectedUptimeRange;
      for (const button of content.querySelectorAll("[data-range-button]")) {
        button.setAttribute("aria-pressed", String(button.dataset.rangeButton === selectedUptimeRange));
      }
    };
    const applyLanguage = () => {
      document.body.dataset.language = selectedLanguage;
      document.documentElement.lang = selectedLanguage;
      for (const button of document.querySelectorAll("[data-language-button]")) {
        button.setAttribute("aria-pressed", String(button.dataset.languageButton === selectedLanguage));
      }
      document.title = selectedLanguage === "fr" ? document.body.dataset.siteNameFr : document.body.dataset.siteNameEn;
      hideUptimeTooltip();
    };
    document.addEventListener("click", (event) => {
      const languageButton = event.target instanceof Element ? event.target.closest("[data-language-button]") : null;
      const language = languageButton?.dataset.languageButton;
      if (language === "en" || language === "fr") {
        selectedLanguage = language;
        try { localStorage.setItem("status-language", language); } catch {}
        applyLanguage();
        return;
      }
      const button = event.target instanceof Element ? event.target.closest("[data-range-button]") : null;
      const range = button?.dataset.rangeButton;
      if (!range || !uptimeRanges.has(range)) return;
      selectedUptimeRange = range;
      try { localStorage.setItem("uptime-range", range); } catch {}
      applyUptimeRange();
    });
    let activeTooltipTarget;
    const hideUptimeTooltip = () => {
      const tooltip = document.querySelector("[data-uptime-tooltip]");
      if (tooltip) tooltip.hidden = true;
      activeTooltipTarget = undefined;
    };
    const positionUptimeTooltip = (target) => {
      const tooltip = document.querySelector("[data-uptime-tooltip]");
      if (!tooltip || tooltip.hidden || !target) return;
      const gap = 10;
      const viewportGap = 8;
      const targetBounds = target.getBoundingClientRect();
      const bounds = tooltip.getBoundingClientRect();
      const targetCenter = targetBounds.left + targetBounds.width / 2;
      const left = Math.max(viewportGap, Math.min(targetCenter - bounds.width / 2, window.innerWidth - bounds.width - viewportGap));
      const arrowX = Math.max(10, Math.min(targetCenter - left, bounds.width - 10));
      tooltip.style.left = left + "px";
      tooltip.style.top = Math.max(viewportGap, targetBounds.top - bounds.height - gap) + "px";
      tooltip.style.setProperty("--tooltip-arrow-x", arrowX + "px");
    };
    document.addEventListener("pointermove", (event) => {
      const eventTarget = event.target instanceof Element ? event.target : null;
      const bars = eventTarget?.closest(".uptime-bars");
      const tooltip = document.querySelector("[data-uptime-tooltip]");
      if (!bars || !tooltip) {
        hideUptimeTooltip();
        return;
      }
      const targets = bars.querySelectorAll("[data-tooltip]");
      const bounds = bars.getBoundingClientRect();
      const offset = Math.max(0, Math.min(event.clientX - bounds.left, bounds.width - 1));
      const target = eventTarget.closest("[data-tooltip]") ?? targets[Math.min(targets.length - 1, Math.floor(offset / bounds.width * targets.length))];
      if (!target || target === activeTooltipTarget) return;
      activeTooltipTarget = target;
      tooltip.textContent = target.dataset.tooltip;
      tooltip.hidden = false;
      positionUptimeTooltip(target);
    });
    window.addEventListener("resize", () => positionUptimeTooltip(activeTooltipTarget));
    window.addEventListener("scroll", hideUptimeTooltip, { passive: true });
    document.addEventListener("pointerleave", hideUptimeTooltip);
    new MutationObserver(applyUptimeRange).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", () => {
      applyLanguage();
      applyUptimeRange();
    });
  </script>
  <style>${styles}</style>
</head>
<body data-language="en" data-site-name-en="${escapeHtml(`${siteName.label} | ${siteName.en}`)}" data-site-name-fr="${escapeHtml(`${siteName.label} | ${siteName.fr}`)}" data-init="@get('/stream', {retry: 'always', retryInterval: 15000, openWhenHidden: true})">
  <header class="page-header">
    <a class="brand" href="/">
      <span class="brand-mark" aria-hidden="true">${uptimeIcon}</span>
      <span class="brand-copy"><strong>${escapeHtml(siteName.label)}</strong><small data-copy="en">${escapeHtml(siteName.en)}</small><small data-copy="fr" lang="fr">${escapeHtml(siteName.fr)}</small></span>
    </a>
    <div class="language-toggle" role="group" aria-label="Language / Langue">
      <button type="button" data-language-button="en" aria-pressed="true">EN</button>
      <button type="button" data-language-button="fr" aria-pressed="false">FR</button>
    </div>
  </header>
  ${content}
  <footer>
    <div class="footer-copy" data-copy="en"><span>${escapeHtml(`${siteName.label} ${siteName.en}`)}</span><a href="https://github.com/krakcons/krakstack-uptime/" rel="noreferrer">Powered by krakcons/krakstack-uptime</a></div>
    <div class="footer-copy" data-copy="fr" lang="fr"><span>${escapeHtml(`${siteName.label} ${siteName.fr}`)}</span><a href="https://github.com/krakcons/krakstack-uptime/" rel="noreferrer">Propulsé par krakcons/krakstack-uptime</a></div>
  </footer>
  <div class="uptime-tooltip" role="tooltip" data-uptime-tooltip hidden></div>
</body>
</html>`;

const styles = `
:root {
  color-scheme: light;
  --background: oklch(0.9821 0 0);
  --foreground: oklch(0.2435 0 0);
  --card: oklch(0.9911 0 0);
  --card-foreground: oklch(0.2435 0 0);
  --primary: oklch(0.4341 0.0392 41.9938);
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.92 0.0651 74.3695);
  --muted: oklch(0.9521 0 0);
  --muted-foreground: oklch(0.5032 0 0);
  --border: oklch(0.8822 0 0);
  --ring: oklch(0.4341 0.0392 41.9938);
  --operational: oklch(0.58 0.13 154);
  --warning: oklch(0.69 0.15 62);
  --outage: oklch(0.58 0.2 27);
  --radius: 0.5rem;
  font-family: Poppins, ui-sans-serif, sans-serif, system-ui;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --background: oklch(0.1776 0 0);
    --foreground: oklch(0.9491 0 0);
    --card: oklch(0.2134 0 0);
    --card-foreground: oklch(0.9491 0 0);
    --primary: oklch(0.9247 0.0524 66.1732);
    --primary-foreground: oklch(0.2029 0.024 200.1962);
    --secondary: oklch(0.3163 0.019 63.6992);
    --muted: oklch(0.252 0 0);
    --muted-foreground: oklch(0.7699 0 0);
    --border: oklch(1 0 0 / 10%);
    --ring: oklch(0.9247 0.0524 66.1732);
    --operational: oklch(0.72 0.14 154);
    --warning: oklch(0.79 0.14 72);
    --outage: oklch(0.7 0.18 27);
  }
}
* { box-sizing: border-box; }
html {
  min-height: 100%;
  color: var(--foreground);
  background:
    radial-gradient(circle at 15% 15%, color-mix(in oklch, var(--secondary) 48%, transparent), transparent 28rem),
    var(--background);
  background-attachment: fixed;
  overscroll-behavior-y: none;
}
body {
  min-height: 100vh;
  margin: 0;
  background: transparent;
}
footer, #status-content, .page-header {
  width: min(58rem, calc(100% - clamp(2rem, 8vw, 5rem)));
  margin-inline: auto;
}
.page-header { min-height: 5rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding-block: 0.75rem; }
.brand { min-width: 0; display: inline-flex; align-items: center; gap: 0.75rem; color: var(--foreground); text-decoration: none; }
.brand-mark { width: 2.25rem; height: 2.25rem; display: grid; flex: none; place-items: center; color: var(--primary-foreground); background: var(--primary); border-radius: calc(var(--radius) * 0.85); box-shadow: 0 1px 2px hsl(0 0% 0% / 0.08); }
.brand-mark svg { width: 1.3rem; height: 1.3rem; }
.brand-copy { min-width: 0; display: grid; line-height: 1.2; }
.brand-copy strong { font-size: 0.8125rem; font-weight: 600; }
.brand-copy small { overflow: hidden; color: var(--muted-foreground); font-size: 0.6875rem; text-overflow: ellipsis; white-space: nowrap; }
.brand:focus-visible { outline: 3px solid var(--ring); outline-offset: 3px; border-radius: var(--radius); }
.language-toggle { display: inline-flex; gap: 0.2rem; padding: 0.2rem; background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius); }
.language-toggle button { min-width: 2.25rem; height: 2rem; padding-inline: 0.5rem; color: var(--muted-foreground); background: transparent; border: 0; border-radius: calc(var(--radius) * 0.7); font: inherit; font-size: 0.75rem; font-weight: 600; cursor: pointer; }
.language-toggle button[aria-pressed="true"] { color: var(--card-foreground); background: var(--card); box-shadow: 0 1px 2px hsl(0 0% 0% / 0.08); }
.language-toggle button:focus-visible { outline: 3px solid var(--ring); outline-offset: 2px; }
[data-copy="fr"] { display: none; }
body[data-language="fr"] [data-copy="en"] { display: none; }
body[data-language="fr"] [data-copy="fr"] { display: block; }
.overall {
  padding: clamp(3rem, 8vw, 6rem) clamp(1rem, 6vw, 4rem) clamp(3.5rem, 8vw, 5.5rem);
  text-align: center;
}
.status-icon {
  --status-color: var(--operational);
  width: 5rem;
  height: 5rem;
  position: relative;
  display: grid;
  place-items: center;
  margin: 0 auto 1.75rem;
  color: white;
  background: var(--status-color);
  border-radius: calc(var(--radius) * 1.4);
  box-shadow: 0 1px 2px hsl(0 0% 0% / 0.08), 0 0 2rem color-mix(in oklch, var(--status-color) 18%, transparent);
}
.status-icon::after {
  position: absolute;
  inset: -1px;
  border: 2px solid var(--status-color);
  border-radius: inherit;
  content: "";
  pointer-events: none;
  animation: status-pulse 2.4s ease-out infinite;
}
.status-icon svg { width: 2.75rem; height: 2.75rem; animation: status-beat 2.4s ease-in-out infinite; }
.overall.partial .status-icon,
.overall.unknown .status-icon { --status-color: var(--warning); color: oklch(0.2 0 0); }
.overall.major .status-icon { --status-color: var(--outage); color: white; }
@keyframes status-pulse {
  0% { opacity: 0.65; transform: scale(1); }
  65%, 100% { opacity: 0; transform: scale(1.28); }
}
@keyframes status-beat {
  0%, 35%, 100% { transform: scale(1); }
  42% { transform: scale(1.08); }
  50% { transform: scale(0.98); }
  58% { transform: scale(1.05); }
}
@media (prefers-reduced-motion: reduce) {
  .status-icon::after,
  .status-icon svg { animation: none; }
}
.eyebrow {
  margin: 0 0 0.75rem;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.overall h1 {
  max-width: 15ch;
  margin: 0 auto;
  color: var(--card-foreground);
  font-size: clamp(2.5rem, 8vw, 5rem);
  font-weight: 700;
  line-height: 0.98;
  letter-spacing: -0.055em;
  text-wrap: balance;
}
[data-copy="fr"] .overall h1 { font-size: clamp(2.25rem, 7vw, 4.5rem); }
.summary {
  max-width: 34rem;
  margin: 1.5rem auto 0;
  color: var(--muted-foreground);
  font-size: clamp(0.95rem, 2.5vw, 1.0625rem);
  line-height: 1.7;
}
.components { padding-bottom: clamp(3rem, 8vw, 6rem); }
.section-heading { display: flex; align-items: end; justify-content: space-between; gap: 2rem; margin-bottom: 1.25rem; }
.section-heading .eyebrow { margin-bottom: 0.35rem; }
.section-heading h2 { margin: 0; font-size: clamp(1.35rem, 3vw, 1.75rem); font-weight: 600; letter-spacing: -0.025em; }
.status-tools { display: grid; justify-items: end; gap: 0.4rem; }
.range-controls { display: flex; gap: 0.25rem; padding: 0.2rem; background: var(--muted); border-radius: var(--radius); }
.range-controls button { padding: 0.45rem 0.65rem; color: var(--muted-foreground); background: transparent; border: 0; border-radius: calc(var(--radius) * 0.7); font: inherit; font-size: 0.6875rem; cursor: pointer; }
.range-controls button[aria-pressed="true"] { color: var(--card-foreground); background: var(--card); box-shadow: 0 1px 2px hsl(0 0% 0% / 0.08); }
.range-controls button:focus-visible { outline: 3px solid var(--ring); outline-offset: 2px; }
.service-group { margin-top: 2rem; }
.group-heading { display: flex; align-items: end; justify-content: space-between; gap: 1rem; padding-inline: 0.25rem; }
.group-title { min-width: 0; }
.group-title h3 { margin: 0; font-size: 1rem; font-weight: 600; }
.group-title span { display: block; margin-top: 0.2rem; color: var(--muted-foreground); font-size: 0.6875rem; }
.group-aggregate { text-align: right; }
.group-aggregate strong, .group-aggregate span { display: block; }
.group-aggregate strong { font-size: 0.875rem; font-weight: 600; }
.group-aggregate span { margin-top: 0.15rem; color: var(--muted-foreground); font-size: 0.625rem; }
.component, .empty-state {
  margin-top: 0.75rem;
  padding: clamp(1.1rem, 3vw, 1.5rem);
  color: var(--card-foreground);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 1px 2px hsl(0 0% 0% / 0.04);
}
.component-line { display: flex; align-items: start; justify-content: space-between; gap: 1rem; }
.component-name { min-width: 0; }
.component-name strong, .component-name a { display: block; }
.component-name strong { font-size: 0.9375rem; font-weight: 600; }
.component-name a { margin-top: 0.3rem; overflow: hidden; color: var(--muted-foreground); font-size: 0.7rem; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
.component-name a:hover { color: var(--foreground); text-decoration: underline; }
.component-name a:focus-visible { outline: 3px solid var(--ring); outline-offset: 2px; border-radius: 2px; }
.component-status { display: inline-flex; align-items: center; flex: none; gap: 0.45rem; color: var(--operational); font-size: 0.75rem; font-weight: 500; }
.component-status i { width: 0.45rem; height: 0.45rem; background: currentColor; border-radius: 50%; box-shadow: 0 0 0 3px color-mix(in oklch, currentColor 14%, transparent); }
.component-status.major { color: var(--outage); }
.component-status.unknown { color: var(--muted-foreground); }
.range-view { display: none; }
#status-content[data-range="minutes"] [data-range-view="minutes"],
#status-content[data-range="hours"] [data-range-view="hours"],
#status-content[data-range="days"] [data-range-view="days"] { display: block; }
.uptime-bars { height: 2rem; display: grid; grid-template-columns: repeat(90, 1fr); gap: 2px; margin-top: 1.25rem; }
.uptime-bar { display: block; background: var(--muted); border-radius: 2px; }
.uptime-bar.good { background: var(--operational); }
.uptime-bar.warn { background: var(--warning); }
.uptime-bar.bad { background: var(--outage); }
.uptime-tooltip { position: fixed; z-index: 100; max-width: min(22rem, calc(100vw - 1.5rem)); padding: 0.55rem 0.7rem; color: var(--primary-foreground); background: color-mix(in oklch, var(--foreground) 94%, transparent); border: 1px solid color-mix(in oklch, var(--foreground) 72%, transparent); border-radius: var(--radius); box-shadow: 0 8px 24px hsl(0 0% 0% / 0.2); font-size: 0.75rem; font-weight: 500; line-height: 1.4; pointer-events: none; }
.uptime-tooltip::after { position: absolute; bottom: -5px; left: var(--tooltip-arrow-x, 50%); width: 8px; height: 8px; background: color-mix(in oklch, var(--foreground) 94%, transparent); border-right: 1px solid color-mix(in oklch, var(--foreground) 72%, transparent); border-bottom: 1px solid color-mix(in oklch, var(--foreground) 72%, transparent); content: ""; transform: translateX(-50%) rotate(45deg); }
.uptime-tooltip[hidden] { display: none; }
.range { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; margin-top: 0.55rem; color: var(--muted-foreground); font-size: 0.625rem; }
.range span:nth-child(2) { padding-inline: 0.75rem; font-weight: 500; }
.range span:last-child { text-align: right; }
.empty-state { color: var(--muted-foreground); font-size: 0.875rem; text-align: center; }
footer {
  padding-block: 1.5rem 2rem;
  color: var(--muted-foreground);
  border-top: 1px solid var(--border);
  font-size: 0.6875rem;
}
.footer-copy { align-items: center; justify-content: space-between; gap: 1rem; }
.footer-copy[data-copy="en"] { display: flex; }
body[data-language="fr"] .footer-copy[data-copy="en"] { display: none; }
body[data-language="fr"] .footer-copy[data-copy="fr"] { display: flex; }
footer a { color: inherit; text-decoration: none; }
footer a:hover { color: var(--foreground); }
footer a:focus-visible { outline: 3px solid var(--ring); outline-offset: 3px; border-radius: 2px; }
@media (max-width: 700px) {
  .overall { padding-inline: 0; }
  .section-heading { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; justify-content: stretch; gap: 1rem; }
  .status-tools { width: 100%; justify-items: stretch; }
  .range-controls { width: 100%; display: grid; grid-template-columns: repeat(3, 1fr); }
  .range-controls button { min-height: 2.25rem; padding: 0.3rem 0.5rem; }
  .group-heading { display: grid; align-items: start; gap: 0.75rem; }
  .group-aggregate { text-align: left; }
  .uptime-bars { height: 1.5rem; gap: 1px; grid-template-columns: repeat(60, 1fr); }
  .uptime-bar:nth-child(-n + 30) { display: none; }
  .range span:first-child { font-size: 0; }
  [data-range-view="minutes"] .range span:first-child::after { content: "60 minutes ago"; font-size: 0.625rem; }
  [data-range-view="hours"] .range span:first-child::after { content: "60 hours ago"; font-size: 0.625rem; }
  [data-range-view="days"] .range span:first-child::after { content: "60 days ago"; font-size: 0.625rem; }
  [data-copy="fr"] [data-range-view="minutes"] .range span:first-child::after { content: "Il y a 60 minutes"; }
  [data-copy="fr"] [data-range-view="hours"] .range span:first-child::after { content: "Il y a 60 heures"; }
  [data-copy="fr"] [data-range-view="days"] .range span:first-child::after { content: "Il y a 60 jours"; }
  .footer-copy { align-items: start; display: grid; justify-items: start; }
  body[data-language="fr"] .footer-copy[data-copy="fr"] { display: grid; }
  footer a { overflow-wrap: anywhere; }
}
@media (max-width: 440px) {
  footer, #status-content, .page-header { width: calc(100% - 1.25rem); }
  .overall { padding-block: 2.5rem 3rem; }
  .status-icon { width: 4.25rem; height: 4.25rem; margin-bottom: 1.35rem; }
  .status-icon svg { width: 2.35rem; height: 2.35rem; }
  .overall h1 { font-size: clamp(2rem, 11vw, 2.75rem); }
  [data-copy="fr"] .overall h1 { font-size: clamp(2rem, 11vw, 2.75rem); }
  .component, .empty-state { padding: 1rem; }
  .component-line { display: grid; gap: 0.75rem; }
  .component-name a { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
  .range { grid-template-columns: 1fr auto 1fr; }
  .range span:nth-child(2) { padding-inline: 0.35rem; text-align: center; }
}
`;
