-- Phase 9: Historical State Tracking System
create table if not exists public.metrics_snapshots (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null,
  target_level text not null,
  metrics jsonb not null,
  created_at timestamptz default now()
);

-- Indexes for fast lookup
create index if not exists metrics_snapshots_target_id_idx on public.metrics_snapshots(target_id);
create index if not exists metrics_snapshots_created_at_idx on public.metrics_snapshots(created_at desc);

-- RLS
alter table public.metrics_snapshots enable row level security;
create policy "Allow all access to metrics_snapshots" on public.metrics_snapshots for all using (true) with check (true);
