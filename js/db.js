// Veri katmanı: Supabase (bulut) veya IndexedDB (yerel) – aynı arayüz.
(() => {
  const TABLES = ["projects", "agreements", "payments", "expenses"];
  const BUCKET = "belgeler";

  const uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        });

  const safeName = (name) =>
    String(name || "dosya")
      .replace(/ı/g, "i").replace(/İ/g, "I")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .slice(-80);

  const filePath = (file) => `${new Date().getFullYear()}/${uid()}-${safeName(file.name)}`;

  // ---------------- Yerel (IndexedDB) ----------------
  class LocalBackend {
    mode = "local";

    init() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open("insaat-muhasebe", 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          for (const t of TABLES) if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: "id" });
          if (!d.objectStoreNames.contains("files")) d.createObjectStore("files", { keyPath: "path" });
        };
        req.onsuccess = () => { this.db = req.result; resolve(); };
        req.onerror = () => reject(req.error);
      });
    }

    _tx(store, mode, fn) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(store, mode);
        const r = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("İşlem iptal edildi"));
      });
    }

    async session() { return { user: { email: "Yerel kullanıcı" } }; }
    async signOut() {}

    list(table) { return this._tx(table, "readonly", (s) => s.getAll()); }

    async insert(table, row) {
      const rec = { ...row, id: uid(), created_at: new Date().toISOString() };
      await this._tx(table, "readwrite", (s) => s.put(rec));
      return rec;
    }

    async update(table, id, patch) {
      const old = await this._tx(table, "readonly", (s) => s.get(id));
      if (!old) throw new Error("Kayıt bulunamadı");
      const rec = { ...old, ...patch, id };
      await this._tx(table, "readwrite", (s) => s.put(rec));
      return rec;
    }

    remove(table, id) { return this._tx(table, "readwrite", (s) => s.delete(id)); }

    async upload(file) {
      const path = filePath(file);
      await this._tx("files", "readwrite", (s) => s.put({ path, blob: file, name: file.name, type: file.type }));
      return path;
    }

    async fileUrl(path) {
      const f = await this._tx("files", "readonly", (s) => s.get(path));
      if (!f) throw new Error("Belge bulunamadı");
      return URL.createObjectURL(f.blob);
    }

    removeFile(path) { return this._tx("files", "readwrite", (s) => s.delete(path)); }

    // Yedek: tablolar + dosyalar (base64)
    async exportAll() {
      const out = { version: 1, exported_at: new Date().toISOString(), tables: {}, files: [] };
      for (const t of TABLES) out.tables[t] = await this.list(t);
      const files = await this._tx("files", "readonly", (s) => s.getAll());
      for (const f of files) {
        const data = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = () => rej(r.error);
          r.readAsDataURL(f.blob);
        });
        out.files.push({ path: f.path, name: f.name, type: f.type, data });
      }
      return out;
    }

    async importAll(backup) {
      if (!backup || !backup.tables) throw new Error("Geçersiz yedek dosyası");
      for (const t of [...TABLES, "files"]) await this._tx(t, "readwrite", (s) => s.clear());
      for (const t of TABLES) {
        const rows = backup.tables[t] || [];
        await this._tx(t, "readwrite", (s) => rows.forEach((r) => s.put(r)));
      }
      for (const f of backup.files || []) {
        const blob = await (await fetch(f.data)).blob();
        await this._tx("files", "readwrite", (s) => s.put({ path: f.path, blob, name: f.name, type: f.type }));
      }
    }
  }

  // ---------------- Bulut (Supabase) ----------------
  class SupabaseBackend {
    mode = "cloud";

    constructor(url, key) {
      if (!window.supabase) throw new Error("Supabase kütüphanesi yüklenemedi. İnternet bağlantısını kontrol edin.");
      this.sb = window.supabase.createClient(url, key);
    }

    async init() {}

    async session() {
      const { data } = await this.sb.auth.getSession();
      return data.session;
    }

    async signIn(email, password) {
      const { error } = await this.sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "E-posta veya şifre hatalı." : error.message);
    }

    async signOut() { await this.sb.auth.signOut(); }

    async list(table) {
      const { data, error } = await this.sb.from(table).select("*").order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data;
    }

    async insert(table, row) {
      const { data, error } = await this.sb.from(table).insert(row).select().single();
      if (error) throw new Error(error.message);
      return data;
    }

    async update(table, id, patch) {
      const { data, error } = await this.sb.from(table).update(patch).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      return data;
    }

    async remove(table, id) {
      const { error } = await this.sb.from(table).delete().eq("id", id);
      if (error) throw new Error(error.message);
    }

    async upload(file) {
      const path = filePath(file);
      const { error } = await this.sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined });
      if (error) throw new Error("Belge yüklenemedi: " + error.message);
      return path;
    }

    async fileUrl(path) {
      const { data, error } = await this.sb.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    }

    async removeFile(path) { await this.sb.storage.from(BUCKET).remove([path]); }

    async exportAll() {
      const out = { version: 1, exported_at: new Date().toISOString(), tables: {} };
      for (const t of TABLES) out.tables[t] = await this.list(t);
      return out;
    }
  }

  window.createBackend = (cfg) =>
    cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
      ? new SupabaseBackend(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
      : new LocalBackend();
  window.DB_TABLES = TABLES;
})();
