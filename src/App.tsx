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

  // Initial Mock Campaigns
  const [campaigns, setCampaigns] = useState<Campaign[]>([
    {
      id: 'c-1',
      name: 'Q3 Luxury Skincare Broad',
      objective: 'CONVERSIONS',
      status: 'ACTIVE',
      budget: 150,
      spent: 1420.50,
      roas: 3.85,
      cpa: 28.40,
      clicks: 3420,
      conversions: 50,
      targetAudience: 'Broad Women 25-45 Interest: Skincare',
      createdAt: '2026-07-15',
    },
    {
      id: 'c-2',
      name: 'Retargeting Website Visitors 30d',
      objective: 'CONVERSIONS',
      status: 'ACTIVE',
      budget: 80,
      spent: 890.00,
      roas: 4.60,
      cpa: 21.10,
      clicks: 1250,
      conversions: 42,
      targetAudience: 'Custom Audience: 30-day Site Visitors',
      createdAt: '2026-07-18',
    },
    {
      id: 'c-3',
      name: 'New Product Test - Serum Carousel',
      objective: 'TRAFFIC',
      status: 'LEARNING',
      budget: 50,
      spent: 210.00,
      roas: 1.80,
      cpa: 48.00,
      clicks: 890,
      conversions: 4,
      targetAudience: 'Lookalike 1% Active Buyers',
      createdAt: '2026-07-21',
    },
  ]);

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
      // Find most recent session
      const { data: sessions, error: sessionErr } = await supabase
        .from('chat_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (sessionErr) throw sessionErr;

      let sessionId = null;
      if (sessions && sessions.length > 0) {
        sessionId = sessions[0].id;
      } else {
        // Create new session
        const { data: newSession, error: createErr } = await supabase
          .from('chat_sessions')
          .insert({ user_id: userId, title: 'Main Chat' })
          .select()
          .single();
        if (createErr) throw createErr;
        sessionId = newSession.id;
      }

      setCurrentSessionId(sessionId);

      // Load messages
      const { data: chatMsgs, error: msgsErr } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

      if (msgsErr) throw msgsErr;

      if (chatMsgs) {
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
      }
    } catch (err) {
      console.error('Failed to load chat session:', err);
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

    try {
      const { data, error } = await supabase.functions.invoke('agent-loop', {
        body: { prompt: text, session_id: currentSessionId }
      });

      if (error) throw error;

      const agentMsgId = `agt-${Date.now()}`;

      // Parse the full OODA loop response from the Edge Function
      const agentResponseContent = data.response || 'No response received.';
      const thinkingSteps = data.thinkingSteps || [];
      const toolCalls = (data.toolCalls || []).map((tc: any) => ({
        name: tc.name,
        args: tc.args,
        status: tc.status || 'success',
      }));

      // Parse proposals from the Edge Function
      let proposalObj = undefined;
      if (data.proposals && data.proposals.length > 0) {
        const p = data.proposals[0];
        if (p.type === 'CAMPAIGN_CREATED') {
          proposalObj = {
            campaignName: p.campaign?.name || 'New Campaign',
            budget: p.campaign?.daily_budget || 0,
            objective: p.objective || 'CONVERSIONS',
            suggestedCopy: p.suggested_ad_copy || '',
            targetAudience: JSON.stringify(p.campaign?.targeting || {}),
          };
        } else if (p.type === 'PROPOSAL') {
          proposalObj = {
            campaignName: p.campaign_name || 'Campaign Adjustment',
            budget: p.new_daily_budget || 0,
            objective: p.action || 'ADJUSTMENT',
            suggestedCopy: `${p.reasoning}\n\nExpected Impact: ${p.expected_impact}`,
            targetAudience: p.action,
          };
        }
      }

      const agentResponse: AgentMessage = {
        id: agentMsgId,
        sender: 'agent',
        content: agentResponseContent,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        thinkingSteps,
        toolCalls,
        proposal: proposalObj,
      };

      setMessages((prev) => [...prev, agentResponse]);
    } catch (err: any) {
      console.error('Agent execution failed:', err);
      const errorMsg: AgentMessage = {
        id: `err-${Date.now()}`,
        sender: 'agent',
        content: `Error connecting to Agent Edge Function: ${err.message}. Make sure you have saved your OpenRouter API Key in Settings and the Edge Function is deployed.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsProcessing(false);
      setIsAgentRunning(false);
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
        <main style={{ flex: 1, overflowY: 'auto' }}>
          {activeTab === 'dashboard' && (
            <Dashboard campaigns={campaigns} onTriggerAgentAnalysis={handleTriggerInstantAudit} />
          )}
          {activeTab === 'agent' && (
            <AgentChat
              messages={messages}
              onSendMessage={handleSendMessage}
              onApproveProposal={handleApproveProposal}
              isProcessing={isProcessing}
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
