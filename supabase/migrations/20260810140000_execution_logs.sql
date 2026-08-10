-- Create the execution_logs table
CREATE TABLE IF NOT EXISTS public.execution_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) NOT NULL,
    session_id UUID REFERENCES public.chat_sessions(id) NOT NULL,
    action_card_id UUID REFERENCES public.action_cards(id),
    level TEXT NOT NULL CHECK (level IN ('INFO', 'WARNING', 'ERROR', 'SUCCESS')),
    message TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Enable Row Level Security
ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;

-- Create policies so users can only see their own logs
CREATE POLICY "Users can view their own execution logs"
    ON public.execution_logs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own execution logs"
    ON public.execution_logs FOR INSERT
    WITH CHECK (auth.uid() = user_id);
