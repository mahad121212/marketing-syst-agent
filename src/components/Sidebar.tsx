import React from 'react';
import { LayoutDashboard, Bot, Megaphone, TrendingUp, Settings, Database, Sparkles } from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  supabaseConnected: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, supabaseConnected }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'agent', label: 'Marketing Agent', icon: Bot, badge: 'OODA' },
    { id: 'campaigns', label: 'Meta Campaigns', icon: Megaphone },
    { id: 'analytics', label: 'ROAS Analytics', icon: TrendingUp },
    { id: 'settings', label: 'Meta & API Settings', icon: Settings },
  ];

  return (
    <aside style={{ width: '260px', backgroundColor: '#0c111d', borderRight: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0 }}>
      {/* Brand Header */}
      <div style={{ padding: '24px 20px', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #8b5cf6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 15px rgba(6, 182, 212, 0.4)' }}>
          <Sparkles style={{ color: '#ffffff', width: '20px', height: '20px' }} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#f9fafb', letterSpacing: '-0.02em' }}>MetaAgent AI</h1>
          <span style={{ fontSize: '11px', color: '#06b6d4', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Autonomous Ads Agent</span>
        </div>
      </div>

      {/* Navigation Menu */}
      <nav style={{ flex: 1, padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: isActive ? 'rgba(6, 182, 212, 0.12)' : 'transparent',
                color: isActive ? '#38bdf8' : '#9ca3af',
                cursor: 'pointer',
                fontWeight: isActive ? 600 : 400,
                fontSize: '14px',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Icon style={{ width: '18px', height: '18px', color: isActive ? '#38bdf8' : '#6b7280' }} />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span style={{ fontSize: '10px', backgroundColor: 'rgba(139, 92, 246, 0.2)', color: '#c084fc', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(139, 92, 246, 0.3)', fontWeight: 600 }}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Supabase Integration Footer */}
      <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', backgroundColor: 'rgba(9, 13, 22, 0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Database style={{ width: '16px', height: '16px', color: supabaseConnected ? '#10b981' : '#f59e0b' }} />
          <div>
            <div style={{ fontSize: '12px', color: '#d1d5db', fontWeight: 500 }}>
              Supabase Backend
            </div>
            <div style={{ fontSize: '11px', color: supabaseConnected ? '#34d399' : '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: supabaseConnected ? '#10b981' : '#f59e0b', display: 'inline-block' }} />
              {supabaseConnected ? 'Connected (Live SB)' : 'Connecting...'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
