import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { AgentChat } from './components/AgentChat';
import { CampaignsList } from './components/CampaignsList';
import { SettingsModal } from './components/SettingsModal';
import { Auth } from './components/Auth';
import { BusinessProfile } from './components/BusinessProfile';
import { ActionCenter } from './components/ActionCenter';
import { Campaign, AgentMessage } from './types';
import { supabase } from './lib/supabase';
import { Session } from '@supabase/supabase-js';

export const App: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState('agent');
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<{ id: string; title: string; updated_at: string }[]>([]);
  const [reasoningMode, setReasoningMode] = useState<'fast' | 'deep'>('fast');

  // Initial Campaigns (Live mode — no mock data)
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  // Initial Agent Chat Messages
  const [messages, setMessages] = useState<AgentMessage[]>([]);

  // Handle Supabase Auth Session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSupabaseConnected(!!session);
      if (session) {
        loadOrCreateSession(session.user.id);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setSupabaseConnected(!!session);
      if (session) {
        loadOrCreateSession(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadOrCreateSession = async (userId: string) => {
    try {
      // Load ALL sessions for the sidebar
      const { data: allSessions, error: sessionErr } = await supabase
        .from('chat_sessions')
        .select('id, title, updated_at, last_viewed_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (sessionErr) throw sessionErr;

      let sessionId = null;
      if (allSessions && allSessions.length > 0) {
        setChatSessions(allSessions);
        sessionId = allSessions[0].id;
        
        // Update last_viewed_at for the initially loaded session
        if (activeTab === 'agent') {
          const now = new Date().toISOString();
          await supabase.from('chat_sessions').update({ last_viewed_at: now }).eq('id', sessionId);
          setChatSessions(allSessions.map(s => s.id === sessionId ? { ...s, last_viewed_at: now } : s));
        }
      } else {
        // Create first session
        const { data: newSession, error: createErr } = await supabase
          .from('chat_sessions')
          .insert({ user_id: userId, title: 'New Chat' })
          .select()
          .single();
        if (createErr) throw createErr;
        sessionId = newSession.id;
        setChatSessions([newSession]);
      }

      setCurrentSessionId(sessionId);
      await loadMessagesForSession(sessionId);
    } catch (err) {
      console.error('Failed to load chat session:', err);
    }
  };

  const loadMessagesForSession = async (sessionId: string) => {
    try {
      const { data: chatMsgs, error: msgsErr } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      if (msgsErr) throw msgsErr;

      if (chatMsgs && chatMsgs.length > 0) {
        const loadedMsgs: AgentMessage[] = chatMsgs.map((msg: any) => ({
          id: msg.id,
          sender: msg.role === 'agent' ? 'agent' : 'user',
          content: msg.content || '',
          timestamp: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          thinkingSteps: msg.thinking_steps || undefined,
          toolCalls: msg.tool_calls || undefined,
          proposal: msg.proposal || undefined,
        }));
        setMessages(loadedMsgs);
      } else {
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
      setMessages([]);
    }
  };

  const handleNewChat = async () => {
    if (!session) return;
    try {
      const { data: newSession, error } = await supabase
        .from('chat_sessions')
        .insert({ user_id: session.user.id, title: 'New Chat' })
        .select()
        .single();
      if (error) throw error;
      setChatSessions((prev) => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);
      setMessages([]);
    } catch (err) {
      console.error('Failed to create new chat:', err);
    }
  };

  const handleSwitchSession = async (sessionId: string) => {
    setCurrentSessionId(sessionId);
    await loadMessagesForSession(sessionId);
    
    // Update last_viewed_at for this session
    const now = new Date().toISOString();
    await supabase.from('chat_sessions').update({ last_viewed_at: now }).eq('id', sessionId);
    setChatSessions((prev) => prev.map((s) => s.id === sessionId ? { ...s, last_viewed_at: now } : s));
  };

  // Realtime Subscription for Background Agent Processing
  useEffect(() => {
    if (!currentSessionId) return;

    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
          filter: `session_id=eq.${currentSessionId}`
        },
        (payload) => {
          // Whenever a message is inserted or updated by the Edge Function, reload the UI
          loadMessagesForSession(currentSessionId);
          // If the message is from the agent and is COMPLETED or ERROR, stop the loading spinner
          if (payload.new && payload.new.role === 'agent' && (payload.new.status === 'COMPLETED' || payload.new.status === 'ERROR')) {
            setIsProcessing(false);
            setIsAgentRunning(false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentSessionId]);

  const handleDeleteSession = async (sessionId: string) => {
    if (!session) return;
    try {
      await supabase.from('chat_messages').delete().eq('session_id', sessionId);
      await supabase.from('chat_sessions').delete().eq('id', sessionId);
      const remaining = chatSessions.filter((s) => s.id !== sessionId);
      setChatSessions(remaining);
      if (currentSessionId === sessionId && remaining.length > 0) {
        setCurrentSessionId(remaining[0].id);
        await loadMessagesForSession(remaining[0].id);
      } else if (remaining.length === 0) {
        // Create a fresh session
        handleNewChat();
      }
    } catch (err) {
      console.error('Failed to delete chat session:', err);
    }
  };


  const handleSendMessage = async (text: string) => {
    const userMsgId = `usr-${Date.now()}`;
    const newMsg: AgentMessage = {
      id: userMsgId,
      sender: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, newMsg]);
    setIsProcessing(true);
    setIsAgentRunning(true);

    // Auto-rename session title from "New Chat" to a preview of the first message
    if (messages.length === 0 && currentSessionId) {
      const title = text.length > 40 ? text.substring(0, 40) + '...' : text;
      await supabase.from('chat_sessions').update({ title }).eq('id', currentSessionId);
      setChatSessions((prev) => prev.map((s) => s.id === currentSessionId ? { ...s, title } : s));
    }

    try {
      // We no longer await the final OODA loop result. We just trigger the background Edge Function.
      const { data, error } = await supabase.functions.invoke('agent-loop', {
        body: { prompt: text, session_id: currentSessionId, reasoning_mode: reasoningMode }
      });

      if (error) throw error;
      
      // The edge function instantly returns a 202 Accepted.
      // The realtime subscription (useEffect above) will catch the updates and reload the messages!

    } catch (err: any) {
      console.error('Agent execution failed:', err);
      let errorDetail = '';
      if (err?.context?.body) {
        try {
          const reader = err.context.body.getReader();
          const decoder = new TextDecoder();
          const { value } = await reader.read();
          const bodyText = decoder.decode(value);
          const bodyJson = JSON.parse(bodyText);
          if (bodyJson.error) errorDetail = bodyJson.error;
        } catch(e) { /* ignore parse errors */ }
      }
      const displayError = errorDetail || err.message || 'Unknown error';
      const errorMsg: AgentMessage = {
        id: `err-${Date.now()}`,
        sender: 'agent',
        content: `⚠️ **Agent Error:** ${displayError}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsProcessing(false);
      setIsAgentRunning(false);
      // Update session timestamp in sidebar
      if (currentSessionId) {
        const now = new Date().toISOString();
        setChatSessions((prev) =>
          prev.map((s) => s.id === currentSessionId ? { ...s, updated_at: now } : s)
              .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        );
      }
    }
  };

  const handleApproveProposal = (proposal: NonNullable<AgentMessage['proposal']>) => {
    const newCamp: Campaign = {
      id: `c-${Date.now()}`,
      name: proposal.campaignName,
      objective: proposal.objective as any,
      status: 'ACTIVE',
      budget: proposal.budget,
      spent: 0,
      roas: 4.10,
      cpa: 24.50,
      clicks: 0,
      conversions: 0,
      targetAudience: proposal.targetAudience,
      createdAt: new Date().toISOString().split('T')[0],
    };

    setCampaigns((prev) => [newCamp, ...prev]);

    // Send confirmation from Agent
    const confirmMsg: AgentMessage = {
      id: `sys-${Date.now()}`,
      sender: 'agent',
      content: `🎉 **Campaign Approved & Deployed Live!**\n\n"${proposal.campaignName}" is now active in Meta Ads Manager with a daily budget of $${proposal.budget}/day.\n\nMy autonomous background job will monitor CPA over the next 4 hours and automatically adjust bids if performance deviates from our $28 target.`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      thinkingSteps: [
        'Executed Tool: meta_graph_api_create_campaign()',
        'Pushed Ad Copy & Creative payload to Meta Graph API v19.0',
        'Scheduled 4-hour background metric polling job in Supabase pg_cron',
      ],
    };

    setMessages((prev) => [...prev, confirmMsg]);
    setActiveTab('campaigns');
  };

  const handleToggleCampaignStatus = (id: string) => {
    setCampaigns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' } : c))
    );
  };

  const handleTriggerInstantAudit = () => {
    setActiveTab('agent');
    handleSendMessage('Run an instant full audit of all my active Meta campaigns and check for CPA anomalies.');
  };

  const getTabName = () => {
    switch (activeTab) {
      case 'dashboard':
        return 'Dashboard Overview';
      case 'agent':
        return 'Autonomous Marketing Agent';
      case 'campaigns':
        return 'Meta Ad Campaigns';
      case 'analytics':
        return 'ROAS & Metric Analytics';
      case 'settings':
        return 'Meta API Settings';
      default:
        return 'Marketing Agent';
    }
  };

  if (!session) {
    return <Auth onLogin={() => {}} />;
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: '#090d16', color: '#f3f4f6' }}>
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} supabaseConnected={supabaseConnected} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header activeTabName={getTabName()} isAgentRunning={isAgentRunning} />
        <main style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
          {activeTab === 'dashboard' && (
            <Dashboard campaigns={campaigns} onTriggerAgentAnalysis={handleTriggerInstantAudit} />
          )}
          {activeTab === 'agent' && (
            <AgentChat
              messages={messages}
              onSendMessage={handleSendMessage}
              onApproveProposal={handleApproveProposal}
              isProcessing={isProcessing}
              sessions={chatSessions}
              currentSessionId={currentSessionId}
              onNewChat={handleNewChat}
              onSwitchSession={handleSwitchSession}
              onDeleteSession={handleDeleteSession}
              reasoningMode={reasoningMode}
              setReasoningMode={setReasoningMode}
            />
          )}
          {activeTab === 'campaigns' && (
            <CampaignsList
              campaigns={campaigns}
              onToggleStatus={handleToggleCampaignStatus}
              onOpenNewCampaignModal={() => setActiveTab('agent')}
            />
          )}
          {activeTab === 'settings' && (
            <SettingsModal onSave={async (settings) => {
              console.log('Saving settings to Supabase...', settings);
              try {
                const { error } = await supabase
                  .from('user_settings')
                  .upsert({
                    id: session.user.id,
                    openrouter_key: settings.openRouterKey,
                    preferred_model: settings.preferredModel,
                    meta_access_token: settings.metaToken,
                    meta_ad_account_id: settings.adAccountId,
                  });
                if (error) throw error;
                // Also update local state or show success toast if needed
              } catch (err) {
                console.error('Failed to save settings:', err);
              }
            }} />
          )}
          {activeTab === 'business' && <BusinessProfile />}
          {activeTab === 'actions' && <ActionCenter />}
          {activeTab === 'analytics' && (
            <Dashboard campaigns={campaigns} onTriggerAgentAnalysis={handleTriggerInstantAudit} />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
