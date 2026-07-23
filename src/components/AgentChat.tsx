import React, { useState } from 'react';
import { Send, Bot, User, Sparkles, CheckCircle2, AlertCircle, Wrench, ChevronDown, ChevronRight, Play, Plus, MessageSquare, Trash2 } from 'lucide-react';
import { AgentMessage } from '../types';

interface ChatSession {
  id: string;
  title: string;
  updated_at: string;
}

interface AgentChatProps {
  messages: AgentMessage[];
  onSendMessage: (text: string) => void;
  onApproveProposal: (proposal: NonNullable<AgentMessage['proposal']>) => void;
  isProcessing: boolean;
  sessions: ChatSession[];
  currentSessionId: string | null;
  onNewChat: () => void;
  onSwitchSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}

export const AgentChat: React.FC<AgentChatProps> = ({
  messages,
  onSendMessage,
  onApproveProposal,
  isProcessing,
  sessions,
  currentSessionId,
  onNewChat,
  onSwitchSession,
  onDeleteSession,
}) => {
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

  const formatSessionDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffH < 1) return 'Just now';
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD === 1) return 'Yesterday';
    if (diffD < 7) return `${diffD}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 70px)', backgroundColor: '#090d16' }}>
      {/* Chat Sessions Sidebar */}
      <div style={{
        width: '240px',
        backgroundColor: '#0a0f1a',
        borderRight: '1px solid rgba(255, 255, 255, 0.06)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}>
        {/* New Chat Button */}
        <div style={{ padding: '16px 12px 8px' }}>
          <button
            onClick={onNewChat}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 14px',
              borderRadius: '10px',
              border: '1px solid rgba(6, 182, 212, 0.3)',
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%)',
              color: '#38bdf8',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(6, 182, 212, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%)';
              e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'linear-gradient(135deg, rgba(6, 182, 212, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%)';
              e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.3)';
            }}
          >
            <Plus style={{ width: '16px', height: '16px' }} />
            <span>New Chat</span>
          </button>
        </div>

        {/* Sessions List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
          <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '8px 8px 6px', marginBottom: '2px' }}>
            Chat History
          </div>
          {sessions.map((s) => {
            const isActive = s.id === currentSessionId;
            return (
              <div
                key={s.id}
                onClick={() => onSwitchSession(s.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 10px',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  backgroundColor: isActive ? 'rgba(6, 182, 212, 0.1)' : 'transparent',
                  border: isActive ? '1px solid rgba(6, 182, 212, 0.2)' : '1px solid transparent',
                  marginBottom: '2px',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                  <MessageSquare style={{ width: '14px', height: '14px', color: isActive ? '#38bdf8' : '#4b5563', flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: '13px',
                      color: isActive ? '#e5e7eb' : '#9ca3af',
                      fontWeight: isActive ? 600 : 400,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '140px',
                    }}>
                      {s.title}
                    </div>
                    <div style={{ fontSize: '10px', color: '#4b5563', marginTop: '1px' }}>
                      {formatSessionDate(s.updated_at)}
                    </div>
                  </div>
                </div>
                {/* Delete button */}
                {sessions.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(s.id);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#4b5563',
                      cursor: 'pointer',
                      padding: '4px',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      opacity: 0.5,
                      transition: 'opacity 0.2s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = '#ef4444'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = '#4b5563'; }}
                  >
                    <Trash2 style={{ width: '12px', height: '12px' }} />
                  </button>
                )}
              </div>
            );
          })}
          {sessions.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: '#4b5563', fontSize: '12px' }}>
              No chats yet. Start a new conversation!
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
          {messages.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '16px', opacity: 0.6 }}>
              <div style={{
                width: '64px', height: '64px', borderRadius: '16px',
                background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 0 30px rgba(6, 182, 212, 0.3)',
              }}>
                <Bot style={{ width: '32px', height: '32px', color: '#fff' }} />
              </div>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#e5e7eb' }}>Start a Conversation</h3>
              <p style={{ margin: 0, fontSize: '13px', color: '#6b7280', textAlign: 'center', maxWidth: '400px', lineHeight: '1.5' }}>
                Ask the agent about your campaigns, request strategy proposals, or tell it to monitor your ad account performance.
              </p>
            </div>
          )}
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
    </div>
  );
};
