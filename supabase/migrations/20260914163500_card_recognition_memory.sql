create table if not exists public.card_recognition_examples (
  id uuid primary key default gen_random_uuid(),
  image_sha256 text not null unique,
  fingerprint text not null,
  image_url text,
  catalog_id text,
  name text not null,
  collection text,
  card_number text,
  language text not null,
  variant text,
  confirmations integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_recognition_examples_sha256_check check (image_sha256 ~ '^[a-f0-9]{64}$'),
  constraint card_recognition_examples_fingerprint_check check (fingerprint ~ '^[a-f0-9]{72}$'),
  constraint card_recognition_examples_language_check check (language in ('pt-BR', 'en', 'es', 'ja')),
  constraint card_recognition_examples_confirmations_check check (confirmations between 1 and 1000000)
);

create index if not exists card_recognition_examples_language_number_idx
  on public.card_recognition_examples (language, card_number);
create index if not exists card_recognition_examples_updated_at_idx
  on public.card_recognition_examples (updated_at desc);

alter table public.card_recognition_examples enable row level security;
revoke all on table public.card_recognition_examples from anon, authenticated;
grant all on table public.card_recognition_examples to service_role;

comment on table public.card_recognition_examples is
  'Tiny confirmed-card fingerprints used as instance memory for local card recognition. Images are not duplicated; image_url points at the existing card-images object.';
