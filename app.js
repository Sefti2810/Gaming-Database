import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || SUPABASE_URL.includes("YOUR-PROJECT")) {
  document.body.innerHTML =
    '<div style="padding:40px;font-family:sans-serif;max-width:520px;margin:0 auto">' +
    '<h2>Konfiguration fehlt</h2><p>Bitte <code>config.js</code> mit deiner Supabase-URL ' +
    "und dem anon-Key ausfüllen (siehe README.md).</p></div>";
  throw new Error("config.js nicht ausgefüllt");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TYPE_LABELS = { konsole: "Konsole", spiel: "Spiel", zubehoer: "Zubehoer" };
const PHOTO_BUCKET = "photos";

// ---------------------------------------------------------------------
// Dropdown-Vorschlaege fuer Konsole/Kategorie/Zustand, inkl. freier Texteingabe.
// (Ein natives <input list="..."> haette hier gereicht, verhaelt sich aber je nach
// Browser unterschiedlich - v.a. Safari zeigt die Vorschlaege oft gar nicht an.
// Deshalb ein eigenes, leichtes Dropdown, das ueberall gleich funktioniert.)
// ---------------------------------------------------------------------
const CONSOLE_OPTIONS = [
  "Nintendo Switch", "Nintendo Switch 2", "Nintendo Switch Lite", "Nintendo GameCube",
  "Nintendo Wii", "Nintendo Wii U", "Nintendo 64", "Super Nintendo (SNES)", "NES",
  "Game Boy", "Game Boy Color", "Game Boy Advance", "Nintendo DS", "Nintendo DS Lite",
  "Nintendo DSi", "Nintendo 3DS", "New Nintendo 3DS",
  "PlayStation", "PlayStation 2", "PlayStation 3", "PlayStation 4", "PlayStation 5",
  "PlayStation Portable", "PS Vita",
  "Xbox", "Xbox 360", "Xbox One", "Xbox Series X/S",
  "Sega Mega Drive", "Sega Saturn", "Sega Dreamcast", "PC",
];
const CATEGORY_OPTIONS = [
  "Jump'n'Run", "Shooter", "RPG", "Sport", "Rennspiel", "Adventure", "Puzzle",
  "Prügelspiel", "Strategie", "Simulation", "Party", "Horror", "Musik/Rhythmus",
  "Heimkonsole", "Handheld", "Controller", "Kabel", "Netzteil", "Speicherkarte",
  "Sonstiges",
];
const CONDITION_OPTIONS = [
  "Neu/OVP", "Sehr guter Zustand", "Guter Zustand", "Gebrauchsspuren",
  "Ohne Verpackung", "Ohne Anleitung", "Defekt/Ersatzteile",
];

// Verkaufsstatus-Vermerk je Artikel (z. B. "zum Verkauf vorgesehen"/"nicht zu verkaufen").
const SALE_STATUS = {
  for_sale: { label: "Zum Verkauf vorgesehen", cls: "sale-for-sale" },
  reserved: { label: "Reserviert", cls: "sale-reserved" },
  sold: { label: "Verkauft", cls: "sale-sold" },
  not_for_sale: { label: "Nicht zu verkaufen", cls: "sale-not-for-sale" },
};
function saleBadgeHtml(status) {
  const s = SALE_STATUS[status];
  return s ? `<span class="sale-badge ${s.cls}">${s.label}</span>` : "";
}

// Verwandelt ein normales Text-Input in ein Kombifeld: ein echtes <select>
// (genau wie beim Typ-Feld - auf dem Handy also der native Auswahl-Picker)
// mit den Vorschlaegen, plus einer Option "Eigener Text", die ein Textfeld
// fuer freie Eingaben einblendet. Robuster als ein selbstgebautes Dropdown,
// weil Mac/iPhone/Android hier einfach ihre eigene native Auswahl anzeigen.
function enhanceCombo(input, options) {
  if (!input || input.dataset.comboReady) return null;
  input.dataset.comboReady = "1";

  const CUSTOM = "__custom__";
  const wrap = document.createElement("div");
  wrap.className = "combo-wrap";
  input.parentNode.insertBefore(wrap, input);

  const select = document.createElement("select");
  select.className = "combo-select";
  const blankOpt = document.createElement("option");
  blankOpt.value = "";
  blankOpt.textContent = "– auswählen –";
  select.appendChild(blankOpt);
  options.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    select.appendChild(opt);
  });
  const customOpt = document.createElement("option");
  customOpt.value = CUSTOM;
  customOpt.textContent = "✏️ Eigener Text…";
  select.appendChild(customOpt);

  wrap.appendChild(select);
  wrap.appendChild(input);
  input.classList.add("combo-text");
  if (!input.placeholder) input.placeholder = "Eigener Text";

  function syncFromValue() {
    const v = (input.value || "").trim();
    if (!v) {
      select.value = "";
      input.classList.add("hidden");
    } else if (options.includes(v)) {
      select.value = v;
      input.classList.add("hidden");
    } else {
      select.value = CUSTOM;
      input.classList.remove("hidden");
    }
  }

  select.addEventListener("change", () => {
    if (select.value === CUSTOM) {
      input.classList.remove("hidden");
      if (options.includes(input.value.trim())) input.value = "";
      input.focus();
    } else {
      input.classList.add("hidden");
      input.value = select.value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });

  syncFromValue();

  return {
    setValue(v) {
      input.value = v || "";
      syncFromValue();
    },
  };
}

// Ruft die Edge Function auf und liefert im Fehlerfall, wenn moeglich, die konkrete
// Fehlermeldung aus dem Funktions-Body statt nur "non-2xx status code".
async function invokeAnalyzeFn(body) {
  const { data, error } = await supabase.functions.invoke("analyze-image", { body });
  if (error) {
    let detail = error.message;
    try {
      if (error.context && typeof error.context.json === "function") {
        const parsed = await error.context.json();
        if (parsed?.error) detail = parsed.error;
      }
    } catch (_) {
      // Body war kein JSON o.ae. - bei der generischen Meldung bleiben.
    }
    throw new Error(detail);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

let currentUser = null;
let selectedFiles = []; // fuer das Add-Formular

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
const loginView = document.getElementById("view-login");
const appShell = document.getElementById("app-shell");

async function init() {
  const { data } = await supabase.auth.getSession();
  currentUser = data.session?.user || null;
  updateShell();
  if (currentUser) router();

  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    updateShell();
    if (currentUser) router();
  });
}

function updateShell() {
  if (currentUser) {
    loginView.classList.add("hidden");
    appShell.classList.remove("hidden");
  } else {
    loginView.classList.remove("hidden");
    appShell.classList.add("hidden");
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errBox = document.getElementById("login-error");
  errBox.textContent = "";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) errBox.textContent = "⚠️ " + error.message;
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await supabase.auth.signOut();
  location.hash = "#/";
});

document.getElementById("export-btn").addEventListener("click", exportCsv);

// ---------------------------------------------------------------------
// Darstellung: Hell/Dunkel-Modus (Vorliebe wird im Browser gemerkt)
// ---------------------------------------------------------------------
const THEME_KEY = "sammlung-theme";

function currentEffectiveTheme() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function updateThemeButton() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.textContent = currentEffectiveTheme() === "dark" ? "☀️" : "🌙";
}

document.getElementById("theme-toggle").addEventListener("click", () => {
  const next = currentEffectiveTheme() === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (_) {
    // localStorage evtl. nicht verfuegbar - Vorliebe gilt dann nur fuer diese Sitzung.
  }
  updateThemeButton();
});

updateThemeButton();

// ---------------------------------------------------------------------
// Übersicht: Karten- oder Listenansicht (Vorliebe wird gemerkt)
// ---------------------------------------------------------------------
const VIEW_KEY = "sammlung-view";
let currentView = "grid";
try {
  currentView = localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
} catch (_) {
  // localStorage evtl. nicht verfuegbar - Standardansicht (Karten) nutzen.
}

// ---------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------
window.addEventListener("hashchange", router);

function router() {
  const hash = location.hash || "#/";
  if (hash === "#/" || hash === "") {
    renderIndex();
  } else if (hash === "#/add") {
    renderAdd();
  } else if (hash === "#/import") {
    renderImport();
  } else if (hash.startsWith("#/item/")) {
    const id = hash.split("/")[2];
    renderItem(id);
  } else {
    renderIndex();
  }
}

function flash(msg) {
  const box = document.getElementById("flash");
  box.textContent = msg;
  box.classList.remove("hidden");
  setTimeout(() => box.classList.add("hidden"), 4000);
}

// ---------------------------------------------------------------------
// Fotos: Upload, Signed URLs
// ---------------------------------------------------------------------
async function uploadPhotos(files) {
  const paths = [];
  for (const file of files) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${currentUser.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, {
      contentType: file.type || "image/jpeg",
    });
    if (error) throw error;
    paths.push(path);
  }
  return paths;
}

function isExternalPhotoUrl(p) {
  return /^https?:\/\//i.test(p || "");
}

async function getSignedUrlMap(paths) {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return {};
  const map = {};
  // Externe Bild-URLs (z.B. importierte Cover) direkt verwenden, nur
  // echte Storage-Pfade brauchen eine Signed URL.
  const storagePaths = unique.filter((p) => !isExternalPhotoUrl(p));
  unique.filter(isExternalPhotoUrl).forEach((p) => (map[p] = p));
  if (storagePaths.length > 0) {
    const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(storagePaths, 3600);
    if (!error && data) {
      data.forEach((d) => {
        if (d.signedUrl) map[d.path] = d.signedUrl;
      });
    }
  }
  return map;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------
// Übersicht
// ---------------------------------------------------------------------
// Merkt sich die zuletzt gewaehlten Filter (Suche, Typ, Konsole, Status, Koop,
// Sortierung), damit sie beim Zurueckkehren von einem Artikel (z.B. nach dem
// Bearbeiten) erhalten bleiben, statt bei jedem Aufruf der Uebersicht
// zurueckgesetzt zu werden.
let savedFilterState = null;

function restoreFilterState() {
  if (!savedFilterState) return;
  const form = document.getElementById("filter-form");
  if (!form) return;
  const qInput = form.querySelector('[name="q"]');
  if (qInput) qInput.value = savedFilterState.q || "";
  const sortSelect = form.querySelector('[name="sort"]');
  if (sortSelect) sortSelect.value = savedFilterState.sort || "created_desc";
  const coopBox = form.querySelector('[name="coop_only"]');
  if (coopBox) coopBox.checked = !!savedFilterState.coopOnly;
  if (savedFilterState.types) {
    form.querySelectorAll('input[name="type"]').forEach((b) => {
      b.checked = savedFilterState.types.includes(b.value);
    });
  }
  if (savedFilterState.consoles) {
    form.querySelectorAll('input[name="console"]').forEach((b) => {
      b.checked = savedFilterState.consoles.includes(b.value);
    });
  }
  if (savedFilterState.saleStatuses) {
    form.querySelectorAll('input[name="sale_status"]').forEach((b) => {
      b.checked = savedFilterState.saleStatuses.includes(b.value);
    });
  }
  updateAllMsCounts();
}

// ---------------------------------------------------------------------
// Mehrfachauswahl-Filter (Typ, Konsole, Verkaufsstatus): generischer Aufbau
// der Checkbox-Liste innerhalb eines <details class="ms-filter">, damit man
// z.B. mehrere Konsolen gleichzeitig ein-/ausblenden kann.
// ---------------------------------------------------------------------
let msOutsideClickBound = false;
function ensureMsOutsideClickHandler() {
  if (msOutsideClickBound) return;
  msOutsideClickBound = true;
  document.addEventListener("click", (e) => {
    document.querySelectorAll(".ms-filter[open]").forEach((details) => {
      if (!details.contains(e.target)) details.open = false;
    });
  });
}

function updateMsCount(details) {
  if (!details) return;
  const boxes = Array.from(details.querySelectorAll('input[type="checkbox"]'));
  const checked = boxes.filter((b) => b.checked).length;
  const countEl = details.querySelector(".ms-count");
  if (countEl) countEl.textContent = checked === boxes.length ? "" : `(${checked}/${boxes.length})`;
}

function updateAllMsCounts() {
  ["type-filter", "console-filter", "sale-status-filter"].forEach((id) => {
    updateMsCount(document.getElementById(id));
  });
}

function buildMultiSelectFilter(detailsId, inputName, options) {
  const details = document.getElementById(detailsId);
  if (!details) return;
  const optionsBox = details.querySelector(".ms-options");
  optionsBox.innerHTML =
    `<div class="ms-actions">
      <button type="button" class="ms-all">Alle</button>
      <button type="button" class="ms-none">Keine</button>
    </div>` +
    options
      .map(
        (o) =>
          `<label><input type="checkbox" name="${inputName}" value="${escapeHtml(o.value)}" checked> ${escapeHtml(o.label)}</label>`
      )
      .join("");

  updateMsCount(details);

  optionsBox.querySelector(".ms-all").addEventListener("click", () => {
    details.querySelectorAll(`input[name="${inputName}"]`).forEach((b) => (b.checked = true));
    updateMsCount(details);
    document.getElementById("filter-form").dispatchEvent(new Event("input", { bubbles: true }));
  });
  optionsBox.querySelector(".ms-none").addEventListener("click", () => {
    details.querySelectorAll(`input[name="${inputName}"]`).forEach((b) => (b.checked = false));
    updateMsCount(details);
    document.getElementById("filter-form").dispatchEvent(new Event("input", { bubbles: true }));
  });

  ensureMsOutsideClickHandler();
}

function populateFilters(items) {
  buildMultiSelectFilter("type-filter", "type", [
    { value: "konsole", label: "Konsole" },
    { value: "spiel", label: "Spiel" },
    { value: "zubehoer", label: "Zubehoer" },
  ]);
  const consoles = [...new Set(items.map((i) => i.console).filter(Boolean))].sort();
  buildMultiSelectFilter(
    "console-filter",
    "console",
    consoles.map((c) => ({ value: c, label: c }))
  );
  buildMultiSelectFilter("sale-status-filter", "sale_status", [
    { value: "", label: "– kein Vermerk –" },
    { value: "for_sale", label: "Zum Verkauf vorgesehen" },
    { value: "reserved", label: "Reserviert" },
    { value: "sold", label: "Verkauft" },
    { value: "not_for_sale", label: "Nicht zu verkaufen" },
  ]);
}

async function renderIndex() {
  const main = document.getElementById("main");
  main.innerHTML = "";
  main.appendChild(document.getElementById("tpl-index").content.cloneNode(true));

  const { data: items, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    main.innerHTML = `<div class="notice">Fehler beim Laden: ${error.message}</div>`;
    return;
  }

  renderStats(items);
  populateFilters(items);
  restoreFilterState();
  updateViewButtons();
  applyFiltersAndRender(items);

  document.getElementById("filter-form").addEventListener("input", () => {
    updateAllMsCounts();
    applyFiltersAndRender(items);
  });
  document.getElementById("view-grid-btn").addEventListener("click", () => setView("grid", items));
  document.getElementById("view-list-btn").addEventListener("click", () => setView("list", items));
}

function setView(view, items) {
  currentView = view;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch (_) {
    // localStorage evtl. nicht verfuegbar - Auswahl gilt dann nur fuer diese Sitzung.
  }
  updateViewButtons();
  applyFiltersAndRender(items);
}

function updateViewButtons() {
  const gridBtn = document.getElementById("view-grid-btn");
  const listBtn = document.getElementById("view-list-btn");
  const listHeader = document.getElementById("list-header");
  const grid = document.getElementById("grid");
  if (!gridBtn || !listBtn) return;
  gridBtn.classList.toggle("active", currentView === "grid");
  listBtn.classList.toggle("active", currentView === "list");
  if (listHeader) listHeader.classList.toggle("hidden", currentView !== "list");
  if (grid) grid.classList.toggle("list", currentView === "list");
}

function renderStats(items) {
  const totalItems = items.length;
  const totalInvested = items.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
  const totalEstimated = items.reduce((s, i) => s + (Number(i.estimated_value) || 0), 0);
  const diff = totalEstimated - totalInvested;
  const totalSold = items
    .filter((i) => i.sale_status === "sold")
    .reduce((s, i) => s + (Number(i.estimated_value) || 0), 0);
  document.getElementById("stats").innerHTML = `
    <div class="stat-card"><div class="stat-label">Artikel gesamt</div><div class="stat-value">${totalItems}</div></div>
    <div class="stat-card"><div class="stat-label">Investiert (Kaufpreise)</div><div class="stat-value">${totalInvested.toFixed(2)} €</div></div>
    <div class="stat-card"><div class="stat-label">Geschätzter Wert</div><div class="stat-value">${totalEstimated.toFixed(2)} €</div></div>
    <div class="stat-card ${diff >= 0 ? "pos" : "neg"}"><div class="stat-label">Differenz</div><div class="stat-value">${diff >= 0 ? "+" : ""}${diff.toFixed(2)} €</div></div>
    <div class="stat-card"><div class="stat-label">Bereits verkauft (Wert)</div><div class="stat-value">${totalSold.toFixed(2)} €</div></div>
  `;
  renderConsoleBreakdown(items);
}

function renderConsoleBreakdown(items) {
  const body = document.getElementById("console-breakdown-body");
  if (!body) return;
  const byConsole = {};
  items.forEach((i) => {
    const key = i.console || "(ohne Konsole)";
    if (!byConsole[key]) byConsole[key] = { count: 0, invested: 0, estimated: 0, sold: 0 };
    byConsole[key].count += 1;
    byConsole[key].invested += Number(i.purchase_price) || 0;
    byConsole[key].estimated += Number(i.estimated_value) || 0;
    if (i.sale_status === "sold") byConsole[key].sold += Number(i.estimated_value) || 0;
  });
  const rows = Object.entries(byConsole).sort((a, b) => b[1].count - a[1].count);
  if (rows.length === 0) {
    body.innerHTML = `<p class="muted">Noch keine Artikel erfasst.</p>`;
    return;
  }
  body.innerHTML = `
    <table class="console-breakdown-table">
      <thead>
        <tr><th>Konsole</th><th class="num">Artikel</th><th class="num">Investiert</th><th class="num">Wert</th><th class="num">Verkauft</th></tr>
      </thead>
      <tbody>
        ${rows
          .map(
            ([name, s]) => `<tr>
              <td>${escapeHtml(name)}</td>
              <td class="num">${s.count}</td>
              <td class="num">${s.invested.toFixed(2)} €</td>
              <td class="num">${s.estimated.toFixed(2)} €</td>
              <td class="num">${s.sold.toFixed(2)} €</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

async function applyFiltersAndRender(items) {
  const form = document.getElementById("filter-form");
  const fd = new FormData(form);
  const q = (fd.get("q") || "").toString().toLowerCase();
  const types = fd.getAll("type").map(String);
  const consoles = fd.getAll("console").map(String);
  const saleStatuses = fd.getAll("sale_status").map(String);
  const coopOnly = fd.get("coop_only") === "on";
  const allTypeCount = form.querySelectorAll('input[name="type"]').length;
  const allConsoleCount = form.querySelectorAll('input[name="console"]').length;
  const allSaleStatusCount = form.querySelectorAll('input[name="sale_status"]').length;
  const sort = fd.get("sort");

  savedFilterState = {
    q: (fd.get("q") || "").toString(),
    types,
    consoles,
    sort: (sort || "created_desc").toString(),
    saleStatuses,
    coopOnly,
  };

  let filtered = items.filter((i) => {
    if (types.length < allTypeCount && !types.includes(i.type || "")) return false;
    if (consoles.length < allConsoleCount && !consoles.includes(i.console || "")) return false;
    if (saleStatuses.length < allSaleStatusCount && !saleStatuses.includes(i.sale_status || "")) return false;
    if (coopOnly && !i.coop_campaign) return false;
    if (q) {
      const hay = `${i.title} ${i.console} ${i.details} ${i.notes}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const cmp = {
    created_desc: (a, b) => new Date(b.created_at) - new Date(a.created_at),
    created_asc: (a, b) => new Date(a.created_at) - new Date(b.created_at),
    title_asc: (a, b) => (a.title || "").localeCompare(b.title || ""),
    value_desc: (a, b) => (b.estimated_value || 0) - (a.estimated_value || 0),
    value_asc: (a, b) => (a.estimated_value || 0) - (b.estimated_value || 0),
  }[sort] || (() => 0);
  filtered = filtered.sort(cmp);

  updateViewButtons();

  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty-state");
  if (filtered.length === 0) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  if (currentView === "list") {
    // Listenansicht: bewusst ohne Fotos/Signed-URLs fuer einen schnellen Überblick.
    grid.innerHTML = filtered
      .map(
        (item) => `
      <a class="list-row" href="#/item/${item.id}">
        <span class="badge-inline badge-${item.type}">${TYPE_LABELS[item.type] || item.type}</span>
        <span class="list-title">${escapeHtml(item.title) || "(ohne Titel)"}${item.coop_campaign ? ' <span class="coop-badge">🎮 Koop</span>' : ""}</span>
        <span class="list-console">${escapeHtml(item.console)}</span>
        <span class="list-status">${saleBadgeHtml(item.sale_status) || "–"}</span>
        <span class="list-price">${item.purchase_price != null ? Number(item.purchase_price).toFixed(2) + " €" : "–"}</span>
        <span class="list-price">${item.estimated_value != null ? Number(item.estimated_value).toFixed(2) + " €" : "–"}</span>
      </a>`
      )
      .join("");
    return;
  }

  const firstPhotoPaths = filtered.map((i) => i.photos?.[0]).filter(Boolean);
  const urlMap = await getSignedUrlMap(firstPhotoPaths);

  grid.innerHTML = filtered
    .map((item) => {
      const photoUrl = item.photos?.[0] ? urlMap[item.photos[0]] : null;
      const photoHtml = photoUrl
        ? `<img src="${photoUrl}" alt="${escapeHtml(item.title)}">`
        : `<div class="no-photo">🎮</div>`;
      return `
      <a class="card" href="#/item/${item.id}">
        <div class="card-photo">
          ${photoHtml}
          <span class="badge badge-${item.type}">${TYPE_LABELS[item.type] || item.type}</span>
        </div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(item.title) || "(ohne Titel)"}</div>
          <div class="card-console">${escapeHtml(item.console)}</div>
          ${item.category ? `<div class="card-category">${escapeHtml(item.category)}</div>` : ""}
          ${
            item.sale_status || item.coop_campaign
              ? `<div class="card-sale">${saleBadgeHtml(item.sale_status)}${item.coop_campaign ? ' <span class="coop-badge">🎮 Koop</span>' : ""}</div>`
              : ""
          }
          <div class="card-prices">
            <span>Kauf: ${item.purchase_price != null ? Number(item.purchase_price).toFixed(2) + " €" : "–"}</span>
            <span>Wert: ${item.estimated_value != null ? Number(item.estimated_value).toFixed(2) + " €" : "–"}</span>
          </div>
        </div>
      </a>`;
    })
    .join("");
}

// ---------------------------------------------------------------------
// Artikel hinzufügen
// ---------------------------------------------------------------------
function renderAdd() {
  const main = document.getElementById("main");
  main.innerHTML = "";
  main.appendChild(document.getElementById("tpl-add").content.cloneNode(true));
  selectedFiles = [];

  const consoleCombo = enhanceCombo(document.getElementById("f-console"), CONSOLE_OPTIONS);
  const categoryCombo = enhanceCombo(document.getElementById("f-category"), CATEGORY_OPTIONS);
  const conditionCombo = enhanceCombo(document.getElementById("f-condition"), CONDITION_OPTIONS);

  const photoInput = document.getElementById("photo-input");
  const photoPreviews = document.getElementById("photo-previews");
  const analyzeBtn = document.getElementById("analyze-btn");
  const analyzeStatus = document.getElementById("analyze-status");
  const dropText = document.getElementById("photo-drop-text");

  photoInput.addEventListener("change", () => {
    selectedFiles = Array.from(photoInput.files);
    photoPreviews.innerHTML = "";
    selectedFiles.forEach((f) => {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(f);
      photoPreviews.appendChild(img);
    });
    dropText.textContent = selectedFiles.length ? `${selectedFiles.length} Foto(s) ausgewählt` : "📷 Foto aufnehmen oder Datei(en) auswählen";
    analyzeBtn.disabled = selectedFiles.length === 0;
  });

  analyzeBtn.addEventListener("click", async () => {
    if (selectedFiles.length === 0) return;
    analyzeBtn.disabled = true;
    analyzeStatus.textContent = "Analysiere Foto…";
    try {
      const dataUrl = await fileToDataUrl(selectedFiles[0]);
      const data = await invokeAnalyzeFn({ action: "recognize", image: dataUrl });
      const s = data.suggestion || {};
      if (s.type) document.getElementById("f-type").value = s.type;
      if (s.title) document.getElementById("f-title").value = s.title;
      if (s.console) consoleCombo.setValue(s.console);
      if (s.category) categoryCombo.setValue(s.category);
      if (s.condition) conditionCombo.setValue(s.condition);
      if (s.details) document.getElementById("f-details").value = s.details;
      analyzeStatus.textContent = `✅ Vorschlag übernommen (Konfidenz: ${s.confidence || "unbekannt"}). Bitte prüfen und ggf. korrigieren.`;
    } catch (err) {
      analyzeStatus.textContent = "⚠️ Fehler bei der Analyse: " + (err.message || err);
    }
    analyzeBtn.disabled = false;
  });

  document.getElementById("item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("save-status");
    const title = document.getElementById("f-title").value.trim();
    const consoleVal = document.getElementById("f-console").value.trim();

    if (title) {
      try {
        const { data: dupes } = await supabase
          .from("items")
          .select("id, console")
          .ilike("title", title)
          .limit(10);
        const realDupes = (dupes || []).filter((d) => (d.console || "").toLowerCase() === consoleVal.toLowerCase());
        if (realDupes.length > 0) {
          const ok = confirm(
            `Es gibt bereits ${realDupes.length} Artikel mit dem Titel "${title}" (Konsole "${consoleVal || "–"}"). Trotzdem speichern?`
          );
          if (!ok) return;
        }
      } catch (_) {
        // Duplikat-Check fehlgeschlagen (z.B. Netzwerk) - Speichern trotzdem erlauben.
      }
    }

    status.textContent = "Speichere…";
    try {
      const photos = selectedFiles.length ? await uploadPhotos(selectedFiles) : [];
      const payload = {
        user_id: currentUser.id,
        type: document.getElementById("f-type").value,
        title,
        console: consoleVal,
        category: document.getElementById("f-category").value.trim(),
        condition_text: document.getElementById("f-condition").value.trim(),
        details: document.getElementById("f-details").value.trim(),
        purchase_price: parseFloatOrNull(document.getElementById("f-purchase").value),
        estimated_value: parseFloatOrNull(document.getElementById("f-estimated").value),
        sale_status: document.getElementById("f-sale-status").value || null,
        storage_location: document.getElementById("f-storage-location").value.trim(),
        coop_campaign: document.getElementById("f-coop").checked,
        notes: document.getElementById("f-notes").value.trim(),
        photos,
      };
      const { error } = await supabase.from("items").insert(payload);
      if (error) throw error;
      flash("Artikel gespeichert.");
      location.hash = "#/";
    } catch (err) {
      status.textContent = "⚠️ Fehler beim Speichern: " + (err.message || err);
    }
  });
}

function parseFloatOrNull(v) {
  if (v === "" || v == null) return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------
// Bestehende Sammlung importieren (Text -> KI -> Review-Tabelle -> Bulk-Insert)
// ---------------------------------------------------------------------
function importRowHtml(row, idx) {
  const t = (v) => escapeHtml(v ?? "");
  return `<tr class="import-row" data-idx="${idx}">
    <td><input type="checkbox" class="imp-include" checked></td>
    <td><select class="imp-type">
      <option value="spiel" ${row.type === "spiel" ? "selected" : ""}>Spiel</option>
      <option value="konsole" ${row.type === "konsole" ? "selected" : ""}>Konsole</option>
      <option value="zubehoer" ${row.type === "zubehoer" ? "selected" : ""}>Zubehoer</option>
    </select></td>
    <td><input type="text" class="imp-title" value="${t(row.title)}" placeholder="Titel"></td>
    <td><input type="text" class="imp-console" value="${t(row.console)}" placeholder="Konsole"></td>
    <td><input type="text" class="imp-category" value="${t(row.category)}" placeholder="Kategorie"></td>
    <td><input type="text" class="imp-condition" value="${t(row.condition)}" placeholder="Zustand"></td>
    <td><input type="number" step="0.01" min="0" class="imp-purchase" value="${row.purchase_price ?? ""}"></td>
    <td><input type="number" step="0.01" min="0" class="imp-estimated" value="${row.estimated_value ?? ""}"></td>
    <td><button type="button" class="import-row-remove" title="Zeile entfernen">✕</button></td>
  </tr>`;
}

function renderImport() {
  const main = document.getElementById("main");
  main.innerHTML = "";
  main.appendChild(document.getElementById("tpl-import").content.cloneNode(true));

  const textarea = document.getElementById("import-text");
  const parseBtn = document.getElementById("parse-btn");
  const addRowBtn = document.getElementById("add-row-btn");
  const status = document.getElementById("import-status");
  const reviewBox = document.getElementById("import-review");
  const tbody = document.getElementById("import-tbody");
  const confirmBtn = document.getElementById("import-confirm-btn");
  const countLabel = document.getElementById("import-count");
  const finalStatus = document.getElementById("import-final-status");

  let rowCounter = 0;

  function updateCount() {
    const total = tbody.querySelectorAll("tr").length;
    const included = tbody.querySelectorAll(".imp-include:checked").length;
    countLabel.textContent = total ? `${included} von ${total} ausgewählt` : "";
  }

  function addRow(row) {
    const idx = rowCounter++;
    tbody.insertAdjacentHTML("beforeend", importRowHtml(row || {}, idx));
    const tr = tbody.querySelector(`tr[data-idx="${idx}"]`);
    tr.querySelector(".import-row-remove").addEventListener("click", () => {
      tr.remove();
      updateCount();
    });
    tr.querySelector(".imp-include").addEventListener("change", (e) => {
      tr.classList.toggle("excluded", !e.target.checked);
      updateCount();
    });
    enhanceCombo(tr.querySelector(".imp-console"), CONSOLE_OPTIONS);
    enhanceCombo(tr.querySelector(".imp-category"), CATEGORY_OPTIONS);
    enhanceCombo(tr.querySelector(".imp-condition"), CONDITION_OPTIONS);
  }

  parseBtn.addEventListener("click", async () => {
    const text = textarea.value.trim();
    if (!text) {
      status.textContent = "Bitte zuerst deine Liste in das Feld einfügen.";
      return;
    }
    parseBtn.disabled = true;
    status.textContent = "Analysiere Liste…";
    try {
      const data = await invokeAnalyzeFn({ action: "parse_list", text });
      const items = data.items || [];
      tbody.innerHTML = "";
      rowCounter = 0;
      items.forEach((item) => addRow(item));
      reviewBox.classList.remove("hidden");
      addRowBtn.classList.remove("hidden");
      updateCount();
      status.textContent = items.length
        ? `✅ ${items.length} Artikel erkannt. Bitte prüfen und bei Bedarf korrigieren, bevor du importierst.`
        : "Keine Artikel erkannt – du kannst unten manuell Zeilen hinzufügen.";
    } catch (err) {
      status.textContent = "⚠️ Fehler bei der Analyse: " + (err.message || err);
    }
    parseBtn.disabled = false;
  });

  addRowBtn.addEventListener("click", () => {
    addRow({});
    reviewBox.classList.remove("hidden");
    updateCount();
  });

  confirmBtn.addEventListener("click", async () => {
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const toImport = [];
    rows.forEach((tr) => {
      if (!tr.querySelector(".imp-include").checked) return;
      const title = tr.querySelector(".imp-title").value.trim();
      const consoleVal = tr.querySelector(".imp-console").value.trim();
      if (!title && !consoleVal) return; // leere Zeile ueberspringen
      toImport.push({
        user_id: currentUser.id,
        type: tr.querySelector(".imp-type").value,
        title,
        console: consoleVal,
        category: tr.querySelector(".imp-category").value.trim(),
        condition_text: tr.querySelector(".imp-condition").value.trim(),
        details: "",
        purchase_price: parseFloatOrNull(tr.querySelector(".imp-purchase").value),
        estimated_value: parseFloatOrNull(tr.querySelector(".imp-estimated").value),
        notes: "",
        photos: [],
      });
    });
    if (toImport.length === 0) {
      finalStatus.textContent = "Keine Artikel zum Importieren ausgewählt.";
      return;
    }
    confirmBtn.disabled = true;
    finalStatus.textContent = `Importiere ${toImport.length} Artikel…`;
    try {
      const { error } = await supabase.from("items").insert(toImport);
      if (error) throw error;
      flash(`${toImport.length} Artikel importiert.`);
      location.hash = "#/";
    } catch (err) {
      finalStatus.textContent = "⚠️ Fehler beim Import: " + (err.message || err);
      confirmBtn.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------
// Artikel-Detail / Bearbeiten
// ---------------------------------------------------------------------
async function renderItem(id) {
  const main = document.getElementById("main");
  main.innerHTML = "";
  main.appendChild(document.getElementById("tpl-item").content.cloneNode(true));

  const { data: item, error } = await supabase.from("items").select("*").eq("id", id).single();
  if (error || !item) {
    main.innerHTML = `<div class="notice">Artikel nicht gefunden.</div><a href="#/">← Zur Übersicht</a>`;
    return;
  }

  await renderItemPhotos(item);

  document.getElementById("e-type").value = item.type;
  document.getElementById("e-title").value = item.title || "";
  document.getElementById("e-console").value = item.console || "";
  document.getElementById("e-category").value = item.category || "";
  document.getElementById("e-condition").value = item.condition_text || "";
  document.getElementById("e-details").value = item.details || "";

  enhanceCombo(document.getElementById("e-console"), CONSOLE_OPTIONS);
  enhanceCombo(document.getElementById("e-category"), CATEGORY_OPTIONS);
  enhanceCombo(document.getElementById("e-condition"), CONDITION_OPTIONS);
  document.getElementById("e-purchase").value = item.purchase_price ?? "";
  document.getElementById("e-estimated").value = item.estimated_value ?? "";
  document.getElementById("e-sale-status").value = item.sale_status || "";
  document.getElementById("e-storage-location").value = item.storage_location || "";
  document.getElementById("e-coop").checked = !!item.coop_campaign;
  document.getElementById("e-notes").value = item.notes || "";

  if (item.ai_price_note) {
    const box = document.getElementById("ai-note");
    box.textContent = "🤖 KI-Einschätzung: " + item.ai_price_note;
    box.classList.remove("hidden");
  }

  document.getElementById("add-photo-input").addEventListener("change", async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    try {
      const newPaths = await uploadPhotos(files);
      const photos = [...(item.photos || []), ...newPaths];
      const { error } = await supabase.from("items").update({ photos }).eq("id", id);
      if (error) throw error;
      item.photos = photos;
      await renderItemPhotos(item);
      flash("Foto hinzugefügt.");
    } catch (err) {
      flash("⚠️ Fehler beim Hochladen: " + (err.message || err));
    }
  });

  document.getElementById("edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      type: document.getElementById("e-type").value,
      title: document.getElementById("e-title").value.trim(),
      console: document.getElementById("e-console").value.trim(),
      category: document.getElementById("e-category").value.trim(),
      condition_text: document.getElementById("e-condition").value.trim(),
      details: document.getElementById("e-details").value.trim(),
      purchase_price: parseFloatOrNull(document.getElementById("e-purchase").value),
      estimated_value: parseFloatOrNull(document.getElementById("e-estimated").value),
      sale_status: document.getElementById("e-sale-status").value || null,
      storage_location: document.getElementById("e-storage-location").value.trim(),
      coop_campaign: document.getElementById("e-coop").checked,
      notes: document.getElementById("e-notes").value.trim(),
    };
    const { error } = await supabase.from("items").update(payload).eq("id", id);
    if (error) {
      flash("⚠️ Fehler beim Speichern: " + error.message);
    } else {
      flash("Änderungen gespeichert.");
    }
  });

  document.getElementById("estimate-btn").addEventListener("click", async () => {
    const status = document.getElementById("estimate-status");
    status.textContent = "Schätze Preis…";
    try {
      const data = await invokeAnalyzeFn({
        action: "price",
        item: {
          title: document.getElementById("e-title").value,
          console: document.getElementById("e-console").value,
          type: document.getElementById("e-type").value,
          condition: document.getElementById("e-condition").value,
          details: document.getElementById("e-details").value,
        },
      });
      document.getElementById("e-estimated").value = data.mid ?? "";
      status.textContent = `Geschätzt: ${data.estimated_low}–${data.estimated_high} € — ${data.note || ""}`;
      await supabase.from("items").update({ estimated_value: data.mid, ai_price_note: data.note || "" }).eq("id", id);
    } catch (err) {
      status.textContent = "⚠️ Fehler bei der Preisschätzung: " + (err.message || err);
    }
  });

  document.getElementById("delete-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!confirm("Diesen Artikel wirklich löschen?")) return;
    const storageOnlyPhotos = (item.photos || []).filter((p) => !isExternalPhotoUrl(p));
    if (storageOnlyPhotos.length) {
      await supabase.storage.from(PHOTO_BUCKET).remove(storageOnlyPhotos);
    }
    const { error } = await supabase.from("items").delete().eq("id", id);
    if (error) {
      flash("⚠️ Fehler beim Löschen: " + error.message);
    } else {
      flash("Artikel gelöscht.");
      location.hash = "#/";
    }
  });
}

async function renderItemPhotos(item) {
  const box = document.getElementById("item-photos");
  const photos = item.photos || [];
  if (photos.length === 0) {
    box.innerHTML = `<div class="no-photo big">🎮</div>`;
    return;
  }
  const urlMap = await getSignedUrlMap(photos);
  box.innerHTML = photos
    .map(
      (p, idx) => `
      <div class="photo-wrap">
        <img src="${urlMap[p] || ""}" alt="Foto">
        <button type="button" class="photo-delete" data-idx="${idx}">✕</button>
      </div>`
    )
    .join("");
  box.querySelectorAll(".photo-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Foto entfernen?")) return;
      const idx = Number(btn.dataset.idx);
      const path = photos[idx];
      if (!isExternalPhotoUrl(path)) {
        await supabase.storage.from(PHOTO_BUCKET).remove([path]);
      }
      const newPhotos = photos.filter((_, i) => i !== idx);
      await supabase.from("items").update({ photos: newPhotos }).eq("id", item.id);
      item.photos = newPhotos;
      await renderItemPhotos(item);
    });
  });
}

// ---------------------------------------------------------------------
// CSV-Export
// ---------------------------------------------------------------------
async function exportCsv() {
  const { data: items, error } = await supabase.from("items").select("*").order("created_at", { ascending: false });
  if (error) {
    flash("⚠️ Export fehlgeschlagen: " + error.message);
    return;
  }
  const header = ["Typ", "Titel", "Konsole", "Kategorie", "Zustand", "Details", "Kaufpreis", "Geschaetzter Wert", "Verkaufsstatus", "Lagerort", "Koop/Kampagne", "Notizen", "Erstellt"];
  const rows = items.map((r) => [
    TYPE_LABELS[r.type] || r.type,
    r.title,
    r.console,
    r.category,
    r.condition_text,
    r.details,
    r.purchase_price ?? "",
    r.estimated_value ?? "",
    (SALE_STATUS[r.sale_status] && SALE_STATUS[r.sale_status].label) || "",
    r.storage_location || "",
    r.coop_campaign ? "Ja" : "",
    r.notes,
    r.created_at,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sammlung_export.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

init();
