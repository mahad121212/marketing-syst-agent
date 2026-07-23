import React from 'react';
import { DollarSign, TrendingUp, Target, MousePointer, ShieldCheck, ArrowUpRight, BarChart3, RefreshCw } from 'lucide-react';
import { Campaign } from '../types';

interface DashboardProps {
  campaigns: Campaign[];
  onTriggerAgentAnalysis: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ campaigns, onTriggerAgentAnalysis }) => {
  const totalSpend = campaigns.reduce((acc, c) => acc + c.spent, 0);
  const totalConversions = campaigns.reduce((acc, c) => acc + c.conversions, 0);
  const totalClicks = campaigns.reduce((acc, c) => acc + c.clicks, 0);
  const avgRoas = campaigns.length ? (campaigns.reduce((acc, c) => acc + c.roas, 0) / campaigns.length).toFixed(2) : '0.00';
  const avgCpa = totalConversions > 0 ? (totalSpend / totalConversions).toFixed(2) : '0.00';

  const stats = [
    { title: 'Total Ad Spend', value: `$${totalSpend.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, icon: DollarSign, change: '+12.5% vs last week', color: '#06b6d4' },
    { title: 'Average ROAS', value: `${avgRoas}x`, icon: TrendingUp, change: 'Target ROAS: 3.5x', color: '#10b981' },
    { title: 'Cost Per Acquisition (CPA)', value: `$${avgCpa}`, icon: Target, change: 'Target CPA: <$35.00', color: '#8b5cf6' },
    { title: 'Total Conversions', value: totalConversions.toLocaleString(), icon: MousePointer, change: `${totalClicks.toLocaleString()} total clicks`, color: '#f59e0b' },
  ];

  return (
    <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Top Banner: Autonomous Optimization Banner */}
      <div style={{ background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%)', borderRadius: '16px', border: '1px solid rgba(6, 182, 212, 0.3)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', color: '#38bdf8', backgroundColor: 'rgba(6, 182, 212, 0.2)', padding: '3px 8px', borderRadius: '4px' }}>
              AUTONOMOUS OODA LOOP ACTIVE
            </span>
            <span style={{ fontSize: '12px', color: '#9ca3af' }}>Meta Policy Sync: Real-time</span>
          </div>
          <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#ffffff' }}>98% Target Efficiency System Active</h3>
          <p style={{ margin: '6px 0 0 0', fontSize: '14px', color: '#9ca3af', maxWidth: '600px' }}>
            The agent continuously monitors CPA anomalies, automatically reallocating budgets to winning ad sets every 4 hours.
          </p>
        </div>
        <button
          onClick={onTriggerAgentAnalysis}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            backgroundColor: '#06b6d4',
            color: '#090d16',
            border: 'none',
            padding: '12px 20px',
            borderRadius: '10px',
            fontWeight: 700,
            fontSize: '14px',
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(6, 182, 212, 0.4)',
            transition: 'transform 0.2s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-2px)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
        >
          <RefreshCw style={{ width: '16px', height: '16px' }} />
          Run Instant Agent Audit
        </button>
      </div>

      {/* Stats Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
        {stats.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <div key={idx} className="glass-panel glass-panel-hover" style={{ padding: '20px', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '13px', color: '#9ca3af', fontWeight: 500 }}>{stat.title}</span>
                <div style={{ width: '36px', height: '36px', borderRadius: '10px', backgroundColor: `${stat.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon style={{ width: '18px', height: '18px', color: stat.color }} />
                </div>
              </div>
              <div style={{ fontSize: '26px', fontWeight: 700, color: '#f9fafb', letterSpacing: '-0.02em' }}>{stat.value}</div>
              <div style={{ fontSize: '12px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <ArrowUpRight style={{ width: '14px', height: '14px', color: '#10b981' }} />
                <span>{stat.change}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Campaigns Quick Performance Table */}
      <div className="glass-panel" style={{ padding: '24px', borderRadius: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <BarChart3 style={{ width: '20px', height: '20px', color: '#06b6d4' }} />
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#f3f4f6' }}>Live Meta Campaigns Overview</h3>
          </div>
          <span style={{ fontSize: '12px', color: '#9ca3af' }}>Showing {campaigns.length} Active Campaigns</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: '#9ca3af' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Campaign Name</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Budget</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Spent</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>CPA</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>ROAS</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)', color: '#e5e7eb' }}>
                  <td style={{ padding: '14px 16px', fontWeight: 600, color: '#f3f4f6' }}>{c.name}</td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '12px', backgroundColor: c.status === 'ACTIVE' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)', color: c.status === 'ACTIVE' ? '#34d399' : '#fbbf24', border: `1px solid ${c.status === 'ACTIVE' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}` }}>
                      {c.status}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px' }}>${c.budget}/day</td>
                  <td style={{ padding: '14px 16px' }}>${c.spent.toFixed(2)}</td>
                  <td style={{ padding: '14px 16px', color: c.cpa <= 35 ? '#34d399' : '#f87171' }}>${c.cpa.toFixed(2)}</td>
                  <td style={{ padding: '14px 16px', fontWeight: 700, color: c.roas >= 3.0 ? '#34d399' : '#fbbf24' }}>{c.roas.toFixed(2)}x</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
