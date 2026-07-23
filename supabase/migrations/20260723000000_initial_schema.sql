-- Create user_settings table
create table public.user_settings (
  id uuid references auth.users on delete cascade not null primary key,
  openrouter_key text,
  preferred_model text default 'gemini-3.6-flash',
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.user_settings enable row level security;

-- Create policies for user_settings
create policy "Users can view their own settings"
  on public.user_settings for select
  using ( auth.uid() = id );

create policy "Users can insert their own settings"
  on public.user_settings for insert
  with check ( auth.uid() = id );

create policy "Users can update their own settings"
  on public.user_settings for update
  using ( auth.uid() = id );

-- Create campaign_state table (Sandbox/Mock Meta API)
create table public.campaign_state (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  status text not null default 'PAUSED',
  daily_budget numeric(10,2) not null,
  targeting jsonb default '{}'::jsonb,
  performance_metrics jsonb default '{"cpc": 0, "ctr": 0, "spend": 0, "impressions": 0}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.campaign_state enable row level security;

-- Create policies for campaign_state
create policy "Users can view their own campaigns"
  on public.campaign_state for select
  using ( auth.uid() = user_id );

create policy "Users can insert their own campaigns"
  on public.campaign_state for insert
  with check ( auth.uid() = user_id );

create policy "Users can update their own campaigns"
  on public.campaign_state for update
  using ( auth.uid() = user_id );

create policy "Users can delete their own campaigns"
  on public.campaign_state for delete
  using ( auth.uid() = user_id );

-- Create agent_logs table
create table public.agent_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  action text not null,
  details jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.agent_logs enable row level security;

-- Create policies for agent_logs
create policy "Users can view their own logs"
  on public.agent_logs for select
  using ( auth.uid() = user_id );

create policy "Users can insert their own logs"
  on public.agent_logs for insert
  with check ( auth.uid() = user_id );
