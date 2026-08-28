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
const REGION_OPTIONS = [
  "PAL (DE)", "PAL (EU)", "NTSC (US)", "NTSC-J (JP)", "Region-Free",
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

// Kurze Varianten der Verkaufsstatus-Labels fuer das direkt in Karten-/
// Listenansicht editierbare Auswahlfeld (kompakter als im Formular).
const SALE_STATUS_INLINE_OPTIONS = [
  { value: "", label: "–" },
  { value: "for_sale", label: "Zum Verkauf" },
  { value: "reserved", label: "Reserviert" },
  { value: "sold", label: "Verkauft" },
  { value: "not_for_sale", label: "Nicht verkäuflich" },
];

// Verkaufsstatus-"Badge", das gleichzeitig ein <select> ist: antippen und
// direkt umstellen, ohne den Artikel zu oeffnen. Ohne Vermerk erscheint es
// als schlichtes helles Feld (statt leer/unsichtbar).
function saleStatusInlineHtml(item) {
  const currentCls = (SALE_STATUS[item.sale_status] && SALE_STATUS[item.sale_status].cls) || "";
  const current = item.sale_status || "";
  const options = SALE_STATUS_INLINE_OPTIONS.map(
    (o) => `<option value="${o.value}" ${current === o.value ? "selected" : ""}>${o.label}</option>`
  ).join("");
  return `<select class="sale-status-inline ${currentCls}" data-id="${item.id}">${options}</select>`;
}

// Bindet die Aenderungs-Logik an alle im Container vorhandenen Inline-
// Statusfelder. Wird nach jedem Neuaufbau von Karten-/Listen-/Lagerort-
// Ansicht erneut aufgerufen. Klicks auf das <select> selbst duerfen NICHT
// zur Kartennavigation (umschliessendes <a>) fuehren, deshalb stopPropagation
// direkt am Element (nicht ueber Delegation, die waere hier zu spaet dran).
// onChange ist optional: Standardmaessig wird nach einer Aenderung das
// Dashboard + die gefilterte Uebersicht neu gezeichnet (Hauptseite). Andere
// Seiten (z.B. der Verkaufen-Bereich) haben weder #stats noch #filter-form
// im DOM und uebergeben stattdessen ihre eigene Refresh-Funktion.
function bindInlineStatusSelects(container, items, onChange) {
  if (!container) return;
  container.querySelectorAll(".sale-status-inline").forEach((sel) => {
    sel.addEventListener("mousedown", (e) => e.stopPropagation());
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", async (e) => {
      e.stopPropagation();
      const id = Number(sel.dataset.id);
      const value = sel.value;
      // defaultSelected spiegelt das urspruengliche "selected"-Attribut aus dem
      // zuletzt gerenderten HTML wider - dient hier als Rueckfall-Wert bei Fehlern.
      const before = Array.from(sel.options).find((o) => o.defaultSelected)?.value ?? "";
      sel.disabled = true;
      const { error } = await supabase.from("items").update({ sale_status: value || null }).eq("id", id);
      sel.disabled = false;
      if (error) {
        flash("⚠️ Status konnte nicht geändert werden: " + error.message);
        sel.value = before;
        return;
      }
      const item = items.find((i) => i.id === id);
      if (item) item.sale_status = value || null;
      flash("Status aktualisiert.");
      if (onChange) {
        onChange();
      } else {
        renderStats(items);
        applyFiltersAndRender(items);
      }
    });
  });
}

// Favoriten-Stern (⭐/☆): eigenstaendiger Button, bewusst AUSSERHALB jeder
// <a>-Verlinkung platziert (siehe Kommentar bei den Status-Feldern) - antippen
// schaltet den Favoritenstatus um, ohne den Artikel zu oeffnen.
function favoriteButtonHtml(item) {
  const fav = !!item.is_favorite;
  return `<button type="button" class="fav-btn ${fav ? "is-fav" : ""}" data-id="${item.id}" title="${fav ? "Favorit entfernen" : "Als Favorit markieren"}" aria-label="Favorit">${fav ? "⭐" : "☆"}</button>`;
}

// onChange optional, siehe Kommentar bei bindInlineStatusSelects.
function bindFavoriteButtons(container, items, onChange) {
  if (!container) return;
  container.querySelectorAll(".fav-btn").forEach((btn) => {
    btn.addEventListener("mousedown", (e) => e.stopPropagation());
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const id = Number(btn.dataset.id);
      const item = items.find((i) => i.id === id);
      if (!item) return;
      const next = !item.is_favorite;
      btn.disabled = true;
      const { error } = await supabase.from("items").update({ is_favorite: next }).eq("id", id);
      btn.disabled = false;
      if (error) {
        flash("⚠️ Favorit konnte nicht geändert werden: " + error.message);
        return;
      }
      item.is_favorite = next;
      btn.classList.toggle("is-fav", next);
      btn.textContent = next ? "⭐" : "☆";
      btn.title = next ? "Favorit entfernen" : "Als Favorit markieren";
      // Falls der "Nur Favoriten"-Filter aktiv ist, muss der Artikel beim
      // Entfernen sofort aus der Ansicht verschwinden.
      if (onChange) onChange();
      else applyFiltersAndRender(items);
    });
  });
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
document.getElementById("export-pdf-btn").addEventListener("click", exportPdf);

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
  const savedView = localStorage.getItem(VIEW_KEY);
  currentView = savedView === "list" || savedView === "storage" ? savedView : "grid";
} catch (_) {
  // localStorage evtl. nicht verfuegbar - Standardansicht (Karten) nutzen.
}

// Bulk-Bearbeitung in der Liste-/Lagerort-Ansicht: ausgewaehlte Artikel-IDs.
let selectedIds = new Set();

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
  } else if (hash === "#/verkaufen") {
    renderVerkaufen();
  } else if (hash.startsWith("#/item/")) {
    const id = hash.split("/")[2];
    renderItem(id);
  } else {
    renderIndex();
  }
}

let flashHideTimer = null;
let flashRemoveTimer = null;
function flash(msg) {
  const box = document.getElementById("flash");
  clearTimeout(flashHideTimer);
  clearTimeout(flashRemoveTimer);
  box.textContent = msg;
  box.classList.remove("hidden");
  // Reflow erzwingen, damit die Einblend-Transition auch dann greift, wenn
  // kurz hintereinander mehrere Meldungen kommen.
  void box.offsetWidth;
  box.classList.add("show");
  flashHideTimer = setTimeout(() => {
    box.classList.remove("show");
    flashRemoveTimer = setTimeout(() => box.classList.add("hidden"), 250);
  }, 3500);
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
  const favBox = form.querySelector('[name="favorites_only"]');
  if (favBox) favBox.checked = !!savedFilterState.favoritesOnly;
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

function skeletonGridHtml(count = 8) {
  return Array.from({ length: count })
    .map(
      () => `
      <div class="skeleton-card">
        <div class="skeleton-photo"></div>
        <div class="skeleton-line" style="width:70%"></div>
        <div class="skeleton-line short"></div>
      </div>`
    )
    .join("");
}

async function renderIndex() {
  const main = document.getElementById("main");
  main.innerHTML = "";
  main.appendChild(document.getElementById("tpl-index").content.cloneNode(true));

  // Sofort Platzhalter zeigen, statt bis zum Laden der Daten eine leere Fläche.
  const skeletonGrid = document.getElementById("grid");
  if (skeletonGrid) skeletonGrid.innerHTML = skeletonGridHtml();

  const { data: items, error } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    main.innerHTML = `<div class="notice">Fehler beim Laden: ${error.message}</div>`;
    return;
  }

  selectedIds.clear();
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
  document.getElementById("view-storage-btn").addEventListener("click", () => setView("storage", items));
  setupBulkToolbar(items);
  ensureBulkCheckboxHandler();
}

function setView(view, items) {
  currentView = view;
  if (view === "grid") selectedIds.clear();
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
  const storageBtn = document.getElementById("view-storage-btn");
  const listHeader = document.getElementById("list-header");
  const grid = document.getElementById("grid");
  const storageView = document.getElementById("storage-view");
  if (!gridBtn || !listBtn) return;
  gridBtn.classList.toggle("active", currentView === "grid");
  listBtn.classList.toggle("active", currentView === "list");
  if (storageBtn) storageBtn.classList.toggle("active", currentView === "storage");
  const indicator = document.getElementById("view-toggle-indicator");
  if (indicator) {
    const idx = { grid: 0, list: 1, storage: 2 }[currentView] ?? 0;
    indicator.style.transform = `translateX(${idx * 100}%)`;
  }
  if (listHeader) listHeader.classList.toggle("hidden", currentView !== "list");
  if (grid) {
    grid.classList.toggle("list", currentView === "list");
    grid.classList.toggle("hidden", currentView === "storage");
  }
  if (storageView) storageView.classList.toggle("hidden", currentView !== "storage");
}

// ---------------------------------------------------------------------
// Bulk-Bearbeitung: Checkboxen in der Liste-/Lagerort-Ansicht erlauben,
// mehrere Artikel gleichzeitig zu bearbeiten (Status, Lagerort, Konsole).
// ---------------------------------------------------------------------
let bulkChangeBound = false;
function ensureBulkCheckboxHandler() {
  if (bulkChangeBound) return;
  bulkChangeBound = true;
  document.getElementById("main").addEventListener("change", (e) => {
    if (e.target.id === "list-select-all") {
      const checked = e.target.checked;
      document.querySelectorAll(".list-row-check").forEach((cb) => {
        cb.checked = checked;
        const id = Number(cb.dataset.id);
        if (checked) selectedIds.add(id);
        else selectedIds.delete(id);
      });
      updateBulkToolbar();
      updatePackageCalc();
      return;
    }
    const cb = e.target.closest(".list-row-check");
    if (!cb) return;
    const id = Number(cb.dataset.id);
    if (cb.checked) selectedIds.add(id);
    else selectedIds.delete(id);
    updateBulkToolbar();
    updatePackageCalc();
  });
}

function updateBulkToolbar() {
  const toolbar = document.getElementById("bulk-toolbar");
  if (!toolbar) return;
  const showToolbar = selectedIds.size > 0 && (currentView === "list" || currentView === "storage");
  toolbar.classList.toggle("hidden", !showToolbar);
  const countEl = document.getElementById("bulk-count");
  if (countEl) countEl.textContent = `${selectedIds.size} ausgewählt`;
  const selectAll = document.getElementById("list-select-all");
  if (selectAll) {
    const visibleIds = Array.from(document.querySelectorAll(".list-row-check")).map((cb) => Number(cb.dataset.id));
    selectAll.checked = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  }
}

async function bulkUpdate(fields, items) {
  if (selectedIds.size === 0) return;
  const ids = Array.from(selectedIds);
  if (!confirm(`${ids.length} Artikel aktualisieren?`)) return;
  const { error } = await supabase.from("items").update(fields).in("id", ids);
  if (error) {
    flash("⚠️ Fehler bei der Bulk-Bearbeitung: " + error.message);
    return;
  }
  flash(`${ids.length} Artikel aktualisiert.`);
  selectedIds.clear();
  renderIndex();
}

function setupBulkToolbar(items) {
  document.getElementById("bulk-apply-status").addEventListener("click", () => {
    const val = document.getElementById("bulk-sale-status").value;
    if (val === "__keep__") {
      flash("Bitte zuerst einen Status auswählen.");
      return;
    }
    bulkUpdate({ sale_status: val || null }, items);
  });
  document.getElementById("bulk-apply-storage").addEventListener("click", () => {
    const val = document.getElementById("bulk-storage-location").value.trim();
    bulkUpdate({ storage_location: val }, items);
  });
  document.getElementById("bulk-apply-console").addEventListener("click", () => {
    const val = document.getElementById("bulk-console").value.trim();
    if (!val) {
      flash("Bitte eine Konsole zum Umbenennen eingeben.");
      return;
    }
    bulkUpdate({ console: val }, items);
  });
  document.getElementById("bulk-clear").addEventListener("click", () => {
    selectedIds.clear();
    applyFiltersAndRender(items);
  });
}

// Fuer verkaufte Artikel: den tatsaechlichen Verkaufspreis nutzen, wenn
// vorhanden, sonst ersatzweise den geschaetzten Wert (falls nie nachgetragen).
function realizedValue(item) {
  return item.sold_price != null ? Number(item.sold_price) : Number(item.estimated_value) || 0;
}

function eur(n) {
  return n == null ? "–" : Number(n).toFixed(2) + " €";
}

// Potentieller Gewinn eines einzelnen Artikels: geschätzter Marktwert minus
// Kaufpreis. Nur berechenbar, wenn beide Werte vorhanden sind.
function potentialProfit(item) {
  if (item.purchase_price == null || item.estimated_value == null) return null;
  return Number(item.estimated_value) - Number(item.purchase_price);
}

function signedEur(n) {
  if (n == null) return "–";
  return (n >= 0 ? "+" : "") + Number(n).toFixed(2) + " €";
}

// Erwarteter Verkaufspreis eines Artikels: Wunschpreis, falls gesetzt, sonst
// der geschätzte Marktwert als Rückfallwert.
function expectedSalePrice(item) {
  if (item.asking_price != null) return Number(item.asking_price);
  if (item.estimated_value != null) return Number(item.estimated_value);
  return null;
}

// "highlight" markiert die wichtigsten Kennzahlen groesser/betonter - genutzt
// vom Dashboard und vom Verkaufen-Bereich.
function statCardHtml(icon, label, value, cls, highlight) {
  return `
    <div class="stat-card ${cls || ""} ${highlight ? "highlight" : ""}">
      <div class="stat-icon">${icon}</div>
      <div class="stat-body"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>
    </div>`;
}

function renderStats(items) {
  const totalItems = items.length;
  const totalInvested = items.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
  const totalEstimated = items.reduce((s, i) => s + (Number(i.estimated_value) || 0), 0);
  const totalPotentialProfit = totalEstimated - totalInvested;
  const soldItems = items.filter((i) => i.sale_status === "sold");
  const totalSold = soldItems.reduce((s, i) => s + realizedValue(i), 0);
  const soldInvested = soldItems.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
  const soldProfit = totalSold - soldInvested;
  document.getElementById("stats").innerHTML =
    statCardHtml("📦", "Artikel gesamt", totalItems) +
    statCardHtml("💶", "Investiert", eur(totalInvested)) +
    statCardHtml("💰", "Geschätzter Wert", eur(totalEstimated), "", true) +
    statCardHtml("📊", "Potentieller Gewinn", signedEur(totalPotentialProfit), totalPotentialProfit >= 0 ? "pos" : "neg", true) +
    statCardHtml("✅", "Verkaufserlöse", eur(totalSold)) +
    statCardHtml("📈", "Realisierter Gewinn/Verlust", signedEur(soldProfit), soldProfit >= 0 ? "pos" : "neg");
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
    if (i.sale_status === "sold") byConsole[key].sold += realizedValue(i);
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

// Eine Zeile der Listenansicht (auch von der Lagerort-Ansicht wiederverwendet).
// Checkbox UND Status-Select liegen bewusst AUSSERHALB der <a>-Verlinkung
// (als Geschwister zwischen zwei "display:contents"-Links), damit ein Klick/Tipp
// darauf nicht gleichzeitig zum Artikel navigiert - auf dem Handy/als installierte
// App reicht ein reines stopPropagation() im Select dafür nicht zuverlässig aus.
function listRowHtml(item) {
  const checked = selectedIds.has(item.id) ? "checked" : "";
  return `
      <div class="list-row">
        <span class="list-check"><input type="checkbox" class="list-row-check" data-id="${item.id}" ${checked}></span>
        <span class="list-fav">${favoriteButtonHtml(item)}</span>
        <a class="list-row-link" href="#/item/${item.id}">
          <span class="badge-inline badge-${item.type}">${TYPE_LABELS[item.type] || item.type}</span>
          <span class="list-title">${escapeHtml(item.title) || "(ohne Titel)"}${item.coop_campaign ? ' <span class="coop-badge">🎮 Koop</span>' : ""}</span>
          <span class="list-console">${escapeHtml(item.console)}</span>
        </a>
        <span class="list-status">${saleStatusInlineHtml(item)}</span>
        <a class="list-row-link" href="#/item/${item.id}">
          <span class="list-price">${item.purchase_price != null ? Number(item.purchase_price).toFixed(2) + " €" : "–"}</span>
          <span class="list-price">${item.estimated_value != null ? Number(item.estimated_value).toFixed(2) + " €" : "–"}</span>
        </a>
      </div>`;
}

// Lagerort-Ansicht: die gefilterten Artikel nach Lagerort gruppiert darstellen,
// damit man auf einen Blick sieht, was in welcher Kiste/welchem Regal liegt.
function renderStorageView(filtered) {
  const container = document.getElementById("storage-view");
  if (!container) return;
  const NO_LOCATION = "(Ohne Lagerort)";
  const groups = {};
  filtered.forEach((item) => {
    const key = item.storage_location && item.storage_location.trim() ? item.storage_location.trim() : NO_LOCATION;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    if (a === NO_LOCATION) return 1;
    if (b === NO_LOCATION) return -1;
    return a.localeCompare(b);
  });
  container.innerHTML = sortedKeys
    .map(
      (key) => `
    <div class="storage-group">
      <div class="storage-group-header">
        <span>${escapeHtml(key)}</span>
        <span class="storage-group-count">${groups[key].length} Artikel</span>
      </div>
      <div class="storage-group-items">${groups[key].map(listRowHtml).join("")}</div>
    </div>`
    )
    .join("");
}

// Zeigt aktive Filter als entfernbare Chips über der Liste an, damit man auf
// einen Blick sieht, was gerade eingeschränkt ist, und es einzeln wieder
// aufheben kann, ohne das ganze Filter-Menü zu öffnen.
function renderFilterChips({ q, types, allTypeCount, consoles, allConsoleCount, saleStatuses, allSaleStatusCount, coopOnly, favoritesOnly }) {
  const box = document.getElementById("filter-chips");
  if (!box) return;
  const chips = [];

  if (q) {
    chips.push({
      label: `Suche: "${q}"`,
      clear: () => {
        const input = document.querySelector('#filter-form [name="q"]');
        if (input) input.value = "";
      },
    });
  }
  if (types.length < allTypeCount) {
    const labels = types.map((t) => TYPE_LABELS[t] || t).join(", ") || "keine";
    chips.push({
      label: `Typ: ${labels}`,
      clear: () => document.querySelectorAll('#filter-form input[name="type"]').forEach((b) => (b.checked = true)),
    });
  }
  if (consoles.length < allConsoleCount) {
    const label = consoles.length > 0 && consoles.length <= 3 ? consoles.join(", ") : `${consoles.length} ausgewählt`;
    chips.push({
      label: `Konsole: ${label}`,
      clear: () => document.querySelectorAll('#filter-form input[name="console"]').forEach((b) => (b.checked = true)),
    });
  }
  if (saleStatuses.length < allSaleStatusCount) {
    const labels = saleStatuses.map((s) => (s === "" ? "kein Vermerk" : SALE_STATUS[s]?.label || s)).join(", ") || "keine";
    chips.push({
      label: `Status: ${labels}`,
      clear: () => document.querySelectorAll('#filter-form input[name="sale_status"]').forEach((b) => (b.checked = true)),
    });
  }
  if (coopOnly) {
    chips.push({
      label: "🎮 Nur Koop/Kampagne",
      clear: () => {
        const cb = document.getElementById("coop-only-filter");
        if (cb) cb.checked = false;
      },
    });
  }
  if (favoritesOnly) {
    chips.push({
      label: "⭐ Nur Favoriten",
      clear: () => {
        const cb = document.getElementById("favorites-only-filter");
        if (cb) cb.checked = false;
      },
    });
  }

  if (chips.length === 0) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = chips
    .map((c, i) => `<span class="filter-chip" data-idx="${i}">${escapeHtml(c.label)}<button type="button" aria-label="Filter entfernen">✕</button></span>`)
    .join("");
  box.querySelectorAll(".filter-chip button").forEach((btn, i) => {
    btn.addEventListener("click", () => {
      chips[i].clear();
      updateAllMsCounts();
      document.getElementById("filter-form").dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}

async function applyFiltersAndRender(items) {
  const form = document.getElementById("filter-form");
  const fd = new FormData(form);
  const q = (fd.get("q") || "").toString().toLowerCase();
  const types = fd.getAll("type").map(String);
  const consoles = fd.getAll("console").map(String);
  const saleStatuses = fd.getAll("sale_status").map(String);
  const coopOnly = fd.get("coop_only") === "on";
  const favoritesOnly = fd.get("favorites_only") === "on";
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
    favoritesOnly,
  };

  renderFilterChips({ q, types, allTypeCount, consoles, allConsoleCount, saleStatuses, allSaleStatusCount, coopOnly, favoritesOnly });
  const hasActiveFilter =
    !!q ||
    types.length < allTypeCount ||
    consoles.length < allConsoleCount ||
    saleStatuses.length < allSaleStatusCount ||
    coopOnly ||
    favoritesOnly;

  let filtered = items.filter((i) => {
    if (types.length < allTypeCount && !types.includes(i.type || "")) return false;
    if (consoles.length < allConsoleCount && !consoles.includes(i.console || "")) return false;
    if (saleStatuses.length < allSaleStatusCount && !saleStatuses.includes(i.sale_status || "")) return false;
    if (coopOnly && !i.coop_campaign) return false;
    if (favoritesOnly && !i.is_favorite) return false;
    if (q) {
      const hay = `${i.title} ${i.console} ${i.details} ${i.notes}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Gewinn/Rendite werden nur berechnet, wenn Kaufpreis UND Wert vorhanden sind;
  // fehlende Werte landen beim Sortieren immer ans Ende, statt die Reihenfolge
  // durch eine stille 0 zu verfälschen.
  const marginPct = (i) => {
    const p = potentialProfit(i);
    if (p == null || !i.purchase_price) return null;
    return (p / Number(i.purchase_price)) * 100;
  };
  const byNullsLast = (fn, dir) => (a, b) => {
    const va = fn(a);
    const vb = fn(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * dir;
  };
  const cmp = {
    created_desc: (a, b) => new Date(b.created_at) - new Date(a.created_at),
    created_asc: (a, b) => new Date(a.created_at) - new Date(b.created_at),
    title_asc: (a, b) => (a.title || "").localeCompare(b.title || ""),
    title_desc: (a, b) => (b.title || "").localeCompare(a.title || ""),
    value_desc: (a, b) => (b.estimated_value || 0) - (a.estimated_value || 0),
    value_asc: (a, b) => (a.estimated_value || 0) - (b.estimated_value || 0),
    purchase_desc: (a, b) => (b.purchase_price || 0) - (a.purchase_price || 0),
    purchase_asc: (a, b) => (a.purchase_price || 0) - (b.purchase_price || 0),
    profit_desc: byNullsLast(potentialProfit, -1),
    profit_asc: byNullsLast(potentialProfit, 1),
    margin_desc: byNullsLast(marginPct, -1),
    margin_asc: byNullsLast(marginPct, 1),
  }[sort] || (() => 0);
  filtered = filtered.sort(cmp);

  updateViewButtons();

  const grid = document.getElementById("grid");
  const storageContainer = document.getElementById("storage-view");
  const empty = document.getElementById("empty-state");
  fadeOutEl(grid);
  fadeOutEl(storageContainer);
  if (filtered.length === 0) {
    grid.innerHTML = "";
    if (storageContainer) storageContainer.innerHTML = "";
    if (empty) {
      empty.innerHTML =
        items.length === 0
          ? `<div class="empty-state-icon">🎮</div>
             <p>Noch keine Artikel erfasst.</p>
             <a class="btn-primary" href="#/add">Ersten Artikel hinzufügen</a>`
          : `<div class="empty-state-icon">🔍</div>
             <p>Keine Artikel gefunden.</p>
             <p class="empty-sub">Passe deine Filter oder die Suche an.</p>
             ${hasActiveFilter ? `<button type="button" id="empty-reset-filters" class="btn-secondary">Filter zurücksetzen</button>` : ""}`;
      empty.classList.remove("hidden");
      const resetBtn = document.getElementById("empty-reset-filters");
      if (resetBtn) {
        resetBtn.addEventListener("click", () => {
          const form = document.getElementById("filter-form");
          form.querySelectorAll('input[type="checkbox"][name]').forEach((b) => (b.checked = true));
          const qInput = form.querySelector('[name="q"]');
          if (qInput) qInput.value = "";
          const coopBox = document.getElementById("coop-only-filter");
          if (coopBox) coopBox.checked = false;
          const favBox = document.getElementById("favorites-only-filter");
          if (favBox) favBox.checked = false;
          updateAllMsCounts();
          form.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
    }
    updateBulkToolbar();
    return;
  }
  if (empty) empty.classList.add("hidden");

  if (currentView === "storage") {
    renderStorageView(filtered);
    updateBulkToolbar();
    bindInlineStatusSelects(storageContainer, items);
    bindFavoriteButtons(storageContainer, items);
    fadeInEl(storageContainer);
    return;
  }

  if (currentView === "list") {
    // Listenansicht: bewusst ohne Fotos/Signed-URLs fuer einen schnellen Überblick.
    grid.innerHTML = filtered.map(listRowHtml).join("");
    updateBulkToolbar();
    bindInlineStatusSelects(grid, items);
    bindFavoriteButtons(grid, items);
    fadeInEl(grid);
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
      // Der Status-Select UND der Favoriten-Stern liegen bewusst AUSSERHALB
      // der <a>-Verlinkung (als Geschwister zwischen zwei "display:contents"-
      // Links), damit ein Tipp darauf nicht gleichzeitig den Artikel öffnet.
      // Auf dem Desktop reichte dafür ein stopPropagation(), aber auf dem
      // Handy/als installierte App (PWA) navigiert ein verschachteltes
      // interaktives Element in manchen Browsern trotzdem zum umschliessenden
      // Link - daher hier strukturell gelöst, genau wie bei der Checkbox.
      const profit = potentialProfit(item);
      return `
      <div class="card">
        ${favoriteButtonHtml(item)}
        <a class="card-link" href="#/item/${item.id}">
          <div class="card-photo">
            ${photoHtml}
            <span class="badge badge-${item.type}">${TYPE_LABELS[item.type] || item.type}</span>
          </div>
          <div class="card-body-top">
            <div class="card-title">${escapeHtml(item.title) || "(ohne Titel)"}</div>
            <div class="card-console">${escapeHtml(item.console)}${item.category ? " · " + escapeHtml(item.category) : ""}</div>
          </div>
        </a>
        <div class="card-sale">${saleStatusInlineHtml(item)}${item.coop_campaign ? ' <span class="coop-badge">🎮 Koop</span>' : ""}</div>
        <a class="card-link" href="#/item/${item.id}">
          <div class="card-body-bottom">
            <div class="card-value-block">
              <div class="card-value-main">${eur(item.estimated_value)}</div>
              <div class="card-value-label">Geschätzter Marktwert</div>
              <div class="card-value-sub">
                <span>Kauf: ${eur(item.purchase_price)}</span>
                <span class="${profit == null ? "" : profit >= 0 ? "pos" : "neg"}">Gewinn: ${signedEur(profit)}</span>
              </div>
            </div>
          </div>
        </a>
      </div>`;
    })
    .join("");
  bindInlineStatusSelects(grid, items);
  bindFavoriteButtons(grid, items);
  fadeInEl(grid);
}

// ---------------------------------------------------------------------
// Verkaufen-Bereich: zeigt nur Artikel mit Verkaufsstatus "Zum Verkauf
// vorgesehen" (bestehende Statusfunktion, keine neue parallele Logik) mit
// Zusammenfassung, Mehrfachauswahl + Paket-Rechner, und der Verkaufshistorie
// (bereits verkaufte Artikel) darunter.
// ---------------------------------------------------------------------
// sellItemsCache haelt die aktuell zum Verkauf stehenden Artikel, damit der
// Paket-Rechner (ausgeloest von der global delegierten Checkbox-Behandlung in
// ensureBulkCheckboxHandler) jederzeit auf die Artikeldaten zugreifen kann.
let sellItemsCache = [];

function sellRowHtml(item) {
  const expected = expectedSalePrice(item);
  const profit = item.purchase_price != null && expected != null ? expected - Number(item.purchase_price) : null;
  const checked = selectedIds.has(item.id) ? "checked" : "";
  return `
      <div class="sell-row">
        <span class="list-check"><input type="checkbox" class="list-row-check" data-id="${item.id}" ${checked}></span>
        <span class="list-fav">${favoriteButtonHtml(item)}</span>
        <a class="list-row-link" href="#/item/${item.id}">
          <span class="sell-title">${escapeHtml(item.title) || "(ohne Titel)"}</span>
          <span class="sell-console">${escapeHtml(item.console)}</span>
        </a>
        <span class="list-status">${saleStatusInlineHtml(item)}</span>
        <a class="list-row-link" href="#/item/${item.id}">
          <span class="list-price">Kauf: ${eur(item.purchase_price)}</span>
          <span class="list-price">${item.asking_price != null ? "Wunsch" : "Wert"}: ${eur(expected)}</span>
          <span class="list-price ${profit == null ? "" : profit >= 0 ? "pos" : "neg"}">${signedEur(profit)}</span>
        </a>
      </div>`;
}

function renderSoldHistory(soldItems) {
  const box = document.getElementById("sold-history-body");
  if (!box) return;
  if (soldItems.length === 0) {
    box.innerHTML = `<p class="empty-sub">Noch keine Verkäufe erfasst.</p>`;
    return;
  }
  const revenue = soldItems.reduce((s, i) => s + realizedValue(i), 0);
  const invested = soldItems.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
  const profit = revenue - invested;
  const rows = soldItems
    .map((i) => {
      const p = i.sold_price != null && i.purchase_price != null ? Number(i.sold_price) - Number(i.purchase_price) : null;
      return `<div class="sold-row">
        <span class="sold-title">${escapeHtml(i.title) || "(ohne Titel)"}</span>
        <span class="sold-console">${escapeHtml(i.console)}</span>
        <span class="list-price">Kauf: ${eur(i.purchase_price)}</span>
        <span class="list-price">Verkauft: ${eur(i.sold_price)}</span>
        <span class="list-price ${p == null ? "" : p >= 0 ? "pos" : "neg"}">${p == null ? "–" : signedEur(p)}</span>
      </div>`;
    })
    .join("");
  box.innerHTML = `
    <div class="sold-summary">
      <span><strong>${soldItems.length}</strong> Verkäufe</span>
      <span><strong>${eur(revenue)}</strong> Umsatz</span>
      <span><strong>${eur(invested)}</strong> Einkaufskosten</span>
      <span class="${profit >= 0 ? "pos" : "neg"}"><strong>${signedEur(profit)}</strong> Gewinn</span>
    </div>
    <div class="sold-list">${rows}</div>`;
}

// Liest live Auswahl + Artikeldaten und aktualisiert die Ausgabe des
// Paket-Rechners. Wird sowohl bei Auswahl-Aenderungen als auch bei jeder
// Eingabe im Paketpreis-Feld aufgerufen (siehe updatePackageCalc).
function recomputePackageResult() {
  const itemsBox = document.getElementById("package-items");
  const resultBox = document.getElementById("package-result");
  const priceInput = document.getElementById("package-price");
  if (!itemsBox || !resultBox || !priceInput) return;

  const selected = sellItemsCache.filter((i) => selectedIds.has(i.id));
  itemsBox.innerHTML = selected
    .map((i) => `<span class="package-item">${escapeHtml(i.title) || "(ohne Titel)"} – ${eur(expectedSalePrice(i))}</span>`)
    .join("");

  const singleSum = selected.reduce((s, i) => s + (expectedSalePrice(i) || 0), 0);
  const invested = selected.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
  const packagePrice = parseFloat(priceInput.value);

  if (isNaN(packagePrice)) {
    resultBox.innerHTML = `
      <div><span class="label">Einzelwert-Summe</span><strong>${eur(singleSum)}</strong></div>
      <div><span class="label">Einkaufskosten</span><strong>${eur(invested)}</strong></div>`;
    return;
  }
  const discount = singleSum - packagePrice;
  const discountPct = singleSum > 0 ? (discount / singleSum) * 100 : 0;
  const profit = packagePrice - invested;
  const marginPct = invested > 0 ? (profit / invested) * 100 : null;
  resultBox.innerHTML = `
    <div><span class="label">Einzelwert-Summe</span><strong>${eur(singleSum)}</strong></div>
    <div><span class="label">Rabatt</span><strong>${eur(discount)} (${discountPct.toFixed(1)} %)</strong></div>
    <div><span class="label">Einkaufskosten</span><strong>${eur(invested)}</strong></div>
    <div><span class="label">Gewinn</span><strong class="${profit >= 0 ? "pos" : "neg"}">${signedEur(profit)}</strong></div>
    <div><span class="label">Rendite</span><strong class="${marginPct == null ? "" : marginPct >= 0 ? "pos" : "neg"}">${
    marginPct == null ? "–" : (marginPct >= 0 ? "+" : "") + marginPct.toFixed(1) + " %"
  }</strong></div>`;
}

// Zeigt/versteckt den Paket-Rechner je nach Auswahlgroesse (ab 2 Artikeln
// sinnvoll) und bindet das Paketpreis-Feld einmalig. Wird von der global
// delegierten Checkbox-Behandlung (ensureBulkCheckboxHandler) aufgerufen -
// existiert auf anderen Seiten kein #package-calc, ist dieser Aufruf ein No-op.
function updatePackageCalc() {
  const box = document.getElementById("package-calc");
  if (!box) return;
  const count = sellItemsCache.filter((i) => selectedIds.has(i.id)).length;
  box.classList.toggle("hidden", count < 2);
  const priceInput = document.getElementById("package-price");
  if (priceInput && !priceInput.dataset.calcBound) {
    priceInput.dataset.calcBound = "1";
    priceInput.addEventListener("input", recomputePackageResult);
  }
  if (count >= 2) recomputePackageResult();
}

async function renderVerkaufen() {
  const main = document.getElementById("main");
  main.innerHTML = "";
  main.appendChild(document.getElementById("tpl-verkaufen").content.cloneNode(true));
  selectedIds.clear();

  const { data: allItems, error } = await supabase.from("items").select("*").order("created_at", { ascending: false });

  if (error) {
    main.innerHTML = `<div class="notice">Fehler beim Laden: ${error.message}</div>`;
    return;
  }

  const items = (allItems || []).filter((i) => i.sale_status === "for_sale");
  const soldItems = (allItems || []).filter((i) => i.sale_status === "sold");
  sellItemsCache = items;
  renderSoldHistory(soldItems);

  const list = document.getElementById("sell-list");
  const empty = document.getElementById("sell-empty");
  const statsBox = document.getElementById("sell-stats");
  const toolbar = document.getElementById("sell-toolbar");

  if (items.length === 0) {
    statsBox.innerHTML = "";
    list.innerHTML = "";
    if (toolbar) toolbar.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  if (toolbar) toolbar.classList.remove("hidden");

  const invested = items.reduce((s, i) => s + (Number(i.purchase_price) || 0), 0);
  const expected = items.reduce((s, i) => s + (expectedSalePrice(i) || 0), 0);
  const potential = expected - invested;
  statsBox.innerHTML =
    statCardHtml("🏷️", "Artikel zum Verkauf", items.length) +
    statCardHtml("💶", "Einkaufskosten", eur(invested)) +
    statCardHtml("💰", "Erwarteter Erlös", eur(expected), "", true) +
    statCardHtml("📊", "Potentieller Gewinn", signedEur(potential), potential >= 0 ? "pos" : "neg", true);

  list.innerHTML = items.map(sellRowHtml).join("");
  bindInlineStatusSelects(list, items, () => renderVerkaufen());
  bindFavoriteButtons(list, items, () => renderVerkaufen());
  ensureBulkCheckboxHandler();
  updatePackageCalc();
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
  enhanceCombo(document.getElementById("f-region"), REGION_OPTIONS);

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
        asking_price: parseFloatOrNull(document.getElementById("f-asking").value),
        minimum_price: parseFloatOrNull(document.getElementById("f-minimum").value),
        region: document.getElementById("f-region").value.trim(),
        sale_status: document.getElementById("f-sale-status").value || null,
        sold_price: parseFloatOrNull(document.getElementById("f-sold-price").value),
        storage_location: document.getElementById("f-storage-location").value.trim(),
        coop_campaign: document.getElementById("f-coop").checked,
        is_favorite: document.getElementById("f-favorite").checked,
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
  document.getElementById("e-region").value = item.region || "";

  enhanceCombo(document.getElementById("e-console"), CONSOLE_OPTIONS);
  enhanceCombo(document.getElementById("e-category"), CATEGORY_OPTIONS);
  enhanceCombo(document.getElementById("e-condition"), CONDITION_OPTIONS);
  enhanceCombo(document.getElementById("e-region"), REGION_OPTIONS);
  document.getElementById("e-purchase").value = item.purchase_price ?? "";
  document.getElementById("e-estimated").value = item.estimated_value ?? "";
  document.getElementById("e-asking").value = item.asking_price ?? "";
  document.getElementById("e-minimum").value = item.minimum_price ?? "";
  document.getElementById("e-sale-status").value = item.sale_status || "";
  document.getElementById("e-sold-price").value = item.sold_price ?? "";
  document.getElementById("e-storage-location").value = item.storage_location || "";
  document.getElementById("e-coop").checked = !!item.coop_campaign;
  document.getElementById("e-favorite").checked = !!item.is_favorite;
  document.getElementById("e-notes").value = item.notes || "";
  setupListingGenerator(item);
  setupProfitCalculator(item);

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
      asking_price: parseFloatOrNull(document.getElementById("e-asking").value),
      minimum_price: parseFloatOrNull(document.getElementById("e-minimum").value),
      region: document.getElementById("e-region").value.trim(),
      sale_status: document.getElementById("e-sale-status").value || null,
      sold_price: parseFloatOrNull(document.getElementById("e-sold-price").value),
      storage_location: document.getElementById("e-storage-location").value.trim(),
      coop_campaign: document.getElementById("e-coop").checked,
      is_favorite: document.getElementById("e-favorite").checked,
      notes: document.getElementById("e-notes").value.trim(),
    };
    const { error } = await supabase.from("items").update(payload).eq("id", id);
    if (error) {
      flash("⚠️ Fehler beim Speichern: " + error.message);
    } else {
      Object.assign(item, payload);
      flash("Änderungen gespeichert.");
      setupListingGenerator(item);
      setupProfitCalculator(item);
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

// ---------------------------------------------------------------------
// Gewinnrechner auf der Artikel-Detailseite: eigenstaendiges Rechen-Tool
// (Kaufpreis/Verkaufspreis -> Gewinn + Rendite %), unabhaengig vom
// Formular - hier eingegebene Werte werden NICHT gespeichert, es ist reines
// Durchprobieren. Vorbefuellt mit Kaufpreis und Wunschpreis (bzw. Marktwert
// als Rueckfall) des Artikels.
// ---------------------------------------------------------------------
function setupProfitCalculator(item) {
  const purchaseInput = document.getElementById("calc-purchase");
  const saleInput = document.getElementById("calc-sale");
  const profitOut = document.getElementById("calc-profit");
  const marginOut = document.getElementById("calc-margin");
  if (!purchaseInput || !saleInput || !profitOut || !marginOut) return;

  purchaseInput.value = item.purchase_price ?? "";
  saleInput.value = expectedSalePrice(item) ?? "";

  function recompute() {
    const p = parseFloat(purchaseInput.value);
    const s = parseFloat(saleInput.value);
    if (isNaN(p) || isNaN(s)) {
      profitOut.textContent = "–";
      profitOut.className = "";
      marginOut.textContent = "–";
      marginOut.className = "";
      return;
    }
    const profit = s - p;
    const margin = p > 0 ? (profit / p) * 100 : null;
    profitOut.textContent = signedEur(profit);
    profitOut.className = profit >= 0 ? "pos" : "neg";
    marginOut.textContent = margin == null ? "–" : (margin >= 0 ? "+" : "") + margin.toFixed(1) + " %";
    marginOut.className = margin == null ? "" : margin >= 0 ? "pos" : "neg";
  }

  // Nur einmal binden (die Eingabefelder bleiben beim Neuaufbau der Seite
  // erhalten), aber bei jedem Aufruf frisch vorbefuellen und neu berechnen.
  if (!purchaseInput.dataset.calcBound) {
    purchaseInput.dataset.calcBound = "1";
    purchaseInput.addEventListener("input", recompute);
    saleInput.addEventListener("input", recompute);
  }
  recompute();
}

// ---------------------------------------------------------------------
// Angebotstext-Generator: fuer Artikel, die zum Verkauf vorgesehen oder
// reserviert sind, wird auf Knopfdruck ein fertiger Text zum Copy-Pasten
// (z.B. fuer eBay Kleinanzeigen) erzeugt.
// ---------------------------------------------------------------------
function buildListingText(item) {
  const lines = [];
  const consoleLabel = item.console ? ` (${item.console})` : "";
  lines.push(`${item.title || "Artikel"}${consoleLabel}`);
  if (item.category) lines.push(`Genre/Kategorie: ${item.category}`);
  if (item.condition_text) lines.push(`Zustand: ${item.condition_text}`);
  if (item.region) lines.push(`Region: ${item.region}`);
  if (item.details) lines.push(item.details);
  const priceValue = expectedSalePrice(item);
  if (priceValue != null) lines.push(`Preis: ${priceValue.toFixed(2)} € VB`);
  if (item.sale_status === "reserved") lines.push("(Aktuell reserviert)");
  lines.push("Abholung oder Versand (zzgl. Versandkosten) möglich.");
  return lines.join("\n");
}

function setupListingGenerator(item) {
  const box = document.getElementById("listing-box");
  if (!box) return;
  const showFor = item.sale_status === "for_sale" || item.sale_status === "reserved";
  box.classList.toggle("hidden", !showFor);
  if (!showFor) return;

  const btn = document.getElementById("listing-btn");
  const output = document.getElementById("listing-output");
  const textarea = document.getElementById("listing-text");
  const copyBtn = document.getElementById("listing-copy-btn");
  const copyStatus = document.getElementById("listing-copy-status");

  // Alte Listener entfernen (setupListingGenerator kann nach dem Speichern
  // erneut aufgerufen werden), indem die Buttons per Klon ersetzt werden.
  const freshBtn = btn.cloneNode(true);
  btn.replaceWith(freshBtn);
  const freshCopyBtn = copyBtn.cloneNode(true);
  copyBtn.replaceWith(freshCopyBtn);

  freshBtn.addEventListener("click", () => {
    textarea.value = buildListingText(item);
    output.classList.remove("hidden");
    copyStatus.textContent = "";
  });
  freshCopyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(textarea.value);
      copyStatus.textContent = "✅ Kopiert!";
    } catch (_) {
      textarea.select();
      try {
        document.execCommand("copy");
        copyStatus.textContent = "✅ Kopiert!";
      } catch (__) {
        copyStatus.textContent = "⚠️ Kopieren nicht möglich – bitte manuell markieren.";
      }
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
  const header = ["Typ", "Titel", "Konsole", "Region", "Kategorie", "Zustand", "Details", "Kaufpreis", "Geschaetzter Wert", "Wunschpreis", "Mindestpreis", "Verkaufsstatus", "Verkaufspreis", "Lagerort", "Koop/Kampagne", "Favorit", "Notizen", "Erstellt"];
  const rows = items.map((r) => [
    TYPE_LABELS[r.type] || r.type,
    r.title,
    r.console,
    r.region || "",
    r.category,
    r.condition_text,
    r.details,
    r.purchase_price ?? "",
    r.estimated_value ?? "",
    r.asking_price ?? "",
    r.minimum_price ?? "",
    (SALE_STATUS[r.sale_status] && SALE_STATUS[r.sale_status].label) || "",
    r.sold_price ?? "",
    r.storage_location || "",
    r.coop_campaign ? "Ja" : "",
    r.is_favorite ? "Ja" : "",
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

// ---------------------------------------------------------------------
// PDF-Export (z.B. als Nachweis fuer eine Versicherung): Liste aller
// Artikel mit Miniaturbild, Zustand und Wert, gruppiert nach Konsole,
// plus Gesamtwert am Ende.
// ---------------------------------------------------------------------
async function imageUrlToJpegDataUrl(url, maxSize) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    // Als JPEG re-encodieren, damit jsPDF unabhaengig vom Originalformat
    // (PNG/WebP/JPEG) immer ein einheitliches, kompatibles Bild bekommt.
    return canvas.toDataURL("image/jpeg", 0.82);
  } catch (_) {
    // z.B. Netzwerkfehler oder eine Bildquelle ohne CORS-Freigabe - Zeile
    // wird dann einfach ohne Miniaturbild ausgegeben.
    return null;
  }
}

async function exportPdf() {
  flash("Erstelle PDF…");
  try {
    const { data: items, error } = await supabase
      .from("items")
      .select("*")
      .order("console", { ascending: true })
      .order("title", { ascending: true });
    if (error) throw error;

    const { jsPDF } = await import("https://esm.sh/jspdf@2.5.2");
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;
    let y = margin;

    doc.setFontSize(16);
    doc.setFont(undefined, "bold");
    doc.text("Sammlung-Tracker – Inventarliste", margin, y);
    doc.setFont(undefined, "normal");
    y += 18;
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Erstellt am ${new Date().toLocaleDateString("de-DE")} · ${items.length} Artikel`, margin, y);
    doc.setTextColor(0);
    y += 22;

    const firstPhotoPaths = items.map((i) => i.photos?.[0]).filter(Boolean);
    const urlMap = await getSignedUrlMap(firstPhotoPaths);

    const thumbSize = 30;
    const rowHeight = 38;
    let currentConsole = null;

    for (const item of items) {
      const consoleLabel = item.console || "(ohne Konsole)";
      if (consoleLabel !== currentConsole) {
        currentConsole = consoleLabel;
        if (y + 26 > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        y += 6;
        doc.setFontSize(11);
        doc.setFont(undefined, "bold");
        doc.text(consoleLabel, margin, y);
        doc.setFont(undefined, "normal");
        doc.setFontSize(9);
        y += 12;
      }

      if (y + rowHeight > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }

      const photoUrl = item.photos?.[0] ? urlMap[item.photos[0]] : null;
      if (photoUrl) {
        const dataUrl = await imageUrlToJpegDataUrl(photoUrl, 96);
        if (dataUrl) {
          try {
            doc.addImage(dataUrl, "JPEG", margin, y, thumbSize, thumbSize);
          } catch (_) {
            // Bild konnte nicht eingebettet werden - Zeile ohne Bild weiterschreiben.
          }
        }
      }

      const textX = margin + thumbSize + 10;
      doc.setFont(undefined, "bold");
      doc.text(item.title || "(ohne Titel)", textX, y + 12);
      doc.setFont(undefined, "normal");
      const sub = [item.condition_text, item.region].filter(Boolean).join(" · ");
      if (sub) doc.text(sub, textX, y + 24);
      const value = item.estimated_value != null ? Number(item.estimated_value).toFixed(2) + " €" : "–";
      doc.text(value, pageWidth - margin, y + 18, { align: "right" });
      y += rowHeight;
    }

    const total = items.reduce((s, i) => s + (Number(i.estimated_value) || 0), 0);
    if (y + 30 > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    y += 10;
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 20;
    doc.setFontSize(12);
    doc.setFont(undefined, "bold");
    doc.text(`Gesamtwert (geschätzt): ${total.toFixed(2)} €`, margin, y);

    doc.save("sammlung_inventar.pdf");
    flash("PDF erstellt und heruntergeladen.");
  } catch (err) {
    flash("⚠️ PDF-Export fehlgeschlagen: " + (err.message || err));
  }
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Kleiner Ein-/Ausblend-Effekt beim Wechsel zwischen Karten-/Listen-/
// Lagerort-Ansicht bzw. beim Neu-Filtern, statt eines harten Umschaltens.
function fadeOutEl(el) {
  if (el) el.style.opacity = "0";
}
function fadeInEl(el) {
  if (!el) return;
  requestAnimationFrame(() => {
    el.style.opacity = "1";
  });
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

init();
