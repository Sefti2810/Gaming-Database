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
  "PSP", "PS Vita",
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
  populateConsoleFilter(items);
  setupSaleStatusFilter();
  updateViewButtons();
  applyFiltersAndRender(items);

  document.getElementById("filter-form").addEventListener("input", () => {
    updateSaleStatusSummary();
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
  document.getElementById("stats").innerHTML = `
    <div class="stat-card"><div class="stat-label">Artikel gesamt</div><div class="stat-value">${totalItems}</div></div>
    <div class="stat-card"><div class="stat-label">Investiert (Kaufpreise)</div><div class="stat-value">${totalInvested.toFixed(2)} €</div></div>
    <div class="stat-card"><div class="stat-label">Geschätzter Wert</div><div class="stat-value">${totalEstimated.toFixed(2)} €</div></div>
    <div class="stat-card ${diff >= 0 ? "pos" : "neg"}"><div class="stat-label">Differenz</div><div class="stat-value">${diff >= 0 ? "+" : ""}${diff.toFixed(2)} €</div></div>
  `;
}

function populateConsoleFilter(items) {
  const consoles = [...new Set(items.map((i) => i.console).filter(Boolean))].sort();
  const select = document.getElementById("console-filter");
  consoles.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
}

function updateSaleStatusSummary() {
  const details = document.getElementById("sale-status-filter");
  if (!details) return;
  const boxes = Array.from(details.querySelectorAll('input[name="sale_status"]'));
  const checked = boxes.filter((b) => b.checked).length;
  const countEl = details.querySelector(".ms-count");
  if (countEl) countEl.textContent = checked === boxes.length ? "" : `(${checked}/${boxes.length})`;
}

function setupSaleStatusFilter() {
  const details = document.getElementById("sale-status-filter");
  if (!details) return;
  updateSaleStatusSummary();

  details.querySelector(".ms-all")?.addEventListener("click", () => {
    details.querySelectorAll('input[name="sale_status"]').forEach((b) => (b.checked = true));
    updateSaleStatusSummary();
    details.dispatchEvent(new Event("change-request"));
    document.getElementById("filter-form").dispatchEvent(new Event("input", { bubbles: true }));
  });
  details.querySelector(".ms-none")?.addEventListener("click", () => {
    details.querySelectorAll('input[name="sale_status"]').forEach((b) => (b.checked = false));
    updateSaleStatusSummary();
    document.getElementById("filter-form").dispatchEvent(new Event("input", { bubbles: true }));
  });

  // Ausserhalb geklickt -> Dropdown schliessen.
  document.addEventListener("click", (e) => {
    if (!details.open) return;
    if (!details.contains(e.target)) details.open = false;
  });
}

async function applyFiltersAndRender(items) {
  const form = document.getElementById("filter-form");
  const fd = new FormData(form);
  const q = (fd.get("q") || "").toString().toLowerCase();
  const type = fd.get("type");
  const cons = fd.get("console");
  const saleStatuses = fd.getAll("sale_status").map(String);
  const allSaleStatusCount = form.querySelectorAll('input[name="sale_status"]').length;
  const sort = fd.get("sort");

  let filtered = items.filter((i) => {
    if (type && i.type !== type) return false;
    if (cons && i.console !== cons) return false;
    if (saleStatuses.length < allSaleStatusCount && !saleStatuses.includes(i.sale_status || "")) return false;
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
        <span class="list-title">${escapeHtml(item.title) || "(ohne Titel)"}</span>
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
          <div
