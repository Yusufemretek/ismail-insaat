(() => {
  "use strict";
  const C = window.APP_CONFIG || {};
  const FIRMA = C.FIRMA_ADI || "İnşaat Muhasebe";

  // ================= Yardımcılar =================
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const TL = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const NUM = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
  const NUM_IN = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4 });
  const money = (n) => TL.format(Number(n) || 0);
  const num = (n) => NUM.format(Number(n) || 0);
  const fmtDate = (d) => (d ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("tr-TR") : "—");
  const today = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const store = {
    get: (k, def) => { try { return localStorage.getItem(k) ?? def; } catch { return def; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };

  // "1.250,50" / "1250.5" / "1.250" (=1250) gibi Türkçe yazımları sayıya çevirir
  function parseNum(v) {
    let s = String(v ?? "").trim().replace(/\s|₺|tl/gi, "");
    if (!s) return null;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if ((s.match(/\./g) || []).length > 1 || /^-?[1-9]\d{0,2}\.\d{3}$/.test(s)) s = s.replace(/\./g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // Telefondan çekilen büyük fotoğrafları küçült (depolama alanı tasarrufu)
  async function compressImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1.5e6) return file;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
    } catch {
      return file;
    }
  }

  // ================= Sabit listeler =================
  const JOB_TYPES = ["Sıvacı", "Boyacı", "Alçıpan", "Seramik / Fayans", "Duvarcı", "Kalıpçı", "Demirci", "Mantolama", "Elektrikçi", "Tesisatçı", "Çatı", "Parke", "Doğrama", "Hafriyat"];
  const UNITS = ["m²", "m³", "mt", "adet", "ton", "kg", "götürü"];
  const EXPENSE_CATS = ["Eleman / İşçilik", "Yemek", "Muhasebe", "Malzeme", "Nakliye", "Yakıt", "Kira", "Vergi / Harç", "Diğer"];
  const PAY_METHODS = ["Nakit", "Havale / EFT", "Çek", "Senet", "Kredi kartı"];

  // ================= Durum =================
  let db;
  const S = {
    projects: [], agreements: [], payments: [], expenses: [],
    project: store.get("aktifProje", "all"),
    expFilter: { cat: "", month: "" },
    payFilter: { month: "" },
  };

  async function refresh(...tables) {
    const list = tables.length ? tables : window.DB_TABLES;
    const res = await Promise.all(list.map((t) => db.list(t)));
    list.forEach((t, i) => (S[t] = res[i] || []));
    if (S.project !== "all" && !S.projects.some((p) => p.id === S.project)) S.project = "all";
    renderProjectSelect();
  }

  const byProject = (list) => (S.project === "all" ? list : list.filter((x) => x.project_id === S.project));
  const projName = (id) => S.projects.find((p) => p.id === id)?.name || "—";
  const agrById = (id) => S.agreements.find((a) => a.id === id);
  const agrTotal = (a) => (Number(a.quantity) || 0) * (Number(a.unit_price) || 0);
  const agrPaid = (a) => S.payments.reduce((s, p) => s + (p.agreement_id === a.id ? Number(p.amount) || 0 : 0), 0);
  const sum = (list, f = (x) => x.amount) => list.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const byDateDesc = (a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.created_at || "").localeCompare(String(a.created_at || ""));
  const agrLabel = (a) => (a ? `${a.contractor}${a.job_type ? " – " + a.job_type : ""}` : "Silinmiş anlaşma");
  const showProjectCol = () => S.project === "all" && S.projects.length > 1;

  function defaultProject() {
    return S.project !== "all" ? S.project : S.projects[0]?.id || "";
  }

  function renderProjectSelect() {
    const sel = $("#projectSelect");
    sel.innerHTML =
      `<option value="all">Tüm projeler</option>` +
      S.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    sel.value = S.project;
  }

  // ================= Form / Modal =================
  function fieldHtml(f, v, values) {
    const id = "f_" + f.name;
    const ph = f.placeholder ? `placeholder="${esc(f.placeholder)}"` : "";
    let input;
    switch (f.type) {
      case "select":
        input = `<select id="${id}" name="${f.name}">${f.options
          .map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(v ?? "") ? "selected" : ""}>${esc(o.label)}</option>`)
          .join("")}</select>`;
        break;
      case "textarea":
        input = `<textarea id="${id}" name="${f.name}" ${ph}>${esc(v)}</textarea>`;
        break;
      case "number":
        input = `<input id="${id}" name="${f.name}" type="text" inputmode="decimal" autocomplete="off" ${ph} value="${v != null && v !== "" ? esc(NUM_IN.format(v)) : ""}">`;
        break;
      case "date":
        input = `<input id="${id}" name="${f.name}" type="date" value="${esc(v ? String(v).slice(0, 10) : "")}">`;
        break;
      case "calc":
        return `<div class="fld full"><div class="calc" id="${id}"></div></div>`;
      case "file":
        return `<div class="fld full"><span>${esc(f.label)}</span>
          <input id="${id}" name="${f.name}" type="file" accept="image/*,application/pdf">
          <small>Tarayıcıdan taranmış PDF veya fotoğraf (JPG/PNG). Telefonda kamerayla da çekebilirsiniz.</small>
          ${values.file_path ? `<small>Mevcut belge: <b>${esc(values.file_name || "belge")}</b> — yeni dosya seçerseniz değiştirilir.</small>
          <label class="check"><input type="checkbox" name="remove_file"> Mevcut belgeyi kaldır</label>` : ""}
        </div>`;
      default:
        input = `<input id="${id}" name="${f.name}" type="text" ${ph} ${f.list ? `list="${id}_l"` : ""} value="${esc(v)}" autocomplete="off">` +
          (f.list ? `<datalist id="${id}_l">${f.list.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>` : "");
    }
    return `<label class="fld ${f.full ? "full" : ""}" for="${id}"><span>${esc(f.label)}${f.required ? " *" : ""}</span>${input}${f.hint ? `<small id="${id}_h">${esc(f.hint)}</small>` : ""}</label>`;
  }

  function openForm({ title, intro, locked = false, fields, values = {}, submitLabel = "Kaydet", onSubmit, onChange }) {
    const dlg = $("#modal");
    dlg.innerHTML = `<form class="modal-card" novalidate>
      <header><h2>${esc(title)}</h2>${locked ? "" : `<button type="button" class="icon-btn" data-close aria-label="Kapat">×</button>`}</header>
      ${intro ? `<p class="form-intro">${intro}</p>` : ""}
      <div class="form-grid">${fields.map((f) => fieldHtml(f, values[f.name], values)).join("")}</div>
      <p class="form-error" hidden></p>
      <footer>${locked ? "" : `<button type="button" class="btn ghost" data-close>Vazgeç</button>`}<button class="btn primary" type="submit">${esc(submitLabel)}</button></footer>
    </form>`;
    const form = $("form", dlg);
    const errEl = $(".form-error", form);
    const btn = $("button[type=submit]", form);
    const showErr = (m) => { errEl.textContent = m; errEl.hidden = false; };

    const read = () => {
      const out = {};
      for (const f of fields) {
        if (f.type === "calc" || f.type === "file") continue;
        let v = form.elements[f.name].value.trim();
        if (f.type === "number") v = parseNum(v);
        else if (v === "") v = null;
        out[f.name] = v;
      }
      return out;
    };

    $$("[data-close]", dlg).forEach((b) => (b.onclick = () => dlg.close()));
    dlg.oncancel = locked ? (e) => e.preventDefault() : null; // Esc ile kapatılamasın
    if (onChange) {
      form.addEventListener("input", () => onChange(read(), form));
      form.addEventListener("change", () => onChange(read(), form));
      onChange(read(), form);
    }
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      errEl.hidden = true;
      const vals = read();
      for (const f of fields) {
        if (f.type === "calc" || f.type === "file") continue;
        if (f.required && (vals[f.name] == null || vals[f.name] === "")) return showErr(`"${f.label}" alanı zorunlu.`);
        if (f.type === "number" && vals[f.name] != null && (Number.isNaN(vals[f.name]) || vals[f.name] < 0))
          return showErr(`"${f.label}" geçerli bir sayı olmalı.`);
      }
      const fileEl = $("input[type=file]", form);
      const file = fileEl?.files[0] || null;
      if (file && file.size > 20e6) return showErr("Dosya 20 MB'tan büyük olamaz.");
      btn.disabled = true;
      btn.textContent = "Kaydediliyor…";
      try {
        const ok = await onSubmit(vals, { file, removeFile: !!form.elements.remove_file?.checked });
        if (ok === false) { btn.disabled = false; btn.textContent = submitLabel; return; }
        dlg.close();
      } catch (e) {
        console.error(e);
        showErr(e.message || String(e));
        btn.disabled = false;
        btn.textContent = submitLabel;
      }
    });
    dlg.showModal();
    const first = $("input:not([type=file]):not([type=checkbox]), select, textarea", form);
    if (first && window.matchMedia("(min-width: 700px)").matches) first.focus();
  }

  // Kaydı (varsa belgesiyle birlikte) ekler/günceller
  async function saveRecord(table, old, vals, { file, removeFile }) {
    const row = { ...vals };
    let newPath = null;
    if (file) {
      const f = await compressImage(file);
      newPath = await db.upload(f);
      row.file_path = newPath;
      row.file_name = file.name;
    } else if (removeFile && old?.file_path) {
      row.file_path = null;
      row.file_name = null;
    }
    try {
      const saved = old ? await db.update(table, old.id, row) : await db.insert(table, row);
      if (old?.file_path && (newPath || removeFile)) db.removeFile(old.file_path).catch(() => {});
      return saved;
    } catch (e) {
      if (newPath) db.removeFile(newPath).catch(() => {});
      throw e;
    }
  }

  async function deleteRecords(table, rows) {
    for (const r of rows) {
      if (r.file_path) await db.removeFile(r.file_path).catch(() => {});
      await db.remove(table, r.id);
    }
  }

  function needProject() {
    if (S.projects.length) return false;
    toast("Önce bir proje (şantiye) ekleyin.");
    projectForm();
    return true;
  }

  const projectOptions = () => S.projects.map((p) => ({ value: p.id, label: p.name }));

  // ---------- Formlar ----------
  function projectForm(p, { firstRun = false } = {}) {
    openForm({
      title: p ? "Projeyi düzenle" : firstRun ? "Şantiyenizi oluşturun" : "Yeni proje / şantiye",
      intro: firstRun
        ? "Hoş geldiniz! Devam eden işinizin projesini oluşturun. Taşeron anlaşmaları, ödemeler ve giderler bu projeye bağlanacak. İleride yeni şantiyeler de ekleyebilirsiniz."
        : "",
      locked: firstRun,
      submitLabel: firstRun ? "Projeyi oluştur ve başla" : "Kaydet",
      values: p || {},
      fields: [
        { name: "name", label: "Proje adı", required: true, full: true, placeholder: "örn. Yıldız Apartmanı" },
        { name: "address", label: "Adres / Konum", full: true },
        { name: "notes", label: "Notlar", type: "textarea", full: true },
      ],
      onSubmit: async (v) => {
        const saved = p ? await db.update("projects", p.id, v) : await db.insert("projects", v);
        await refresh("projects");
        if (!p) { S.project = saved.id; store.set("aktifProje", saved.id); renderProjectSelect(); }
        if (firstRun) location.hash = "#/ozet";
        render();
        toast(p ? "Proje güncellendi" : firstRun ? `"${saved.name}" oluşturuldu. Şimdi ilk anlaşmayı ekleyebilirsiniz.` : "Proje eklendi");
      },
    });
  }

  function agreementForm(a) {
    if (!a && needProject()) return;
    openForm({
      title: a ? "Anlaşmayı düzenle" : "Yeni taşeron anlaşması",
      values: a || { project_id: defaultProject(), unit: "m²", date: today(), job_type: "Sıvacı" },
      fields: [
        { name: "project_id", label: "Proje", type: "select", options: projectOptions(), required: true, full: true },
        { name: "contractor", label: "Taşeron / Usta adı", required: true, placeholder: "örn. Ahmet Yılmaz" },
        { name: "job_type", label: "Yapılan iş", list: JOB_TYPES },
        { name: "phone", label: "Telefon" },
        { name: "date", label: "Anlaşma tarihi", type: "date" },
        { name: "quantity", label: "Toplam miktar", type: "number", required: true, placeholder: "örn. 1.250" },
        { name: "unit", label: "Birim", type: "select", options: UNITS.map((u) => ({ value: u, label: u })) },
        { name: "unit_price", label: "Birim fiyat (₺)", type: "number", required: true, full: true, placeholder: "örn. 120" },
        { name: "_total", type: "calc" },
        { name: "notes", label: "Notlar", type: "textarea", full: true },
        { name: "file", label: "Sözleşme / fatura (isteğe bağlı)", type: "file" },
      ],
      onChange: (v, form) => {
        const q = Number.isFinite(v.quantity) ? v.quantity : 0;
        const pr = Number.isFinite(v.unit_price) ? v.unit_price : 0;
        $("#f__total", form).innerHTML = `<span class="muted small">${num(q)} ${esc(v.unit || "")} × ${money(pr)}</span><span class="big">= ${money(q * pr)}</span>`;
      },
      onSubmit: async (v, f) => {
        await saveRecord("agreements", a, v, f);
        await refresh("agreements");
        render();
        toast(a ? "Anlaşma güncellendi" : "Anlaşma eklendi");
      },
    });
  }

  function paymentForm(p, presetAgreement) {
    if (!p && needProject()) return;
    const list = (S.project === "all" ? S.agreements : S.agreements.filter((a) => a.project_id === S.project))
      .slice().sort((x, y) => x.contractor.localeCompare(y.contractor, "tr"));
    if (p && !list.some((a) => a.id === p.agreement_id) && agrById(p.agreement_id)) list.unshift(agrById(p.agreement_id));
    if (!list.length) { toast("Önce bir taşeron anlaşması ekleyin."); agreementForm(); return; }
    const remainingOf = (a) => agrTotal(a) - agrPaid(a) + (p && p.agreement_id === a.id ? Number(p.amount) || 0 : 0);
    openForm({
      title: p ? "Ödemeyi düzenle" : "Ödeme ekle",
      values: p || { agreement_id: presetAgreement || list[0].id, date: today(), method: "Nakit" },
      fields: [
        {
          name: "agreement_id", label: "Kime (anlaşma)", type: "select", full: true, required: true,
          options: list.map((a) => ({ value: a.id, label: `${agrLabel(a)}${showProjectCol() ? " · " + projName(a.project_id) : ""}` })),
        },
        { name: "_rem", type: "calc" },
        { name: "amount", label: "Ödenen tutar (₺)", type: "number", required: true },
        { name: "date", label: "Ödeme tarihi", type: "date", required: true },
        { name: "method", label: "Ödeme şekli", list: PAY_METHODS },
        { name: "notes", label: "Açıklama", placeholder: "örn. 2. hakediş" },
        { name: "file", label: "Dekont / makbuz (isteğe bağlı)", type: "file" },
      ],
      onChange: (v, form) => {
        const a = agrById(v.agreement_id);
        if (!a) return;
        const rem = remainingOf(a);
        const amt = Number.isFinite(v.amount) ? v.amount : 0;
        $("#f__rem", form).innerHTML = `<span class="muted small">Anlaşma ${money(agrTotal(a))} · Kalan borç ${money(rem)}</span>
          <span class="big">Bu ödemeden sonra kalan: ${money(rem - amt)}</span>`;
      },
      onSubmit: async (v, f) => {
        const a = agrById(v.agreement_id);
        if (v.amount > remainingOf(a) + 0.005 &&
            !confirm(`Bu ödeme kalan borcu (${money(remainingOf(a))}) aşıyor. Yine de kaydedilsin mi?`)) return false;
        v.project_id = a.project_id;
        await saveRecord("payments", p, v, f);
        await refresh("payments");
        render();
        toast(p ? "Ödeme güncellendi" : "Ödeme kaydedildi");
      },
    });
  }

  function expenseForm(e) {
    if (!e && needProject()) return;
    const cats = [...new Set([...EXPENSE_CATS, ...S.expenses.map((x) => x.category).filter(Boolean)])];
    openForm({
      title: e ? "Gideri düzenle" : "Gider ekle",
      values: e || { project_id: defaultProject(), date: today() },
      fields: [
        { name: "project_id", label: "Proje", type: "select", options: projectOptions(), required: true, full: true },
        { name: "category", label: "Gider türü", list: cats, required: true, placeholder: "Yemek, Muhasebe, Eleman…" },
        { name: "amount", label: "Tutar (₺)", type: "number", required: true },
        { name: "date", label: "Tarih", type: "date", required: true },
        { name: "paid_to", label: "Kime / nereye ödendi" },
        { name: "description", label: "Açıklama", type: "textarea", full: true },
        { name: "file", label: "Fatura / fiş (isteğe bağlı)", type: "file" },
      ],
      onSubmit: async (v, f) => {
        await saveRecord("expenses", e, v, f);
        await refresh("expenses");
        render();
        toast(e ? "Gider güncellendi" : "Gider kaydedildi");
      },
    });
  }

  // ================= Sayfalar =================
  const emptyBox = (msg, btn = "") => `<div class="empty"><div>${msg}</div>${btn}</div>`;
  const fileBtn = (r) => (r.file_path ? `<button class="link-btn" data-act="file" data-path="${esc(r.file_path)}" title="${esc(r.file_name || "")}">Belge</button>` : "");
  const projCell = (id) => (showProjectCol() ? `<td>${esc(projName(id))}</td>` : "");
  const projTh = () => (showProjectCol() ? `<th>Proje</th>` : "");

  function pageOzet() {
    if (!S.projects.length)
      return `<div class="card">${emptyBox(
        `<h2>Hoş geldiniz 👋</h2><p>Başlamak için ilk projenizi (şantiyenizi) ekleyin.<br>Sonra taşeron anlaşmalarını, ödemeleri ve giderleri girebilirsiniz.</p>`,
        `<button class="btn primary" data-act="new-project">+ İlk projeyi ekle</button>`
      )}</div>`;

    const A = byProject(S.agreements), P = byProject(S.payments), E = byProject(S.expenses);
    const tA = sum(A, agrTotal), tP = sum(P), tE = sum(E);
    const remaining = tA - tP;

    const cats = {};
    E.forEach((e) => (cats[e.category || "Diğer"] = (cats[e.category || "Diğer"] || 0) + (Number(e.amount) || 0)));
    const catList = Object.entries(cats).sort((a, b) => b[1] - a[1]);
    const maxCat = catList[0]?.[1] || 1;

    const open = A.map((a) => ({ a, t: agrTotal(a), p: agrPaid(a) }))
      .filter((x) => x.t - x.p > 0.005).sort((x, y) => y.t - y.p - (x.t - x.p)).slice(0, 8);

    const recent = [
      ...P.map((p) => ({ ...p, kind: "Ödeme", desc: agrLabel(agrById(p.agreement_id)) })),
      ...E.map((e) => ({ ...e, kind: e.category || "Gider", desc: e.paid_to || e.description || "" })),
    ].sort(byDateDesc).slice(0, 10);

    return `
      <div class="page-head">
        <div><h1>Özet</h1><div class="muted small">${S.project === "all" ? "Tüm projeler" : esc(projName(S.project))}</div></div>
        <div class="actions">
          <button class="btn" data-act="new-agreement">+ Anlaşma</button>
          <button class="btn" data-act="new-expense">+ Gider</button>
          <button class="btn primary" data-act="new-payment">+ Ödeme</button>
        </div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="label">Taşeron anlaşmaları</div><div class="value">${money(tA)}</div><div class="hint">${A.length} anlaşma</div></div>
        <div class="kpi"><div class="label">Taşerona ödenen</div><div class="value good">${money(tP)}</div><div class="hint">${P.length} ödeme</div></div>
        <div class="kpi accent"><div class="label">Taşerona kalan borç</div><div class="value bad">${money(remaining)}</div><div class="hint">anlaşma − ödenen</div></div>
        <div class="kpi"><div class="label">Diğer giderler</div><div class="value">${money(tE)}</div><div class="hint">eleman, yemek, muhasebe…</div></div>
        <div class="kpi"><div class="label">Toplam harcama</div><div class="value">${money(tP + tE)}</div><div class="hint">ödemeler + giderler</div></div>
      </div>
      <div class="grid-2">
        <div class="card">
          <div class="card-head"><h2>Kalan borçlar</h2><a class="btn sm ghost" href="#/anlasmalar">Tümü →</a></div>
          ${open.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Taşeron</th><th class="r">Toplam</th><th class="r">Kalan</th></tr></thead>
            <tbody>${open.map(({ a, t, p }) => `<tr>
              <td><a href="#/anlasma/${esc(a.id)}">${esc(a.contractor)}</a><div class="muted small">${esc(a.job_type || "")}</div></td>
              <td class="r num">${money(t)}</td><td class="r num bad">${money(t - p)}</td></tr>`).join("")}</tbody>
          </table></div>` : emptyBox("Bekleyen borç yok.")}
        </div>
        <div class="card">
          <div class="card-head"><h2>Gider dağılımı</h2><a class="btn sm ghost" href="#/giderler">Tümü →</a></div>
          ${catList.length ? `<div class="bars">${catList.map(([c, v]) => `
            <div class="bar-row"><div class="top"><span>${esc(c)}</span><b class="num">${money(v)}</b></div>
            <div class="bar"><span style="width:${Math.max(2, (v / maxCat) * 100).toFixed(1)}%"></span></div></div>`).join("")}</div>`
            : emptyBox("Henüz gider girilmedi.")}
        </div>
      </div>
      <div class="card">
        <h2>Son hareketler</h2>
        ${recent.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Tarih</th><th>Tür</th><th>Açıklama</th>${projTh()}<th class="r">Tutar</th></tr></thead>
          <tbody>${recent.map((r) => `<tr><td class="num">${fmtDate(r.date)}</td><td><span class="badge ${r.kind === "Ödeme" ? "good" : "gray"}">${esc(r.kind)}</span></td>
            <td>${esc(r.desc)}</td>${projCell(r.project_id)}<td class="r num">${money(r.amount)}</td></tr>`).join("")}</tbody>
        </table></div>` : emptyBox("Henüz hareket yok.")}
      </div>`;
  }

  function pageAnlasmalar() {
    const A = byProject(S.agreements).slice().sort(byDateDesc);
    const tA = sum(A, agrTotal), tP = sum(A, agrPaid);
    return `
      <div class="page-head">
        <h1>Taşeron Anlaşmaları</h1>
        <div class="actions"><button class="btn primary" data-act="new-agreement">+ Yeni anlaşma</button></div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="label">Anlaşma toplamı</div><div class="value">${money(tA)}</div></div>
        <div class="kpi"><div class="label">Ödenen</div><div class="value good">${money(tP)}</div></div>
        <div class="kpi accent"><div class="label">Kalan borç</div><div class="value bad">${money(tA - tP)}</div></div>
      </div>
      ${A.length ? `<div class="filters"><input type="search" id="agrSearch" placeholder="Usta adı veya iş ara…"></div>
      <div class="rows">${A.map((a) => {
        const t = agrTotal(a), p = agrPaid(a), pct = t > 0 ? Math.min(100, (p / t) * 100) : 0;
        const done = t > 0 && t - p <= 0.005;
        return `<a class="row-card" href="#/anlasma/${esc(a.id)}" data-search="${esc((a.contractor + " " + (a.job_type || "") + " " + projName(a.project_id)).toLocaleLowerCase("tr"))}">
          <div class="rc-main">
            <div class="rc-title">${esc(a.contractor)} ${a.job_type ? `<span class="badge">${esc(a.job_type)}</span>` : ""} ${done ? `<span class="badge good">Ödendi</span>` : ""}</div>
            <div class="rc-sub">${showProjectCol() ? esc(projName(a.project_id)) + " · " : ""}${num(a.quantity)} ${esc(a.unit || "")} × ${money(a.unit_price)}</div>
            <div class="progress" title="%${pct.toFixed(0)} ödendi"><span style="width:${pct.toFixed(1)}%"></span></div>
          </div>
          <div class="rc-amounts">
            <div><div class="k">Toplam</div><b>${money(t)}</b></div>
            <div><div class="k">Ödenen</div><b class="good">${money(p)}</b></div>
            <div><div class="k">Kalan</div><b class="${done ? "" : "bad"}">${money(t - p)}</b></div>
          </div></a>`;
      }).join("")}</div>`
        : `<div class="card">${emptyBox("Henüz anlaşma yok. Örneğin sıvacıyla yaptığınız m² anlaşmasını buraya girin.", `<button class="btn primary" data-act="new-agreement">+ Yeni anlaşma</button>`)}</div>`}`;
  }

  function pageAnlasma(id) {
    const a = agrById(id);
    if (!a) return `<a class="back" href="#/anlasmalar">← Anlaşmalar</a><div class="card">${emptyBox("Anlaşma bulunamadı.")}</div>`;
    const P = S.payments.filter((p) => p.agreement_id === a.id).sort(byDateDesc);
    const t = agrTotal(a), paid = sum(P);
    return `
      <a class="back" href="#/anlasmalar">← Anlaşmalar</a>
      <div class="print-only"><h2>${esc(FIRMA)}</h2><p>Hesap dökümü · ${fmtDate(today())}</p></div>
      <div class="page-head">
        <div><h1>${esc(a.contractor)}</h1><div class="muted">${esc(a.job_type || "")} · ${esc(projName(a.project_id))}</div></div>
        <div class="actions no-print">
          <button class="btn" data-act="print">Yazdır</button>
          <button class="btn" data-act="edit-agreement" data-id="${esc(a.id)}">Düzenle</button>
          <button class="btn danger" data-act="del-agreement" data-id="${esc(a.id)}">Sil</button>
          <button class="btn primary" data-act="new-payment" data-agr="${esc(a.id)}">+ Ödeme ekle</button>
        </div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="label">Anlaşma tutarı</div><div class="value">${money(t)}</div><div class="hint">${num(a.quantity)} ${esc(a.unit || "")} × ${money(a.unit_price)}</div></div>
        <div class="kpi"><div class="label">Ödenen</div><div class="value good">${money(paid)}</div><div class="hint">${P.length} ödeme</div></div>
        <div class="kpi accent"><div class="label">Kalan borç</div><div class="value bad">${money(t - paid)}</div></div>
      </div>
      <div class="card">
        <div class="info-grid">
          <div><div class="k">Anlaşma tarihi</div><div class="v">${fmtDate(a.date)}</div></div>
          <div><div class="k">Telefon</div><div class="v">${a.phone ? `<a href="tel:${esc(a.phone)}">${esc(a.phone)}</a>` : "—"}</div></div>
          <div><div class="k">Miktar</div><div class="v">${num(a.quantity)} ${esc(a.unit || "")}</div></div>
          <div><div class="k">Birim fiyat</div><div class="v">${money(a.unit_price)}</div></div>
          <div><div class="k">Belge</div><div class="v">${fileBtn(a) || "—"}</div></div>
        </div>
        ${a.notes ? `<p class="small" style="white-space:pre-wrap;margin-bottom:0">${esc(a.notes)}</p>` : ""}
      </div>
      <div class="card">
        <h2>Ödemeler</h2>
        ${P.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Tarih</th><th>Şekil</th><th>Açıklama</th><th class="r">Tutar</th><th></th></tr></thead>
          <tbody>${P.map((p) => `<tr>
            <td class="num">${fmtDate(p.date)}</td><td>${esc(p.method || "")}</td><td>${esc(p.notes || "")} ${fileBtn(p)}</td>
            <td class="r num">${money(p.amount)}</td>
            <td><div class="row-actions"><button class="btn sm ghost" data-act="edit-payment" data-id="${esc(p.id)}">Düzenle</button><button class="btn sm ghost danger" data-act="del-payment" data-id="${esc(p.id)}">Sil</button></div></td></tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="3">Toplam ödenen</td><td class="r num">${money(paid)}</td><td></td></tr></tfoot>
        </table></div>` : emptyBox("Bu anlaşmaya henüz ödeme yapılmadı.")}
      </div>`;
  }

  function pageOdemeler() {
    let P = byProject(S.payments).slice().sort(byDateDesc);
    const months = [...new Set(P.map((p) => String(p.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
    if (S.payFilter.month) P = P.filter((p) => String(p.date || "").startsWith(S.payFilter.month));
    return `
      <div class="page-head">
        <h1>Ödemeler</h1>
        <div class="actions"><button class="btn" data-act="csv-payments">Excel'e aktar</button><button class="btn primary" data-act="new-payment">+ Ödeme ekle</button></div>
      </div>
      <div class="filters">
        <select data-filter="pay-month"><option value="">Tüm aylar</option>${months.map((m) => `<option value="${m}" ${m === S.payFilter.month ? "selected" : ""}>${monthName(m)}</option>`).join("")}</select>
      </div>
      <div class="card">
        ${P.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Tarih</th><th>Taşeron</th>${projTh()}<th>Şekil</th><th>Açıklama</th><th class="r">Tutar</th><th></th></tr></thead>
          <tbody>${P.map((p) => {
            const a = agrById(p.agreement_id);
            return `<tr><td class="num">${fmtDate(p.date)}</td>
            <td>${a ? `<a href="#/anlasma/${esc(a.id)}">${esc(a.contractor)}</a><div class="muted small">${esc(a.job_type || "")}</div>` : "—"}</td>
            ${projCell(p.project_id)}<td>${esc(p.method || "")}</td><td>${esc(p.notes || "")} ${fileBtn(p)}</td>
            <td class="r num">${money(p.amount)}</td>
            <td><div class="row-actions"><button class="btn sm ghost" data-act="edit-payment" data-id="${esc(p.id)}">Düzenle</button><button class="btn sm ghost danger" data-act="del-payment" data-id="${esc(p.id)}">Sil</button></div></td></tr>`;
          }).join("")}</tbody>
          <tfoot><tr><td colspan="${showProjectCol() ? 5 : 4}">Toplam</td><td class="r num">${money(sum(P))}</td><td></td></tr></tfoot>
        </table></div>` : emptyBox("Kayıtlı ödeme yok.")}
      </div>`;
  }

  function monthName(m) {
    const [y, mo] = m.split("-").map(Number);
    return new Date(y, mo - 1, 1).toLocaleDateString("tr-TR", { month: "long", year: "numeric" });
  }

  function pageGiderler() {
    const all = byProject(S.expenses);
    const cats = [...new Set(all.map((e) => e.category || "Diğer"))].sort((a, b) => a.localeCompare(b, "tr"));
    const months = [...new Set(all.map((e) => String(e.date || "").slice(0, 7)).filter(Boolean))].sort().reverse();
    let E = all.slice().sort(byDateDesc);
    if (S.expFilter.cat) E = E.filter((e) => (e.category || "Diğer") === S.expFilter.cat);
    if (S.expFilter.month) E = E.filter((e) => String(e.date || "").startsWith(S.expFilter.month));
    const totals = {};
    E.forEach((e) => (totals[e.category || "Diğer"] = (totals[e.category || "Diğer"] || 0) + (Number(e.amount) || 0)));
    return `
      <div class="page-head">
        <h1>Giderler</h1>
        <div class="actions"><button class="btn" data-act="csv-expenses">Excel'e aktar</button><button class="btn primary" data-act="new-expense">+ Gider ekle</button></div>
      </div>
      <div class="filters">
        <select data-filter="exp-cat"><option value="">Tüm gider türleri</option>${cats.map((c) => `<option ${c === S.expFilter.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <select data-filter="exp-month"><option value="">Tüm aylar</option>${months.map((m) => `<option value="${m}" ${m === S.expFilter.month ? "selected" : ""}>${monthName(m)}</option>`).join("")}</select>
      </div>
      <div class="kpis">
        <div class="kpi accent"><div class="label">Toplam</div><div class="value">${money(sum(E))}</div><div class="hint">${E.length} kayıt</div></div>
        ${Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c, v]) => `<div class="kpi"><div class="label">${esc(c)}</div><div class="value">${money(v)}</div></div>`).join("")}
      </div>
      <div class="card">
        ${E.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Tarih</th><th>Tür</th>${projTh()}<th>Kime / Açıklama</th><th class="r">Tutar</th><th></th></tr></thead>
          <tbody>${E.map((e) => `<tr><td class="num">${fmtDate(e.date)}</td><td><span class="badge gray">${esc(e.category || "Diğer")}</span></td>
            ${projCell(e.project_id)}<td>${e.paid_to ? `<b>${esc(e.paid_to)}</b><br>` : ""}<span class="muted small">${esc(e.description || "")}</span> ${fileBtn(e)}</td>
            <td class="r num">${money(e.amount)}</td>
            <td><div class="row-actions"><button class="btn sm ghost" data-act="edit-expense" data-id="${esc(e.id)}">Düzenle</button><button class="btn sm ghost danger" data-act="del-expense" data-id="${esc(e.id)}">Sil</button></div></td></tr>`).join("")}</tbody>
          <tfoot><tr><td colspan="${showProjectCol() ? 4 : 3}">Toplam</td><td class="r num">${money(sum(E))}</td><td></td></tr></tfoot>
        </table></div>` : emptyBox("Kayıtlı gider yok.", `<button class="btn primary" data-act="new-expense">+ Gider ekle</button>`)}
      </div>`;
  }

  function pageBelgeler() {
    const docs = [
      ...byProject(S.agreements).filter((a) => a.file_path).map((a) => ({ r: a, kind: "Anlaşma", title: agrLabel(a), amount: agrTotal(a) })),
      ...byProject(S.payments).filter((p) => p.file_path).map((p) => ({ r: p, kind: "Ödeme dekontu", title: agrLabel(agrById(p.agreement_id)), amount: p.amount })),
      ...byProject(S.expenses).filter((e) => e.file_path).map((e) => ({ r: e, kind: e.category || "Gider", title: e.paid_to || e.description || e.category, amount: e.amount })),
    ].sort((x, y) => byDateDesc(x.r, y.r));
    return `
      <div class="page-head"><div><h1>Faturalar &amp; Belgeler</h1><div class="muted small">Belge yüklemek için ilgili anlaşma, ödeme veya gider kaydını ekleyin/düzenleyin.</div></div>
        <div class="actions"><button class="btn primary" data-act="new-expense">+ Faturalı gider ekle</button></div></div>
      ${docs.length ? `<div class="doc-grid">${docs.map((d) => `<div class="doc">
        <span class="badge gray" style="align-self:flex-start">${esc(d.kind)}</span>
        <div class="t">${esc(d.title)}</div>
        <div class="muted small">${fmtDate(d.r.date)}${showProjectCol() ? " · " + esc(projName(d.r.project_id)) : ""} · <span class="num">${money(d.amount)}</span></div>
        <div class="muted small" style="overflow-wrap:anywhere">${esc(d.r.file_name || "")}</div>
        <button class="btn sm" style="align-self:flex-start;margin-top:4px" data-act="file" data-path="${esc(d.r.file_path)}">Belgeyi aç</button>
      </div>`).join("")}</div>` : `<div class="card">${emptyBox("Henüz yüklenmiş belge yok.")}</div>`}`;
  }

  function pageProjeler() {
    return `
      <div class="page-head"><h1>Projeler / Şantiyeler</h1><div class="actions"><button class="btn primary" data-act="new-project">+ Yeni proje</button></div></div>
      ${S.projects.length ? `<div class="rows">${S.projects.map((p) => {
        const A = S.agreements.filter((a) => a.project_id === p.id);
        const tA = sum(A, agrTotal), tP = sum(S.payments.filter((x) => x.project_id === p.id)), tE = sum(S.expenses.filter((x) => x.project_id === p.id));
        return `<div class="row-card">
          <div class="rc-main"><div class="rc-title">${esc(p.name)}</div><div class="rc-sub">${esc(p.address || "")}</div>
            <div class="actions" style="display:flex;gap:6px;margin-top:8px">
              <button class="btn sm" data-act="select-project" data-id="${esc(p.id)}">Bu projeye geç</button>
              <button class="btn sm ghost" data-act="edit-project" data-id="${esc(p.id)}">Düzenle</button>
              <button class="btn sm ghost danger" data-act="del-project" data-id="${esc(p.id)}">Sil</button></div></div>
          <div class="rc-amounts">
            <div><div class="k">Anlaşmalar</div><b>${money(tA)}</b></div>
            <div><div class="k">Kalan borç</div><b class="bad">${money(tA - tP)}</b></div>
            <div><div class="k">Toplam harcama</div><b>${money(tP + tE)}</b></div>
          </div></div>`;
      }).join("")}</div>` : `<div class="card">${emptyBox("Henüz proje yok.", `<button class="btn primary" data-act="new-project">+ Yeni proje</button>`)}</div>`}`;
  }

  function pageAyarlar() {
    const cloud = db.mode === "cloud";
    return `
      <div class="page-head"><h1>Ayarlar</h1></div>
      <div class="card">
        <h2>Depolama</h2>
        ${cloud
          ? `<p>Veriler <b>bulutta (Supabase)</b> saklanıyor. Tüm cihazlardan aynı verilere erişebilirsiniz.</p>`
          : `<p><b>Yerel mod.</b> Veriler yalnızca bu tarayıcıda saklanıyor; tarayıcı verileri silinirse kaybolur. Düzenli olarak yedek alın veya README'deki adımlarla Supabase'e geçin.</p>`}
      </div>
      <div class="card">
        <h2>Yedek &amp; dışa aktarma</h2>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <button class="btn" data-act="backup">Yedek indir (JSON)</button>
          ${cloud ? "" : `<button class="btn" data-act="restore">Yedekten geri yükle</button>`}
          <button class="btn" data-act="csv-agreements">Anlaşmalar (Excel)</button>
          <button class="btn" data-act="csv-payments">Ödemeler (Excel)</button>
          <button class="btn" data-act="csv-expenses">Giderler (Excel)</button>
        </div>
        ${cloud ? "" : `<p class="muted small">Yerel yedek, yüklenen belgeleri de içerir.</p>`}
      </div>
      ${cloud ? `<div class="card"><h2>Hesap</h2><p class="muted" id="whoami"></p><button class="btn danger" data-act="logout">Çıkış yap</button></div>` : ""}`;
  }

  const PAGES = {
    ozet: pageOzet, anlasmalar: pageAnlasmalar, anlasma: pageAnlasma, odemeler: pageOdemeler,
    giderler: pageGiderler, belgeler: pageBelgeler, projeler: pageProjeler, ayarlar: pageAyarlar,
  };

  function currentRoute() {
    const [page, id] = location.hash.replace(/^#\/?/, "").split("/");
    return { page: PAGES[page] ? page : "ozet", id };
  }

  function render() {
    const { page, id } = currentRoute();
    const navPage = page === "anlasma" ? "anlasmalar" : page;
    $$("#tabs a").forEach((a) => a.classList.toggle("active", a.dataset.page === navPage));
    $("#view").innerHTML = PAGES[page](id);
    if (page === "ayarlar" && db.mode === "cloud")
      db.session().then((s) => { const w = $("#whoami"); if (w && s) w.textContent = "Giriş yapan: " + s.user.email; });
  }

  // ================= CSV =================
  function downloadCSV(name, headers, rows) {
    const cell = (v) => {
      const s = typeof v === "number" ? String(v).replace(".", ",") : String(v ?? "");
      return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = "﻿" + [headers, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
    download(new Blob([csv], { type: "text/csv;charset=utf-8" }), name);
  }
  const csvDate = () => today();

  // ================= Aksiyonlar =================
  const ACTIONS = {
    "new-project": () => projectForm(),
    "edit-project": (d) => projectForm(S.projects.find((p) => p.id === d.id)),
    "select-project": (d) => { S.project = d.id; store.set("aktifProje", d.id); renderProjectSelect(); location.hash = "#/ozet"; render(); },
    "del-project": async (d) => {
      const p = S.projects.find((x) => x.id === d.id);
      const A = S.agreements.filter((a) => a.project_id === p.id);
      const P = S.payments.filter((x) => x.project_id === p.id);
      const E = S.expenses.filter((x) => x.project_id === p.id);
      if (!confirm(`"${p.name}" projesi ve içindeki ${A.length} anlaşma, ${P.length} ödeme, ${E.length} gider kalıcı olarak silinecek. Emin misiniz?`)) return;
      if ((A.length || P.length || E.length) && prompt(`Onaylamak için proje adını yazın: ${p.name}`) !== p.name) return toast("Silme iptal edildi");
      await deleteRecords("payments", P);
      await deleteRecords("expenses", E);
      await deleteRecords("agreements", A);
      await db.remove("projects", p.id);
      await refresh();
      render();
      toast("Proje silindi");
    },
    "new-agreement": () => agreementForm(),
    "edit-agreement": (d) => agreementForm(agrById(d.id)),
    "del-agreement": async (d) => {
      const a = agrById(d.id);
      const P = S.payments.filter((p) => p.agreement_id === a.id);
      if (!confirm(`${a.contractor} anlaşması${P.length ? ` ve ${P.length} ödeme kaydı` : ""} silinecek. Emin misiniz?`)) return;
      await deleteRecords("payments", P);
      await deleteRecords("agreements", [a]);
      await refresh("agreements", "payments");
      location.hash = "#/anlasmalar";
      toast("Anlaşma silindi");
    },
    "new-payment": (d) => paymentForm(null, d.agr),
    "edit-payment": (d) => paymentForm(S.payments.find((p) => p.id === d.id)),
    "del-payment": async (d) => {
      const p = S.payments.find((x) => x.id === d.id);
      if (!confirm(`${fmtDate(p.date)} tarihli ${money(p.amount)} ödeme silinsin mi?`)) return;
      await deleteRecords("payments", [p]);
      await refresh("payments");
      render();
      toast("Ödeme silindi");
    },
    "new-expense": () => expenseForm(),
    "edit-expense": (d) => expenseForm(S.expenses.find((e) => e.id === d.id)),
    "del-expense": async (d) => {
      const e = S.expenses.find((x) => x.id === d.id);
      if (!confirm(`${fmtDate(e.date)} tarihli ${money(e.amount)} tutarındaki "${e.category}" gideri silinsin mi?`)) return;
      await deleteRecords("expenses", [e]);
      await refresh("expenses");
      render();
      toast("Gider silindi");
    },
    file: async (d) => {
      const w = window.open("", "_blank");
      try {
        const url = await db.fileUrl(d.path);
        if (w) w.location.href = url;
        else location.href = url;
      } catch (e) {
        if (w) w.close();
        toast(e.message);
      }
    },
    print: () => window.print(),
    backup: async () => {
      const data = await db.exportAll();
      download(new Blob([JSON.stringify(data)], { type: "application/json" }), `insaat-yedek-${csvDate()}.json`);
    },
    restore: () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json,.json";
      inp.onchange = async () => {
        const f = inp.files[0];
        if (!f) return;
        if (!confirm("Mevcut tüm veriler silinip yedekteki verilerle değiştirilecek. Devam edilsin mi?")) return;
        try {
          await db.importAll(JSON.parse(await f.text()));
          await refresh();
          render();
          toast("Yedek geri yüklendi");
        } catch (e) { toast("Yedek yüklenemedi: " + e.message); }
      };
      inp.click();
    },
    "csv-agreements": () => downloadCSV(`anlasmalar-${csvDate()}.csv`,
      ["Proje", "Taşeron", "İş", "Telefon", "Tarih", "Miktar", "Birim", "Birim fiyat", "Toplam", "Ödenen", "Kalan", "Notlar"],
      byProject(S.agreements).map((a) => [projName(a.project_id), a.contractor, a.job_type, a.phone, a.date, Number(a.quantity), a.unit, Number(a.unit_price), agrTotal(a), agrPaid(a), agrTotal(a) - agrPaid(a), a.notes])),
    "csv-payments": () => downloadCSV(`odemeler-${csvDate()}.csv`,
      ["Tarih", "Proje", "Taşeron", "İş", "Ödeme şekli", "Açıklama", "Tutar", "Belge"],
      byProject(S.payments).slice().sort(byDateDesc).map((p) => { const a = agrById(p.agreement_id); return [p.date, projName(p.project_id), a?.contractor, a?.job_type, p.method, p.notes, Number(p.amount), p.file_name]; })),
    "csv-expenses": () => downloadCSV(`giderler-${csvDate()}.csv`,
      ["Tarih", "Proje", "Gider türü", "Kime", "Açıklama", "Tutar", "Belge"],
      byProject(S.expenses).slice().sort(byDateDesc).map((e) => [e.date, projName(e.project_id), e.category, e.paid_to, e.description, Number(e.amount), e.file_name])),
    logout: async () => { await db.signOut(); location.reload(); },
  };

  document.addEventListener("click", async (ev) => {
    const el = ev.target.closest("[data-act]");
    if (!el) return;
    ev.preventDefault();
    try {
      await ACTIONS[el.dataset.act]?.(el.dataset);
    } catch (e) {
      console.error(e);
      toast("Hata: " + (e.message || e));
    }
  });

  document.addEventListener("change", (ev) => {
    const f = ev.target.dataset?.filter;
    if (!f) return;
    if (f === "exp-cat") S.expFilter.cat = ev.target.value;
    if (f === "exp-month") S.expFilter.month = ev.target.value;
    if (f === "pay-month") S.payFilter.month = ev.target.value;
    render();
  });

  document.addEventListener("input", (ev) => {
    if (ev.target.id !== "agrSearch") return;
    const q = ev.target.value.trim().toLocaleLowerCase("tr");
    $$(".row-card[data-search]").forEach((r) => (r.hidden = q && !r.dataset.search.includes(q)));
  });

  // ================= Başlatma =================
  async function enterApp() {
    $("#login").hidden = true;
    $("#boot").hidden = false;
    await refresh();
    $("#localBanner").hidden = db.mode !== "local";
    $("#projectSelect").addEventListener("change", (e) => {
      S.project = e.target.value;
      store.set("aktifProje", S.project);
      if (currentRoute().page === "anlasma") location.hash = "#/anlasmalar";
      render();
    });
    window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
    $("#boot").hidden = true;
    $("#shell").hidden = false;
    render();
    if (!S.projects.length) projectForm(null, { firstRun: true });
  }

  function showLogin() {
    $("#boot").hidden = true;
    $("#login").hidden = false;
    const form = $("#loginForm");
    const err = $(".form-error", form);
    form.onsubmit = async (e) => {
      e.preventDefault();
      err.hidden = true;
      const btn = $("button", form);
      btn.disabled = true;
      try {
        await db.signIn(form.email.value.trim(), form.password.value);
        await enterApp();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      } finally {
        btn.disabled = false;
      }
    };
  }

  async function start() {
    document.title = FIRMA + " · Muhasebe";
    $$(".firm-name").forEach((el) => (el.textContent = FIRMA));
    try {
      db = window.createBackend(C);
      await db.init();
      if (db.mode === "cloud" && !(await db.session())) return showLogin();
      await enterApp();
    } catch (e) {
      console.error(e);
      $("#boot").innerHTML = `<div class="card" style="max-width:480px"><h2>Bağlantı hatası</h2><p>${esc(e.message || e)}</p><button class="btn" onclick="location.reload()">Tekrar dene</button></div>`;
    }
  }

  start();
})();
