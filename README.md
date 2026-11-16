# İnşaat Muhasebe

Şantiye bazlı taşeron anlaşması, ödeme, gider ve fatura takibi.

## Özellikler

- **Projeler / şantiyeler**: Birden fazla şantiye. Üstteki menüden proje seçilerek filtrelenir.
- **Taşeron anlaşmaları**: Sıvacı, boyacı vb. ile **toplam m² × birim fiyat** anlaşması. Toplam tutar otomatik hesaplanır.
- **Ödemeler**: Her ödeme anlaşma tutarından düşer. Ödenen ve kalan borç anında görünür. Dekont eklenebilir.
- **Giderler**: Eleman, yemek, muhasebe, malzeme, nakliye… (yeni tür de yazılabilir). Fatura/fiş eklenebilir.
- **Faturalar & Belgeler**: Taranmış PDF veya fotoğraflar tek ekranda listelenir.
- **Özet**: Toplam anlaşma, ödenen, kalan borç, gider dağılımı, son hareketler.
- **Hesap dökümü yazdırma** (taşeron detay sayfası), **Excel (CSV) aktarma**, **yedek alma**.
- Telefon ve bilgisayarda çalışır. Koyu tema desteklenir.

## Teknik yapı

- Saf HTML/CSS/JavaScript, derleme adımı yok, GitHub Pages'te çalışır.
- Veriler ve belgeler **Supabase**'de (ücretsiz katman: 500 MB veritabanı, 1 GB dosya) saklanır.
- `js/config.js` boşsa site **yerel mod**da çalışır, veriler yalnızca o tarayıcıda durur. Bu mod sadece deneme içindir.

```
index.html          Sayfa iskeleti
css/style.css       Görünüm
js/config.js        Firma adı + Supabase bilgileri  ← sadece burayı düzenleyin
js/db.js            Veri katmanı (Supabase / yerel)
js/app.js           Uygulama
supabase/schema.sql Veritabanı kurulumu
```

---

## Kurulum

### 1) Supabase (veritabanı + belge deposu)

1. https://supabase.com adresinde ücretsiz hesap açın, **New project** oluşturun (bölge: *Central EU (Frankfurt)*).
2. Sol menü **SQL Editor > New query**: `supabase/schema.sql` dosyasının tamamını yapıştırıp **Run** deyin.
3. **Authentication > Sign In / Providers**: **"Allow new users to sign up"** seçeneğini **KAPATIN**.
   > Bu önemli. Açık kalırsa siteyi bulan herkes hesap açıp verileri görebilir.
4. **Authentication > Users > Add user > Create new user**: Müşteri için e-posta + şifre oluşturun
   (*Auto Confirm User* işaretli olsun). Birden fazla kişi kullanacaksa her birine ayrı kullanıcı açın.
5. **Project Settings > API** (veya *Data API*) sayfasından **Project URL** ve **anon public** anahtarını kopyalayıp
   `js/config.js` içine yazın:

   ```js
   SUPABASE_URL: "https://xxxxxx.supabase.co",
   SUPABASE_ANON_KEY: "eyJhbGciOi...",
   ```

   > `anon` anahtarı herkese açık olacak şekilde tasarlanmıştır. Verileri giriş zorunluluğu (RLS) korur.
   > **`service_role` anahtarını asla buraya koymayın.**

### 2) GitHub Pages

```bash
git init
git add .
git commit -m "İlk sürüm"
git branch -M main
git remote add origin https://github.com/KULLANICI/ismail-insaat.git
git push -u origin main
```

GitHub'da: **Settings > Pages > Source: Deploy from a branch > main / (root) > Save**.
Birkaç dakika sonra `https://KULLANICI.github.io/ismail-insaat/` adresinde açılır.

> Ücretsiz GitHub hesabında Pages için depo **Public** olmalı. Bu sorun değil: kodda gizli bilgi yok,
> veriler Supabase'de giriş korumasıyla duruyor.

### 3) Domain bağlama

1. GitHub: **Settings > Pages > Custom domain** alanına domaini yazın (örn. `muhasebe.ornekinsaat.com`) ve kaydedin.
   (Bu işlem depoya `CNAME` dosyası ekler.)
2. Domain firmanızın DNS panelinde:
   - **Alt alan adı** (`muhasebe.ornekinsaat.com`) için: `CNAME` kaydı, `muhasebe` → `KULLANICI.github.io`
   - **Ana domain** (`ornekinsaat.com`) için: 4 adet `A` kaydı:
     `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
3. DNS yayıldıktan sonra (birkaç dakika ile birkaç saat arası) GitHub'da **Enforce HTTPS** kutusunu işaretleyin.
4. Supabase: **Authentication > URL Configuration > Site URL** alanına domaininizi yazın.

---

## Kullanım akışı

1. **Projeler**: Şantiyeyi ekleyin.
2. **Taşeron Anlaşmaları > Yeni anlaşma**: Örneğin *Sıvacı – Ahmet Usta – 1.250 m² × 120 ₺* girildiğinde
   toplam **150.000 ₺** otomatik hesaplanır.
3. Ustaya ödeme yapıldıkça **+ Ödeme** ile girin. Kalan borç kendiliğinden düşer.
4. **Giderler**: Eleman, yemek, muhasebe vb. masrafları girin. Faturası varsa tarayıcıdan taranmış PDF/JPG'yi ekleyin.
5. **Özet** ekranından genel durumu, **Ayarlar**dan Excel çıktısı veya yedek alın.

Sayı girerken `1.250,50` veya `1250.5` yazımlarının ikisi de kabul edilir.

## Yerelde deneme

```bash
python3 -m http.server 8000
# http://localhost:8000
```
