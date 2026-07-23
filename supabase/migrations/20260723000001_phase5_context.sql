-- Phase 5 SQL Migration: Contextual Reasoning & Agent Action Center

-- 1. Business Profiles
CREATE TABLE IF NOT EXISTS public.business_profiles (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    business_name text NOT NULL,
    industry text,
    business_description text,
    country text,
    currency text,
    monthly_ad_budget numeric,
    target_cpa numeric,
    target_roas numeric,
    business_stage text,
    additional_context text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    UNIQUE(user_id)
);

ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own business profiles"
    ON public.business_profiles FOR ALL USING (auth.uid() = user_id);

-- 2. Agent Memory & Goals
CREATE TABLE IF NOT EXISTS public.agent_memory (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    campaign_id uuid, -- Nullable, can be general account memory
    ad_set_id uuid,
    last_analyzed_at timestamptz DEFAULT now(),
    decision_made text,
    reasoning_snapshot text,
    next_review_at timestamptz,
    goal_locked_until timestamptz, -- The 18hr lock period
    context_at_decision jsonb,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own agent memory"
    ON public.agent_memory FOR ALL USING (auth.uid() = user_id);

-- 3. Action Cards (Lined up decisions for the user)
CREATE TABLE IF NOT EXISTS public.action_cards (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    campaign_id uuid,
    priority text NOT NULL, -- 'LOW', 'HIGH', 'MANDATORY'
    action_type text NOT NULL, -- e.g. 'PAUSE_CAMPAIGN', 'INCREASE_BUDGET'
    proposed_changes jsonb NOT NULL,
    reasoning text,
    status text DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED', 'AUTO_EXECUTED'
    created_at timestamptz DEFAULT now(),
    resolved_at timestamptz
);

ALTER TABLE public.action_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own action cards"
    ON public.action_cards FOR ALL USING (auth.uid() = user_id);

-- 4. Campaign Hierarchy Upgrade (campaigns -> ad_sets -> ads)
-- Note: We will rename campaign_state to campaigns, and add the child tables.

ALTER TABLE public.campaign_state RENAME TO campaigns;

CREATE TABLE IF NOT EXISTS public.ad_sets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    campaign_id uuid REFERENCES public.campaigns(id) ON DELETE CASCADE NOT NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    targeting jsonb,
    status text DEFAULT 'ACTIVE',
    performance_metrics jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.ad_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own ad_sets"
    ON public.ad_sets FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.ads (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    ad_set_id uuid REFERENCES public.ad_sets(id) ON DELETE CASCADE NOT NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name text NOT NULL,
    creative_url text,
    copy text,
    cta text,
    status text DEFAULT 'ACTIVE',
    performance_metrics jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own ads"
    ON public.ads FOR ALL USING (auth.uid() = user_id);
