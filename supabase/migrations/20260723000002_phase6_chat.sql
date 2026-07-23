-- Phase 6 SQL Migration: Chat Sessions & Persistent History

-- 1. Chat Sessions Table
CREATE TABLE IF NOT EXISTS public.chat_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title text DEFAULT 'New Chat',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own chat sessions"
    ON public.chat_sessions FOR ALL USING (auth.uid() = user_id);

-- 2. Chat Messages Table
CREATE TABLE IF NOT EXISTS public.chat_messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id uuid REFERENCES public.chat_sessions(id) ON DELETE CASCADE NOT NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role text NOT NULL, -- 'user', 'agent', 'system', etc.
    content text,
    thinking_steps jsonb,
    tool_calls jsonb,
    proposal jsonb,
    created_at timestamptz DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own chat messages"
    ON public.chat_messages FOR ALL USING (auth.uid() = user_id);
