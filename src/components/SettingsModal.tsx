import React, { useState, useEffect } from 'react';
import { Key, ShieldCheck, Database, Check, Save, Zap, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface SettingsModalProps {
  onSave: (settings: { metaToken: string; adAccountId: string; openRouterKey: string; preferredModel: string }) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onSave }) => {
  const [metaToken, setMetaToken] = useState('');
  const [adAccountId, setAdAccountId] = useState('');
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [preferredModel, setPreferredModel] = useState('google/gemini-3.6-flash');
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data, error } = await supabase
            .from('user_settings')
            .select('*')
            .eq('id', session.user.id)
            .single();
            
          if (data) {
            if (data.openrouter_key) setOpenRouterKey(data.openrouter_key);
            if (data.preferred_model) setPreferredModel(data.preferred_model);
          }
        }
      } catch (err) {
        console.error('Failed to load settings', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ metaToken, adAccountId, openRouterKey, preferredModel });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', color: '#9ca3af' }}>
        <Loader2 className="animate-spin" style={{ marginRight: '8px' }} />
        <span>Loading settings...</span>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px', maxWidth: '700px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f3f4f6' }}>Agent Settings & Credentials</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#9ca3af' }}>
          Configure your LLM provider and Meta API credentials for autonomous operation.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* LLM Settings Section */}
        <div className="glass-panel" style={{ padding: '24px', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#06b6d4', marginBottom: '8px' }}>
            <Zap style={{ width: '18px', height: '18px' }} />
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>LLM Intelligence (OpenRouter)</h3>
          </div>
          
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#d1d5db', marginBottom: '8px' }}>
              OpenRouter API Key
            </label>
            <input
              type="password"
              value={openRouterKey}
              onChange={(e) => setOpenRouterKey(e.target.value)}
              placeholder="sk-or-v1-..."
              style={{
                width: '100%',
                backgroundColor: '#111827',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '10px 14px',
                color: '#f3f4f6',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#d1d5db', marginBottom: '8px' }}>
              Agent Reasoning Model
            </label>
            <select
              value={preferredModel}
              onChange={(e) => setPreferredModel(e.target.value)}
              style={{
                width: '100%',
                backgroundColor: '#111827',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '10px 14px',
                color: '#f3f4f6',
                fontSize: '14px',
                boxSizing: 'border-box',
                cursor: 'pointer'
              }}
            >
              <option value="openai/gpt-4o-mini">OpenAI: GPT-4o Mini (Fast/Efficient)</option>
              <option value="google/gemini-3.6-flash">Google: Gemini 3.6 Flash (Recommended)</option>
            </select>
          </div>
        </div>

        {/* Meta Settings Section */}
        <div className="glass-panel" style={{ padding: '24px', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', marginBottom: '8px' }}>
            <Database style={{ width: '18px', height: '18px' }} />
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Meta Ads Sandbox Connection</h3>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#d1d5db', marginBottom: '8px' }}>
              Meta Ad Account ID
            </label>
            <input
              type="text"
              value={adAccountId}
              onChange={(e) => setAdAccountId(e.target.value)}
              placeholder="act_123456789"
              style={{
                width: '100%',
                backgroundColor: '#111827',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '10px 14px',
                color: '#f3f4f6',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#d1d5db', marginBottom: '8px' }}>
              Meta Access Token (OAuth / System User Token)
            </label>
            <input
              type="password"
              value={metaToken}
              onChange={(e) => setMetaToken(e.target.value)}
              placeholder="EAAG..."
              style={{
                width: '100%',
                backgroundColor: '#111827',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                padding: '10px 14px',
                color: '#f3f4f6',
                fontSize: '14px',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ fontSize: '12px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldCheck style={{ width: '14px', height: '14px' }} />
            <span>Tokens are securely stored & used server-side in Supabase Edge Functions</span>
          </div>
        </div>

        <button
          type="submit"
          style={{
            backgroundColor: '#06b6d4',
            color: '#090d16',
            border: 'none',
            padding: '12px 20px',
            borderRadius: '10px',
            fontWeight: 700,
            fontSize: '14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            alignSelf: 'flex-start',
            transition: 'background-color 0.2s',
          }}
          onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#0891b2'}
          onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#06b6d4'}
        >
          {saved ? <Check style={{ width: '16px', height: '16px' }} /> : <Save style={{ width: '16px', height: '16px' }} />}
          <span>{saved ? 'Settings Saved to Supabase' : 'Save Connection Credentials'}</span>
        </button>
      </form>
    </div>
  );
};

