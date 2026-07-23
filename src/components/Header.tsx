import React from 'react';
import { Activity, ShieldCheck, Zap } from 'lucide-react';

interface HeaderProps {
  activeTabName: string;
  isAgentRunning: boolean;
}

export const Header: React.FC<HeaderProps> = ({ activeTabName, isAgentRunning }) => {
  return (
    <header style={{ height: '70px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', backgroundColor: '#0c111d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', position: 'sticky', top: 0, zIndex: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#f3f4f6' }}>{activeTabName}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '4px 10px', borderRadius: '20px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
          <ShieldCheck style={{ width: '14px', height: '14px', color: '#10b981' }} />
          <span style={{ fontSize: '12px', color: '#34d399', fontWeight: 500 }}>Meta Graph API v19.0 Ready</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
        {/* Agent Live Loop Status Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: isAgentRunning ? 'rgba(6, 182, 212, 0.12)' : 'rgba(255, 255, 255, 0.04)', padding: '6px 14px', borderRadius: '20px', border: `1px solid ${isAgentRunning ? 'rgba(6, 182, 212, 0.3)' : 'rgba(255, 255, 255, 0.08)'}` }}>
          <Zap style={{ width: '14px', height: '14px', color: isAgentRunning ? '#38bdf8' : '#9ca3af' }} />
          <span style={{ fontSize: '12px', color: isAgentRunning ? '#38bdf8' : '#d1d5db', fontWeight: 600 }}>
            {isAgentRunning ? 'Autonomous Agent Active (OODA Loop)' : 'Agent Standing By'}
          </span>
          {isAgentRunning && (
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#06b6d4', boxShadow: '0 0 10px #06b6d4', animation: 'pulse 1.5s infinite' }} />
          )}
        </div>

        {/* User Profile Pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 8px 4px 4px', borderRadius: '24px', backgroundColor: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', fontWeight: 600, fontSize: '13px' }}>
            MA
          </div>
          <span style={{ fontSize: '13px', color: '#e5e7eb', fontWeight: 500, paddingRight: '6px' }}>Meta Ad Manager</span>
        </div>
      </div>
    </header>
  );
};
