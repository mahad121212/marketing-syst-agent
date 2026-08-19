-- Rolling Context Memory: Conversation Summaries Table
-- Persists compressed summaries of older conversation messages
-- to prevent context decay in long conversations.

CREATE TABLE IF NOT EXISTS public.conversation_summaries (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id uuid REFERENCES public.chat_sessions(id) ON DELETE CASCADE NOT NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    summary text NOT NULL,
    message_count integer NOT NULL DEFAULT 0,
    last_summarized_at timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now()
);

-- Ensure one summary per session
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_summary_session ON public.conversation_summaries(session_id);

ALTER TABLE public.conversation_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own conversation summaries"
    ON public.conversation_summaries FOR ALL USING (auth.uid() = user_id);
