-- =============================================================
--  İnşaat Muhasebe – Supabase şeması
--  Supabase panelinde: SQL Editor > New query > bu dosyanın
--  tamamını yapıştırıp "Run" deyin. (Bir kez çalıştırmak yeterli.)
-- =============================================================

create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  notes       text,
  units       jsonb not null default '[]'::jsonb, -- daire/dükkan listesi (maliyet hesabı)
  created_at  timestamptz not null default now()
);

-- Eski kurulumlar için (zararsız, tekrar çalıştırılabilir)
alter table public.projects add column if not exists units jsonb not null default '[]'::jsonb;

-- Taşeron anlaşmaları (örn. sıvacı: 1250 m² × 120 ₺)
create table if not exists public.agreements (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  contractor  text not null,
  job_type    text,
  phone       text,
  date        date,
  quantity    numeric(14,3) not null default 0,
  unit        text not null default 'm²',
  unit_price  numeric(14,2) not null default 0,
  notes       text,
  file_path   text,
  file_name   text,
  created_at  timestamptz not null default now()
);

-- Taşerona yapılan ödemeler (anlaşma tutarından düşer)
create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  agreement_id  uuid not null references public.agreements(id) on delete cascade,
  project_id    uuid not null references public.projects(id) on delete cascade,
  amount        numeric(14,2) not null,
  date          date,
  method        text,
  notes         text,
  file_path     text,
  file_name     text,
  created_at    timestamptz not null default now()
);

-- Diğer giderler (eleman, yemek, muhasebe, malzeme…)
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  category     text not null,
  amount       numeric(14,2) not null,
  date         date,
  paid_to      text,
  description  text,
  file_path    text,
  file_name    text,
  created_at   timestamptz not null default now()
);

create index if not exists agreements_project_idx on public.agreements(project_id);
create index if not exists payments_agreement_idx on public.payments(agreement_id);
create index if not exists payments_project_idx  on public.payments(project_id);
create index if not exists expenses_project_idx  on public.expenses(project_id);

-- ---------- Güvenlik: yalnızca giriş yapmış kullanıcılar ----------
alter table public.projects   enable row level security;
alter table public.agreements enable row level security;
alter table public.payments   enable row level security;
alter table public.expenses   enable row level security;

drop policy if exists "giris_yapanlar" on public.projects;
drop policy if exists "giris_yapanlar" on public.agreements;
drop policy if exists "giris_yapanlar" on public.payments;
drop policy if exists "giris_yapanlar" on public.expenses;

create policy "giris_yapanlar" on public.projects   for all to authenticated using (true) with check (true);
create policy "giris_yapanlar" on public.agreements for all to authenticated using (true) with check (true);
create policy "giris_yapanlar" on public.payments   for all to authenticated using (true) with check (true);
create policy "giris_yapanlar" on public.expenses   for all to authenticated using (true) with check (true);

-- ---------- Fatura / belge depolama (gizli klasör) ----------
insert into storage.buckets (id, name, public)
values ('belgeler', 'belgeler', false)
on conflict (id) do nothing;

drop policy if exists "belgeler_oku"   on storage.objects;
drop policy if exists "belgeler_yukle" on storage.objects;
drop policy if exists "belgeler_guncelle" on storage.objects;
drop policy if exists "belgeler_sil"   on storage.objects;

create policy "belgeler_oku"      on storage.objects for select to authenticated using (bucket_id = 'belgeler');
create policy "belgeler_yukle"    on storage.objects for insert to authenticated with check (bucket_id = 'belgeler');
create policy "belgeler_guncelle" on storage.objects for update to authenticated using (bucket_id = 'belgeler');
create policy "belgeler_sil"      on storage.objects for delete to authenticated using (bucket_id = 'belgeler');
