create table if not exists public.hello (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.hello enable row level security;

drop policy if exists "hello_read_all" on public.hello;
create policy "hello_read_all" on public.hello for select using (true);

drop policy if exists "hello_insert_all" on public.hello;
create policy "hello_insert_all" on public.hello for insert with check (true);
