import React, { useState, useEffect } from 'react';
import { ShieldAlert, AlertTriangle, Info, CheckCircle2, Play, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface ActionCard {
  id: string;
  campaign_id: string | null;
  priority: 'MANDATORY' | 'HIGH' | 'LOW';
  action_type: string;
  proposed_changes: any;
  reasoning: string;
  status: string;
  created_at: string;
}

export const ActionCenter: React.FC = () => {
  const [actions, setActions] = useState<ActionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoExecute, setAutoExecute] = useState(false);

  useEffect(() => {
    fetchActions();
  }, []);

  const fetchActions = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      
      const { data, error } = await supabase
        .from('action_cards')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setActions(data || []);
    } catch (err) {
      console.error('Failed to fetch actions:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const { error } = await supabase
        .from('action_cards')
        .update({ status: 'APPROVED', resolved_at: new Date().toISOString() })
        .eq('id', id);
        
      if (error) throw error;
      // In a real app, this would also trigger the Edge Function to execute the change
      setActions(actions.filter(a => a.id !== id));
    } catch (err) {
      console.error('Failed to approve action:', err);
    }
  };

  const renderPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'MANDATORY': return <ShieldAlert style={{ color: '#ef4444' }} />;
      case 'HIGH': return <AlertTriangle style={{ color: '#f59e0b' }} />;
      case 'LOW': return <Info style={{ color: '#3b82f6' }} />;
      default: return <Info style={{ color: '#9ca3af' }} />;
    }
  };

  return (
    <div style={{ padding: '28px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f3f4f6' }}>Actions Lined Up</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#9ca3af' }}>
            Review and approve decisions made by the Agent.
          </p>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: '#111827', padding: '10px 16px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <label style={{ fontSize: '13px', color: '#d1d5db', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input 
              type="checkbox" 
              checked={autoExecute} 
              onChange={(e) => setAutoExecute(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: '#06b6d4' }} 
            />
            Allow Automatic Execution (Low/High Priority)
          </label>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', color: '#9ca3af' }}>
          <Loader2 className="animate-spin" style={{ marginRight: '8px' }} />
          <span>Loading actions...</span>
        </div>
      ) : actions.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', backgroundColor: '#111827', borderRadius: '14px', border: '1px dashed rgba(255,255,255,0.1)' }}>
          <CheckCircle2 style={{ width: '32px', height: '32px', color: '#10b981', margin: '0 auto 12px auto' }} />
          <h3 style={{ margin: '0 0 8px 0', color: '#f3f4f6' }}>You're all caught up!</h3>
          <p style={{ margin: 0, color: '#9ca3af', fontSize: '14px' }}>There are no pending actions requiring your review.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {actions.map(action => (
            <div key={action.id} className="glass-panel" style={{ padding: '20px', borderRadius: '14px', borderLeft: `4px solid ${action.priority === 'MANDATORY' ? '#ef4444' : action.priority === 'HIGH' ? '#f59e0b' : '#3b82f6'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                
                <div style={{ display: 'flex', gap: '12px' }}>
                  <div style={{ marginTop: '2px' }}>{renderPriorityIcon(action.priority)}</div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', backgroundColor: 'rgba(255,255,255,0.1)', color: '#d1d5db' }}>
                        {action.priority} PRIORITY
                      </span>
                      <h4 style={{ margin: 0, fontSize: '16px', color: '#f3f4f6' }}>{action.action_type.replace(/_/g, ' ')}</h4>
                    </div>
                    
                    <p style={{ margin: '8px 0', fontSize: '14px', color: '#d1d5db', lineHeight: '1.5' }}>
                      {action.reasoning}
                    </p>
                    
                    <div style={{ backgroundColor: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace', color: '#9ca3af', marginTop: '12px' }}>
                      {JSON.stringify(action.proposed_changes, null, 2)}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleApprove(action.id)}
                  style={{
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
                    gap: '6px',
                    flexShrink: 0
                  }}
                >
                  <Play style={{ width: '14px', height: '14px', fill: '#ffffff' }} />
                  Approve Action
                </button>

              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
