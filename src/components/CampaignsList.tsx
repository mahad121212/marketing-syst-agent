import React from 'react';
import { Megaphone, Play, Pause, Plus, ExternalLink, Zap } from 'lucide-react';
import { Campaign } from '../types';

interface CampaignsListProps {
  campaigns: Campaign[];
  onToggleStatus: (id: string) => void;
  onOpenNewCampaignModal: () => void;
}

export const CampaignsList: React.FC<CampaignsListProps> = ({ campaigns, onToggleStatus, onOpenNewCampaignModal }) => {
  return (
    <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f3f4f6' }}>Meta Ad Campaigns</h2>
          <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#9ca3af' }}>
            Managed by Autonomous Marketing Agent &bull; Direct Meta Graph API Connection
          </p>
        </div>
        <button
          onClick={onOpenNewCampaignModal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: '#06b6d4',
            color: '#090d16',
            border: 'none',
            padding: '10px 18px',
            borderRadius: '10px',
            fontWeight: 700,
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          <Plus style={{ width: '16px', height: '16px' }} />
          Create New Campaign
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '20px' }}>
        {campaigns.map((c) => (
          <div key={c.id} className="glass-panel glass-panel-hover" style={{ padding: '22px', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '38px', height: '38px', borderRadius: '10px', backgroundColor: 'rgba(6, 182, 212, 0.12)', border: '1px solid rgba(6, 182, 212, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Megaphone style={{ width: '18px', height: '18px', color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#f9fafb' }}>{c.name}</h4>
                  <span style={{ fontSize: '12px', color: '#9ca3af' }}>Target: {c.targetAudience}</span>
                </div>
              </div>

              <button
                onClick={() => onToggleStatus(c.id)}
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  padding: '6px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                }}
                title={c.status === 'ACTIVE' ? 'Pause Campaign' : 'Activate Campaign'}
              >
                {c.status === 'ACTIVE' ? (
                  <Pause style={{ width: '16px', height: '16px', color: '#f59e0b' }} />
                ) : (
                  <Play style={{ width: '16px', height: '16px', color: '#10b981' }} />
                )}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', backgroundColor: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px' }}>
              <div>
                <span style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>Daily Budget</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#f3f4f6' }}>${c.budget}</span>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>ROAS</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: c.roas >= 3.0 ? '#34d399' : '#fbbf24' }}>{c.roas.toFixed(2)}x</span>
              </div>
              <div>
                <span style={{ fontSize: '11px', color: '#9ca3af', display: 'block' }}>CPA</span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: c.cpa <= 35 ? '#34d399' : '#f87171' }}>${c.cpa.toFixed(2)}</span>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', color: '#6b7280', paddingTop: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Zap style={{ width: '12px', height: '12px', color: '#06b6d4' }} />
                <span>Auto-optimized by Agent</span>
              </div>
              <span>{c.conversions} conversions</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
