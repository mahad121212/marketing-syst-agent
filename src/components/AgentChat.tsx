import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles, CheckCircle2, AlertCircle, Wrench, ChevronDown, ChevronRight, Play, Plus, MessageSquare, Trash2, Clock, Target, X, Calendar, Eye } from 'lucide-react';
import { AgentMessage } from '../types';
import { supabase } from '../lib/supabase';
import { FormattedMarkdown } from './FormattedMarkdown';

const LiveProcessLoader: React.FC<{ reasoningMode: 'fast' | 'deep' }> = ({ reasoningMode }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const deepSteps = [
    { title: '🗺️ Phase 1: Strategic Planner', desc: 'Analyzing business profile, market economics, and organizing roadmap subtasks...' },
    { title: '⚙️ Phase 2: Worker OODA Loop', desc: 'Evaluating subtasks autonomously against live Meta Ads and temporal snapshot database...' },
    { title: '📋 Phase 3: Strategic review', desc: 'CSO strategy reviewer validating ad set setup...' },
    { title: '📋 Phase 4: Copywriting audit', desc: 'Lead copywriter reviewer assessing ad hooks and primary texts...' },
    { title: '📋 Phase 5: Creative review', desc: 'Creative director reviewing overlay text descriptions...' },
    { title: '📋 Phase 6: Diversity audit', desc: 'Creative diversity auditor checking format variance contextually...' },
    { title: '📋 Phase 7: Compliance audit', desc: 'Compliance reviewer checking Meta policy rules & tool operations...' },
    { title: '📋 Phase 8: Pacing & Finance review', desc: 'VP of Finance auditing daily budget spread and currency rules...' },
    { title: '🔄 Phase 9: Quality Gate Synthesizer', desc: 'Synthesizing 6 reviewer audits into pass/fail directive...' },
    { title: '📋 Phase 10: Plan Reviewer Critique', desc: 'Critiquing roadmap design and documenting execution lessons...' },
    { title: '✍️ Phase 11: Formatter', desc: 'Formatting final strategy into a high-end, structured layout...' },
    { title: '🚀 Finalizing output', desc: 'Rendering response output...' }
  ];

  const fastSteps = [
    { title: '⚙️ Worker OODA Loop Initiating', desc: 'Loading campaign database snapshots...' },
    { title: '⚙️ Iteration 1: Observe', desc: 'Retrieving account campaign hierarchy...' },
    { title: '⚙️ Iteration 2: Orient', desc: 'Matching active objects against user rules...' },
    { title: '⚙️ Iteration 3: Decide', desc: 'Formulating metric performance audit...' },
    { title: '⚙️ Iteration 4: Act', desc: 'Finalizing response advice...' }
  ];

  const steps = reasoningMode === 'deep' ? deepSteps : fastSteps;

  useEffect(() => {
    setCurrentStepIndex(0);
  }, [reasoningMode]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStepIndex((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, reasoningMode === 'deep' ? 3000 : 2000);
    return () => clearInterval(interval);
  }, [steps.length, reasoningMode]);

  return (
    <div style={{ display: 'flex', gap: '16px', alignSelf: 'flex-start', maxWidth: '85%', width: '100%' }}>
      <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 12px rgba(6, 182, 212, 0.3)' }}>
        <Bot style={{ width: '20px', height: '20px', color: '#ffffff', animation: 'pulse 1.5s infinite' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
        <div style={{
          backgroundColor: '#111827',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '16px 20px',
          color: '#f3f4f6',
          fontSize: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          maxWidth: '500px',
          minWidth: '280px'
        }}>
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes spin-loader {
              to { transform: rotate(360deg); }
            }
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: .5; }
            }
          `}} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid rgba(6, 182, 212, 0.2)', borderTopColor: '#06b6d4', animation: 'spin-loader 1s linear infinite' }} />
            <span style={{ fontSize: '13px', color: '#38bdf8', fontWeight: 600 }}>
              {reasoningMode === 'deep' ? 'Deep Reasoning Pipeline Active (12 Stages)' : 'Fast Mode Agent active...'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', backgroundColor: 'rgba(255,255,255,0.02)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ fontSize: '12px', color: '#ffffff', fontWeight: 600 }}>{steps[currentStepIndex].title}</span>
            <span style={{ fontSize: '11px', color: '#9ca3af', fontFamily: 'monospace' }}>{steps[currentStepIndex].desc}</span>
          </div>

          <div style={{ height: '4px', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              backgroundColor: '#06b6d4',
              width: `${((currentStepIndex + 1) / steps.length) * 100}%`,
              transition: 'width 0.4s ease'
            }} />
          </div>
        </div>
      </div>
    </div>
  );
};

interface ChatSession {
  id: string;
  title: string;
  updated_at: string;
  last_viewed_at?: string;
}

interface GoalSchedule {
  id: string;
  target_id: string;
  target_level: string;
  goal_description: string;
  metrics_snapshot: any;
  next_run_at: string;
  status: string;
  created_at: string;
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
  reasoningMode: 'fast' | 'deep';
  setReasoningMode: React.Dispatch<React.SetStateAction<'fast' | 'deep'>>;
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
  reasoningMode,
  setReasoningMode,
}) => {
  const [inputText, setInputText] = useState('');
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [showGoalLibrary, setShowGoalLibrary] = useState(false);
  const [goalSchedules, setGoalSchedules] = useState<GoalSchedule[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isProcessing]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isProcessing) return;
    onSendMessage(inputText);
    setInputText('');
  };

  const toggleThoughts = (id: string) => {
    setExpandedThoughts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Load goal schedules for the current session
  const loadGoalSchedules = async () => {
    if (!currentSessionId) return;
    const { data } = await supabase
      .from('goal_schedules')
      .select('*')
      .eq('session_id', currentSessionId)
      .order('created_at', { ascending: false });
    if (data) setGoalSchedules(data);
  };

  // Reload goals whenever session changes
  React.useEffect(() => {
    if (currentSessionId) loadGoalSchedules();
  }, [currentSessionId, messages]);

  const handleApproveGoal = async (goalId: string) => {
    await supabase.from('goal_schedules').update({ status: 'ACTIVE' }).eq('id', goalId);
    loadGoalSchedules();
  };

  const handleCancelGoal = async (goalId: string) => {
    await supabase.from('goal_schedules').update({ status: 'CANCELLED' }).eq('id', goalId);
    loadGoalSchedules();
  };

  const handleApproveAllPending = async () => {
    const pendingIds = goalSchedules.filter(g => g.status === 'PENDING_APPROVAL').map(g => g.id);
    if (pendingIds.length === 0) return;
    await supabase.from('goal_schedules').update({ status: 'ACTIVE' }).in('id', pendingIds);
    loadGoalSchedules();
  };

  const handleRejectAllPending = async () => {
    const pendingIds = goalSchedules.filter(g => g.status === 'PENDING_APPROVAL').map(g => g.id);
    if (pendingIds.length === 0) return;
    await supabase.from('goal_schedules').update({ status: 'CANCELLED' }).in('id', pendingIds);
    loadGoalSchedules();
  };

  const getLiveGoalStatus = (goalId: string, fallback: string) => {
    const goal = goalSchedules.find(g => g.id === goalId);
    return goal ? goal.status : fallback;
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1, position: 'relative' }}>
                  <MessageSquare style={{ width: '14px', height: '14px', color: isActive ? '#38bdf8' : '#4b5563', flexShrink: 0 }} />
                  {(!s.last_viewed_at || new Date(s.updated_at).getTime() > new Date(s.last_viewed_at).getTime() + 1000) && !isActive && (
                    <span style={{ position: 'absolute', top: '-4px', left: '-4px', width: '8px', height: '8px', backgroundColor: '#ef4444', borderRadius: '50%', border: '2px solid #0a0f1a' }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: '13px',
                      color: isActive ? '#e5e7eb' : '#9ca3af',
                      fontWeight: isActive ? 600 : 400,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '120px',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              Model: Gemini 3.6 Flash (Low) &bull; Supabase Tools Active
            </span>
            {/* Goal Library Button */}
            <button
              onClick={() => { setShowGoalLibrary(!showGoalLibrary); loadGoalSchedules(); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                border: '1px solid rgba(139, 92, 246, 0.3)',
                backgroundColor: showGoalLibrary ? 'rgba(139, 92, 246, 0.15)' : 'rgba(139, 92, 246, 0.05)',
                color: '#c084fc', cursor: 'pointer', transition: 'all 0.2s',
              }}
            >
              <Target style={{ width: '13px', height: '13px' }} />
              Goals ({goalSchedules.filter(g => g.status === 'ACTIVE' || g.status === 'PENDING_APPROVAL').length})
            </button>
          </div>
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
                      whiteSpace: msg.sender === 'user' ? 'pre-wrap' : 'normal',
                      fontWeight: msg.sender === 'user' ? 600 : 400,
                    }}
                  >
                    {isAgent ? <FormattedMarkdown content={msg.content} /> : msg.content}
                  </div>

                  {/* Dynamic rendering for single or multiple proposals */}
                  {(() => {
                    const proposals = msg.proposal
                      ? (Array.isArray(msg.proposal) ? msg.proposal : [msg.proposal])
                      : [];
                    return proposals.map((prop: any, idx: number) => {
                      if (prop.type === 'GOAL_PROPOSAL' && prop.card) {
                        return (
                          <div key={idx} style={{ padding: '18px', borderRadius: '14px', border: '1px solid rgba(139, 92, 246, 0.4)', backgroundColor: 'rgba(139, 92, 246, 0.05)', marginTop: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                              <Target style={{ width: '18px', height: '18px', color: '#c084fc' }} />
                              <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#ffffff' }}>Goal Schedule Proposed</h4>
                              {(() => {
                                const isRescheduled = (prop.card.goal_description || '').startsWith('[Agent Rescheduled] ');
                                const liveStatus = getLiveGoalStatus(prop.card.id, prop.card.status);
                                const displayStatus = isRescheduled ? 'Agent Rescheduled' : liveStatus;
                                const bgColor = isRescheduled ? 'rgba(6, 182, 212, 0.15)' : (liveStatus === 'ACTIVE' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)');
                                const textColor = isRescheduled ? '#38bdf8' : (liveStatus === 'ACTIVE' ? '#34d399' : '#fbbf24');
                                return (
                                  <span style={{ marginLeft: 'auto', fontSize: '10px', padding: '3px 8px', borderRadius: '6px', backgroundColor: bgColor, color: textColor, fontWeight: 700 }}>
                                    {displayStatus}
                                  </span>
                                );
                              })()}
                            </div>
                            <div style={{ fontSize: '13px', color: '#d1d5db', marginBottom: '10px', lineHeight: '1.5' }}>
                              {(prop.card.goal_description || '').replace('[Agent Rescheduled] ', '')}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', marginBottom: '14px' }}>
                              <div><span style={{ color: '#6b7280' }}>Target Level:</span> <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{prop.card.target_level}</span></div>
                              <div><span style={{ color: '#6b7280' }}>Next Run:</span> <span style={{ color: '#38bdf8', fontWeight: 600 }}>{new Date(prop.card.next_run_at).toLocaleString()}</span></div>
                            </div>
                            {getLiveGoalStatus(prop.card.id, prop.card.status) === 'PENDING_APPROVAL' && (
                              <div style={{ display: 'flex', gap: '10px' }}>
                                <button onClick={() => handleApproveGoal(prop.card.id)} style={{ flex: 1, backgroundColor: '#10b981', color: '#fff', border: 'none', padding: '10px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                  <CheckCircle2 style={{ width: '14px', height: '14px' }} /> Approve Schedule
                                </button>
                                <button onClick={() => handleCancelGoal(prop.card.id)} style={{ flex: 1, backgroundColor: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', padding: '10px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                  <X style={{ width: '14px', height: '14px' }} /> Reject
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      } else if (prop.campaignName) {
                        return (
                          <div key={idx} className="glass-panel" style={{ padding: '20px', borderRadius: '14px', border: '1px solid rgba(6, 182, 212, 0.4)', backgroundColor: 'rgba(6, 182, 212, 0.05)', marginTop: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                              <Sparkles style={{ width: '18px', height: '18px', color: '#06b6d4' }} />
                              <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#ffffff' }}>Generated Strategy Proposal</h4>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px', fontSize: '13px' }}>
                              <div>
                                <span style={{ color: '#9ca3af' }}>Campaign Name:</span>
                                <div style={{ fontWeight: 600, color: '#f3f4f6' }}>{prop.campaignName}</div>
                              </div>
                              <div>
                                <span style={{ color: '#9ca3af' }}>Proposed Daily Budget:</span>
                                <div style={{ fontWeight: 600, color: '#34d399' }}>${prop.budget}/day</div>
                              </div>
                              <div>
                                <span style={{ color: '#9ca3af' }}>Objective:</span>
                                <div style={{ fontWeight: 600, color: '#c084fc' }}>{prop.objective}</div>
                              </div>
                              <div>
                                <span style={{ color: '#9ca3af' }}>Target Audience:</span>
                                <div style={{ fontWeight: 600, color: '#38bdf8' }}>{prop.targetAudience}</div>
                              </div>
                            </div>

                            <div style={{ marginBottom: '16px', fontSize: '13px' }}>
                              <span style={{ color: '#9ca3af' }}>Recommended AI Ad Copy:</span>
                              <div style={{ fontStyle: 'italic', backgroundColor: 'rgba(0,0,0,0.3)', padding: '10px 12px', borderRadius: '6px', color: '#e5e7eb', marginTop: '4px' }}>
                                "{prop.suggestedCopy}"
                              </div>
                            </div>

                            <button
                              onClick={() => onApproveProposal(prop)}
                              style={{
                                width: '100%', backgroundColor: '#10b981', color: '#ffffff', border: 'none',
                                padding: '10px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                              }}
                            >
                              <Play style={{ width: '14px', height: '14px', fill: '#ffffff' }} />
                              Approve &amp; Launch Live on Meta Ads Manager
                            </button>
                          </div>
                        );
                      }
                      return null;
                    });
                  })()}

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
          {isProcessing && <LiveProcessLoader reasoningMode={reasoningMode} />}
          <div ref={messagesEndRef} />
        </div>

        {/* Goal Library Drawer (slides in from right) */}
        {showGoalLibrary && (
          <div style={{
            position: 'absolute', right: 0, top: 0, bottom: 0, width: '360px',
            backgroundColor: '#0c111d', borderLeft: '1px solid rgba(255,255,255,0.08)',
            zIndex: 100, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 30px rgba(0,0,0,0.5)',
          }}>
            <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Target style={{ width: '18px', height: '18px', color: '#c084fc' }} />
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#f3f4f6' }}>Goal Schedules</h3>
              </div>
              <button onClick={() => setShowGoalLibrary(false)} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', padding: '4px' }}>
                <X style={{ width: '18px', height: '18px' }} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {/* Bulk Actions Header */}
              {(() => {
                const pendingCount = goalSchedules.filter(g => g.status === 'PENDING_APPROVAL').length;
                if (pendingCount > 0) {
                  return (
                    <div style={{
                      padding: '12px', borderRadius: '10px', backgroundColor: 'rgba(245,158,11,0.08)',
                      border: '1px solid rgba(245,158,11,0.2)', marginBottom: '16px', display: 'flex',
                      flexDirection: 'column', gap: '8px'
                    }}>
                      <div style={{ fontSize: '12px', color: '#fbbf24', fontWeight: 600 }}>
                        {pendingCount} Goal{pendingCount > 1 ? 's' : ''} Pending Approval
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={handleApproveAllPending} style={{ flex: 1, backgroundColor: '#10b981', color: '#fff', border: 'none', padding: '8px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                          <CheckCircle2 style={{ width: '12px', height: '12px' }} /> Approve All
                        </button>
                        <button onClick={handleRejectAllPending} style={{ flex: 1, backgroundColor: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', padding: '8px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                          <X style={{ width: '12px', height: '12px' }} /> Reject All
                        </button>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}

              {goalSchedules.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#4b5563', fontSize: '13px', marginTop: '40px' }}>
                  No goal schedules in this chat session yet.
                </div>
              ) : (
                goalSchedules.map((goal) => (
                  <div key={goal.id} style={{
                    padding: '16px', borderRadius: '12px', marginBottom: '12px',
                    border: '1px solid ' + (goal.status === 'ACTIVE' ? 'rgba(16,185,129,0.3)' : goal.status === 'PENDING_APPROVAL' ? 'rgba(245,158,11,0.3)' : 'rgba(107,114,128,0.3)'),
                    backgroundColor: goal.status === 'ACTIVE' ? 'rgba(16,185,129,0.05)' : goal.status === 'PENDING_APPROVAL' ? 'rgba(245,158,11,0.05)' : 'rgba(107,114,128,0.05)',
                  }}>
                     <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                      {(() => {
                        const isRescheduled = goal.goal_description.startsWith('[Agent Rescheduled] ');
                        const displayStatus = isRescheduled ? 'Agent Rescheduled' : goal.status;
                        const bgColor = isRescheduled ? 'rgba(6, 182, 212, 0.15)' : (goal.status === 'ACTIVE' ? 'rgba(16,185,129,0.15)' : goal.status === 'PENDING_APPROVAL' ? 'rgba(245,158,11,0.15)' : 'rgba(107,114,128,0.15)');
                        const textColor = isRescheduled ? '#38bdf8' : (goal.status === 'ACTIVE' ? '#34d399' : goal.status === 'PENDING_APPROVAL' ? '#fbbf24' : '#6b7280');
                        return (
                          <span style={{
                            fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px',
                            backgroundColor: bgColor,
                            color: textColor,
                          }}>
                            {displayStatus}
                          </span>
                        );
                      })()}
                      <span style={{ fontSize: '10px', color: '#4b5563' }}>{goal.target_level}</span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#e5e7eb', fontWeight: 600, marginBottom: '8px', lineHeight: '1.4' }}>
                      {goal.goal_description.replace('[Agent Rescheduled] ', '')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#6b7280', marginBottom: '10px' }}>
                      <Calendar style={{ width: '12px', height: '12px' }} />
                      Next Run: <span style={{ color: '#38bdf8' }}>{new Date(goal.next_run_at).toLocaleString()}</span>
                    </div>
                    {goal.status === 'PENDING_APPROVAL' && (
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                        <button onClick={() => handleApproveGoal(goal.id)} style={{
                          flex: 1, backgroundColor: '#10b981', color: '#fff', border: 'none',
                          padding: '8px', borderRadius: '6px', fontWeight: 600, fontSize: '12px',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px'
                        }}>
                          <CheckCircle2 style={{ width: '12px', height: '12px' }} /> Approve
                        </button>
                        <button onClick={() => handleCancelGoal(goal.id)} style={{
                          flex: 1, backgroundColor: 'rgba(239,68,68,0.1)', color: '#f87171',
                          border: '1px solid rgba(239,68,68,0.3)', padding: '8px', borderRadius: '6px',
                          fontWeight: 600, fontSize: '12px', cursor: 'pointer', display: 'flex',
                          alignItems: 'center', justifyContent: 'center', gap: '4px'
                        }}>
                          <X style={{ width: '12px', height: '12px' }} /> Reject
                        </button>
                      </div>
                    )}
                    {goal.status === 'ACTIVE' && (
                      <button onClick={() => handleCancelGoal(goal.id)} style={{
                        width: '100%', backgroundColor: 'rgba(239,68,68,0.1)', color: '#f87171',
                        border: '1px solid rgba(239,68,68,0.3)', padding: '8px', borderRadius: '6px',
                        fontWeight: 600, fontSize: '12px', cursor: 'pointer', transition: 'all 0.2s',
                        marginTop: '10px'
                      }}>
                        Cancel Goal
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Input Area */}
        <form onSubmit={handleSend} style={{ padding: '20px 28px', backgroundColor: '#0c111d', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
          {/* Mode Switcher */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(255, 255, 255, 0.4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Reasoning Mode:</span>
            <div style={{ display: 'flex', backgroundColor: '#111827', padding: '3px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
              <button
                type="button"
                onClick={() => setReasoningMode('fast')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: reasoningMode === 'fast' ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
                  color: reasoningMode === 'fast' ? '#38bdf8' : 'rgba(255, 255, 255, 0.4)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <Sparkles style={{ width: '12px', height: '12px', opacity: reasoningMode === 'fast' ? 1 : 0.6 }} />
                <span>Fast</span>
              </button>
              <button
                type="button"
                onClick={() => setReasoningMode('deep')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: reasoningMode === 'deep' ? 'rgba(139, 92, 246, 0.15)' : 'transparent',
                  color: reasoningMode === 'deep' ? '#a78bfa' : 'rgba(255, 255, 255, 0.4)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <Bot style={{ width: '12px', height: '12px', opacity: reasoningMode === 'deep' ? 1 : 0.6 }} />
                <span>Deep Reasoning</span>
              </button>
            </div>
            
            {reasoningMode === 'deep' && (
              <span style={{
                fontSize: '11px',
                color: '#f59e0b',
                backgroundColor: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.2)',
                padding: '3px 8px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginLeft: '8px',
              }}>
                <AlertCircle style={{ width: '11px', height: '11px' }} />
                Requires ~3x more tokens (Planner & Reviewers feedback loop enabled)
              </span>
            )}
          </div>

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
