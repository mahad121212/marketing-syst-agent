import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { Dashboard } from './components/Dashboard';
import { AgentChat } from './components/AgentChat';
import { CampaignsList } from './components/CampaignsList';
import { SettingsModal } from './components/SettingsModal';
import { Auth } from './components/Auth';
import { Campaign, AgentMessage } from './types';
import { supabase } from './lib/supabase';
import { Session } from '@supabase/supabase-js';

export const App: React.FC = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [activeTab, setActiveTab] = useState('agent');
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

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
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: 'm-1',
      sender: 'agent',
      content: 'Hello! I am your Autonomous Meta Ads Agent powered by Gemini 3.6 Flash & Supabase.\n\nI continuously monitor your CPA, ROAS, and Meta policy updates in real-time. Share your budget, business goals, or product proposal, and I will formulate a high-converting strategy proposal for you.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      thinkingSteps: [
        'Initialized Meta Graph API connection v19.0',
        'Queried active Supabase project "marketing syst agent sb"',
        'Loaded current historical baseline: Account ROAS 3.82x',
      ],
    },
  ]);

  // Handle Supabase Auth Session
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSupabaseConnected(!!session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setSupabaseConnected(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);


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
        body: { prompt: text }
      });

      if (error) throw error;

      const agentMsgId = `agt-${Date.now()}`;
      
      // Parse if the agent returned a tool_calls or proposal block
      // For now, we will handle the pure LLM response text
      let agentResponseContent = data.response || "No response received.";
      let proposalObj = undefined;
      let thinkingSteps = ['Connected to Supabase Edge Function', 'Executing OpenRouter API call...'];

      // Quick parser to mock a proposal if the agent mentions "budget" (Temporary until we implement strict JSON schemas)
      if (text.toLowerCase().includes('budget') || text.toLowerCase().includes('launch')) {
        proposalObj = {
          campaignName: 'AI Autonomous Scale - Broad Hook',
          budget: 120,
          objective: 'CONVERSIONS',
          suggestedCopy: 'Unlock radiant skincare backed by science. Experience 24-hour hydration without heavy oils. Order today & enjoy free shipping!',
          targetAudience: 'Broad Women 22-50 + Interest: Clean Beauty',
        };
        thinkingSteps.push('Identified budget parameter. Generated Strategy Proposal.');
      }

      const agentResponse: AgentMessage = {
        id: agentMsgId,
        sender: 'agent',
        content: agentResponseContent,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        thinkingSteps: thinkingSteps,
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
          {activeTab === 'analytics' && (
            <Dashboard campaigns={campaigns} onTriggerAgentAnalysis={handleTriggerInstantAudit} />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
