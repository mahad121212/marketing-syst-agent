import React, { useState } from 'react';
import { Send, Bot, User, Sparkles, CheckCircle2, AlertCircle, Wrench, ChevronDown, ChevronRight, Play } from 'lucide-react';
import { AgentMessage } from '../types';

interface AgentChatProps {
  messages: AgentMessage[];
  onSendMessage: (text: string) => void;
  onApproveProposal: (proposal: NonNullable<AgentMessage['proposal']>) => void;
  isProcessing: boolean;
}

export const AgentChat: React.FC<AgentChatProps> = ({ messages, onSendMessage, onApproveProposal, isProcessing }) => {
  const [inputText, setInputText] = useState('');
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isProcessing) return;
    onSendMessage(inputText);
    setInputText('');
  };

  const toggleThoughts = (id: string) => {
    setExpandedThoughts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 70px)', backgroundColor: '#090d16' }}>
      {/* Agent Thinking Status Sub-header */}
      <div style={{ padding: '12px 28px', backgroundColor: '#0c111d', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Sparkles style={{ width: '16px', height: '16px', color: '#06b6d4' }} />
          <span style={{ fontSize: '13px', color: '#d1d5db', fontWeight: 500 }}>
            Meta Agentic Reasoner v2.0 &bull; Broad Search & ROAS Optimizer
          </span>
        </div>
        <span style={{ fontSize: '12px', color: '#6b7280' }}>
          Model: Gemini 3.6 Flash (Low) &bull; Supabase Tools Active
        </span>
      </div>

      {/* Messages Scroll Area */}
      <div style={{ flex: 1, padding: '28px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {messages.map((msg) => {
          const isAgent = msg.sender === 'agent';
          const isThoughtsExpanded = expandedThoughts[msg.id] ?? true;

          return (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                gap: '16px',
                alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: msg.sender === 'user' ? '70%' : '85%',
              }}
            >
              {/* Avatar */}
              {isAgent && (
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 12px rgba(6, 182, 212, 0.3)' }}>
                  <Bot style={{ width: '20px', height: '20px', color: '#ffffff' }} />
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                {/* Agent Thought / Tool Execution Block */}
                {isAgent && msg.thinkingSteps && msg.thinkingSteps.length > 0 && (
                  <div style={{ backgroundColor: 'rgba(17, 24, 39, 0.6)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '10px', padding: '12px 16px' }}>
                    <button
                      onClick={() => toggleThoughts(msg.id)}
                      style={{ background: 'none', border: 'none', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, padding: 0 }}
                    >
                      {isThoughtsExpanded ? <ChevronDown style={{ width: '14px', height: '14px' }} /> : <ChevronRight style={{ width: '14px', height: '14px' }} />}
                      <span>Agent Reasoning & Internal OODA Loop ({msg.thinkingSteps.length} steps)</span>
                    </button>

                    {isThoughtsExpanded && (
                      <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {msg.thinkingSteps.map((step, idx) => (
                          <div key={idx} style={{ fontSize: '12px', color: '#9ca3af', display: 'flex', alignItems: 'flex-start', gap: '8px', fontFamily: 'monospace' }}>
                            <span style={{ color: '#06b6d4' }}>&gt;</span>
                            <span>{step}</span>
                          </div>
                        ))}

                        {/* Tool execution badges if present */}
                        {msg.toolCalls?.map((tool, tIdx) => (
                          <div key={tIdx} style={{ fontSize: '11px', backgroundColor: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.2)', padding: '6px 10px', borderRadius: '6px', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', color: '#38bdf8' }}>
                            <Wrench style={{ width: '12px', height: '12px' }} />
                            <span>Executed Tool: <strong>{tool.name}</strong></span>
                            <span style={{ marginLeft: 'auto', color: '#10b981', fontWeight: 600 }}>SUCCESS</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Main Message Bubble */}
                <div
                  style={{
                    backgroundColor: msg.sender === 'user' ? '#06b6d4' : '#111827',
                    color: msg.sender === 'user' ? '#090d16' : '#f3f4f6',
                    padding: '16px 20px',
                    borderRadius: msg.sender === 'user' ? '16px 16px 2px 16px' : '2px 16px 16px 16px',
                    border: msg.sender === 'user' ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    whiteSpace: 'pre-wrap',
                    fontWeight: msg.sender === 'user' ? 600 : 400,
                  }}
                >
                  {msg.content}
                </div>

                {/* Structured Campaign Proposal Card if generated by Agent */}
                {msg.proposal && (
                  <div className="glass-panel" style={{ padding: '20px', borderRadius: '14px', border: '1px solid rgba(6, 182, 212, 0.4)', backgroundColor: 'rgba(6, 182, 212, 0.05)', marginTop: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                      <Sparkles style={{ width: '18px', height: '18px', color: '#06b6d4' }} />
                      <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#ffffff' }}>Generated Strategy Proposal</h4>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px', fontSize: '13px' }}>
                      <div>
                        <span style={{ color: '#9ca3af' }}>Campaign Name:</span>
                        <div style={{ fontWeight: 600, color: '#f3f4f6' }}>{msg.proposal.campaignName}</div>
                      </div>
                      <div>
                        <span style={{ color: '#9ca3af' }}>Proposed Daily Budget:</span>
                        <div style={{ fontWeight: 600, color: '#34d399' }}>${msg.proposal.budget}/day</div>
                      </div>
                      <div>
                        <span style={{ color: '#9ca3af' }}>Objective:</span>
                        <div style={{ fontWeight: 600, color: '#c084fc' }}>{msg.proposal.objective}</div>
                      </div>
                      <div>
                        <span style={{ color: '#9ca3af' }}>Target Audience:</span>
                        <div style={{ fontWeight: 600, color: '#38bdf8' }}>{msg.proposal.targetAudience}</div>
                      </div>
                    </div>

                    <div style={{ marginBottom: '16px', fontSize: '13px' }}>
                      <span style={{ color: '#9ca3af' }}>Recommended AI Ad Copy:</span>
                      <div style={{ fontStyle: 'italic', backgroundColor: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: '6px', color: '#e5e7eb', marginTop: '4px' }}>
                        "{msg.proposal.suggestedCopy}"
                      </div>
                    </div>

                    <button
                      onClick={() => onApproveProposal(msg.proposal!)}
                      style={{
                        width: '100%',
                        backgroundColor: '#10b981',
                        color: '#ffffff',
                        border: 'none',
                        padding: '10px 16px',
                        borderRadius: '8px',
                        fontWeight: 700,
                        fontSize: '13px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                      }}
                    >
                      <Play style={{ width: '14px', height: '14px', fill: '#ffffff' }} />
                      Approve & Launch Live on Meta Ads Manager
                    </button>
                  </div>
                )}

                <span style={{ fontSize: '11px', color: '#6b7280', alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start' }}>
                  {msg.timestamp}
                </span>
              </div>

              {/* User Avatar */}
              {msg.sender === 'user' && (
                <div style={{ width: '38px', height: '38px', borderRadius: '50%', backgroundColor: '#1f2937', border: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <User style={{ width: '18px', height: '18px', color: '#9ca3af' }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Input Area */}
      <form onSubmit={handleSend} style={{ padding: '20px 28px', backgroundColor: '#0c111d', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="e.g. 'I have a $2,500 monthly budget to launch a luxury skincare line. Target CPA < $30.'"
            disabled={isProcessing}
            style={{
              flex: 1,
              backgroundColor: '#111827',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '14px 18px',
              color: '#f3f4f6',
              fontSize: '14px',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={isProcessing || !inputText.trim()}
            style={{
              backgroundColor: isProcessing || !inputText.trim() ? '#1f2937' : '#06b6d4',
              color: isProcessing || !inputText.trim() ? '#6b7280' : '#090d16',
              border: 'none',
              borderRadius: '12px',
              padding: '14px 22px',
              fontWeight: 700,
              fontSize: '14px',
              cursor: isProcessing || !inputText.trim() ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s ease',
            }}
          >
            <span>Ask Agent</span>
            <Send style={{ width: '16px', height: '16px' }} />
          </button>
        </div>
      </form>
    </div>
  );
};
