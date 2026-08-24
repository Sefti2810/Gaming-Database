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
// Router
// ---------------------------------------------------------------------
window.addEventListener("hashchange", router);

function router() {
  const hash = location.hash || "#/";
  if (hash === "#/" || hash === "") {
    renderIndex();
  } else if (hash === "#/add") {
    renderAdd();
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

async function getSignedUrlMap(paths) {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return {};
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(unique, 3600);
  if (error || !data) return {};
  const map = {};
  data.forEach((d) => {
    if (d.signedUrl) map[d.path] = d.signedUrl;
  });
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
  applyFiltersAndRender(items);

  document.getElementById("filter-form").addEventListener("input", () => applyFiltersAndRender(items));
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

async function applyFiltersAndRender(items) {
  const form = document.getElementById("filter-form");
  const fd = new FormData(form);
  const q = (fd.get("q") || "").toString().toLowerCase();
  const type = fd.get("type");
  const cons = fd.get("console");
  const sort = fd.get("sort");

  let filtered = items.filter((i) => {
    if (type && i.type !== type) return false;
    if (cons && i.console !== cons) return false;
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

  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty-state");
  if (filtered.length === 0) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

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
      const { data, error } = await supabase.functions.invoke("analyze-image", {
        body: { action: "recognize", image: dataUrl },
      });
      if (error) throw error;
      if (data.error) {
        analyzeStatus.textContent = "⚠️ " + data.error;
      } else {
        const s = data.suggestion || {};
        if (s.type) document.getElementById("f-type").value = s.type;
        if (s.title) document.getElementById("f-title").value = s.title;
        if (s.console) document.getElementById("f-console").value = s.console;
        if (s.category) document.getElementById("f-category").value = s.category;
        if (s.condition) document.getElementById("f-condition").value = s.condition;
        if (s.details) document.getElementById("f-details").value = s.details;
        analyzeStatus.textContent = `✅ Vorschlag übernommen (Konfidenz: ${s.confidence || "unbekannt"}). Bitte prüfen und ggf. korrigieren.`;
      }
    } catch (err) {
      analyzeStatus.textContent = "⚠️ Fehler bei der Analyse: " + (err.message || err);
    }
    analyzeBtn.disabled = false;
  });

  document.getElementById("item-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("save-status");
    status.textContent = "Speichere…";
    try {
      const photos = selectedFiles.length ? await uploadPhotos(selectedFiles) : [];
      const payload = {
        user_id: currentUser.id,
        type: document.getElementById("f-type").value,
        title: document.getElementById("f-title").value.trim(),
        console: document.getElementById("f-console").value.trim(),
        category: document.getElementById("f-category").value.trim(),
        condition_text: document.getElementById("f-condition").value.trim(),
        details: document.getElementById("f-details").value.trim(),
        purchase_price: parseFloatOrNull(document.getElementById("f-purchase").value),
        estimated_value: parseFloatOrNull(document.getElementById("f-estimated").value),
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
  document.getElementById("e-purchase").value = item.purchase_price ?? "";
  document.getElementById("e-estimated").value = item.estimated_value ?? "";
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
      const { data, error } = await supabase.functions.invoke("analyze-image", {
        body: {
          action: "price",
          item: {
            title: document.getElementById("e-title").value,
            console: document.getElementById("e-console").value,
            type: document.getElementById("e-type").value,
            condition: document.getElementById("e-condition").value,
            details: document.getElementById("e-details").value,
          },
        },
      });
      if (error) throw error;
      if (data.error) {
        status.textContent = "⚠️ " + data.error;
        return;
      }
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
    if (item.photos?.length) {
      await supabase.storage.from(PHOTO_BUCKET).remove(item.photos);
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
      await supabase.storage.from(PHOTO_BUCKET).remove([path]);
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
  const header = ["Typ", "Titel", "Konsole", "Kategorie", "Zustand", "Details", "Kaufpreis", "Geschaetzter Wert", "Notizen", "Erstellt"];
  const rows = items.map((r) => [
    TYPE_LABELS[r.type] || r.type,
    r.title,
    r.console,
    r.category,
    r.condition_text,
    r.details,
    r.purchase_price ?? "",
    r.estimated_value ?? "",
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
