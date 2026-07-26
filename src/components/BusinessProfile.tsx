import React, { useState, useEffect } from 'react';
import { Briefcase, Target, MapPin, DollarSign, Save, Check, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface BusinessProfileProps {
  onSave?: () => void;
}

export const BusinessProfile: React.FC<BusinessProfileProps> = ({ onSave }) => {
  const [businessName, setBusinessName] = useState('');
  const [industry, setIndustry] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [country, setCountry] = useState('US');
  const [currency, setCurrency] = useState('USD');
  const [monthlyAdBudget, setMonthlyAdBudget] = useState(1000);
  const [targetCpa, setTargetCpa] = useState(30);
  const [targetRoas, setTargetRoas] = useState(3);
  const [useMonthlyBudget, setUseMonthlyBudget] = useState(false);
  const [useTargetCpa, setUseTargetCpa] = useState(false);
  const [useTargetRoas, setUseTargetRoas] = useState(false);
  
  const [businessStage, setBusinessStage] = useState('NEW');
  const [additionalContext, setAdditionalContext] = useState('');
  
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data, error } = await supabase
            .from('business_profiles')
            .select('*')
            .eq('user_id', session.user.id)
            .single();
            
          if (data) {
            setBusinessName(data.business_name || '');
            setIndustry(data.industry || '');
            setBusinessDescription(data.business_description || '');
            setCountry(data.country || 'US');
            setCurrency(data.currency || 'USD');
            setMonthlyAdBudget(data.monthly_ad_budget || 1000);
            setUseMonthlyBudget(data.monthly_ad_budget != null);
            setTargetCpa(data.target_cpa || 30);
            setUseTargetCpa(data.target_cpa != null);
            setTargetRoas(data.target_roas || 3);
            setUseTargetRoas(data.target_roas != null);
            setBusinessStage(data.business_stage || 'NEW');
            setAdditionalContext(data.additional_context || '');
          }
        }
      } catch (err) {
        console.error('Failed to load business profile', err);
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { error } = await supabase
        .from('business_profiles')
        .upsert({
          user_id: session.user.id,
          business_name: businessName,
          industry,
          business_description: businessDescription,
          country: country || 'US',
          currency: currency || 'USD',
          monthly_ad_budget: useMonthlyBudget ? monthlyAdBudget : null,
          target_cpa: useTargetCpa ? targetCpa : null,
          target_roas: useTargetRoas ? targetRoas : null,
          business_stage: businessStage,
          additional_context: additionalContext,
        }, { onConflict: 'user_id' });

      if (error) throw error;
      
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      if (onSave) onSave();
    } catch (err) {
      console.error('Failed to save profile', err);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', color: '#9ca3af' }}>
        <Loader2 className="animate-spin" style={{ marginRight: '8px' }} />
        <span>Loading profile...</span>
      </div>
    );
  }

  return (
    <div style={{ padding: '28px', maxWidth: '800px' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f3f4f6' }}>Business Context Profile</h2>
        <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#9ca3af' }}>
          Providing this context allows the Agent to make country-specific, margin-aware reasoning rather than relying on generic if/else thresholds.
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* Core Identity */}
        <div className="glass-panel" style={{ padding: '24px', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#06b6d4', marginBottom: '8px' }}>
            <Briefcase style={{ width: '18px', height: '18px' }} />
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Core Identity</h3>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#d1d5db', marginBottom: '8px' }}>Business Name</label>
              <input type="text" required value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Glow Luxe Skincare" className="form-input" style={{ width: '100%', backgroundColor: '#111827', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', padding: '10px 14px', color: '#f3f4f6' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#d1d5db', marginBottom: '8px' }}>Industry</label>
              <input type="text" required value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. E-commerce / Health & Beauty" className="form-input" style={{ width: '100%', backgroundColor: '#111827', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', padding: '10px 14px', color: '#f3f4f6' }} />
            </div>
          </div>
          
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#d1d5db', marginBottom: '8px' }}>What do you sell? (USP & Audience)</label>
            <textarea required value={businessDescription} onChange={(e) => setBusinessDescription(e.target.value)} placeholder="Describe your products, prices, and who buys them..." style={{ width: '100%', backgroundColor: '#111827', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', padding: '10px 14px', color: '#f3f4f6', minHeight: '80px', resize: 'vertical' }} />
          </div>
        </div>

        {/* Market & Economics */}
        <div className="glass-panel" style={{ padding: '24px', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', marginBottom: '8px' }}>
            <MapPin style={{ width: '18px', height: '18px' }} />
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Market & Economics</h3>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#d1d5db', marginBottom: '8px' }}>Country (ISO)</label>
              <input type="text" required value={country} onChange={(e) => setCountry(e.target.value)} placeholder="US, UK, PK, etc." style={{ width: '100%', backgroundColor: '#111827', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', padding: '10px 14px', color: '#f3f4f6' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#d1d5db', marginBottom: '8px' }}>Currency</label>
              <input type="text" required value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD, GBP, PKR, etc." style={{ width: '100%', backgroundColor: '#111827', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', padding: '10px 14px', color: '#f3f4f6' }} />
            </div>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <input type="checkbox" checked={useTargetCpa} onChange={(e) => setUseTargetCpa(e.target.checked)} />
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#d1d5db' }}>Target CPA</label>
              </div>
              <input type="number" disabled={!useTargetCpa} required={useTargetCpa} value={targetCpa} onChange={(e) => setTargetCpa(Number(e.target.value))} style={{ width: '100%', backgroundColor: useTargetCpa ? '#111827' : '#374151', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', padding: '10px 14px', color: useTargetCpa ? '#f3f4f6' : '#9ca3af', opacity: useTargetCpa ? 1 : 0.5 }} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <input type="checkbox" checked={useTargetRoas} onChange={(e) => setUseTargetRoas(e.target.checked)} />
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#d1d5db' }}>Target ROAS</label>
              </div>
              <input type="number" step="0.1" disabled={!useTargetRoas} required={useTargetRoas} value={targetRoas} onChange={(e) => setTargetRoas(Number(e.target.value))} style={{ width: '100%', backgroundColor: useTargetRoas ? '#111827' : '#374151', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', padding: '10px 14px', color: useTargetRoas ? '#f3f4f6' : '#9ca3af', opacity: useTargetRoas ? 1 : 0.5 }} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <input type="checkbox" checked={useMonthlyBudget} onChange={(e) => setUseMonthlyBudget(e.target.checked)} />
                <label style={{ fontSize: '13px', fontWeight: 600, color: '#d1d5db' }}>Monthly Budget Cap</label>
              </div>
              <input type="number" disabled={!useMonthlyBudget} required={useMonthlyBudget} value={monthlyAdBudget} onChange={(e) => setMonthlyAdBudget(Number(e.target.value))} style={{ width: '100%', backgroundColor: useMonthlyBudget ? '#111827' : '#374151', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', padding: '10px 14px', color: useMonthlyBudget ? '#f3f4f6' : '#9ca3af', opacity: useMonthlyBudget ? 1 : 0.5 }} />
            </div>
          </div>
        </div>

        {/* Operational Context */}
        <div className="glass-panel" style={{ padding: '24px', borderRadius: '14px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#8b5cf6', marginBottom: '8px' }}>
            <Target style={{ width: '18px', height: '18px' }} />
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>Operational Context</h3>
          </div>
          
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#d1d5db', marginBottom: '8px' }}>Business Stage</label>
            <select value={businessStage} onChange={(e) => setBusinessStage(e.target.value)} style={{ width: '100%', backgroundColor: '#111827', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', padding: '10px 14px', color: '#f3f4f6' }}>
              <option value="NEW">Brand New (Focus on testing & learning)</option>
              <option value="ESTABLISHED">Established (Focus on optimizing & scaling existing)</option>
            </select>
          </div>
          
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#d1d5db', marginBottom: '8px' }}>Additional Rules or Context</label>
            <textarea value={additionalContext} onChange={(e) => setAdditionalContext(e.target.value)} placeholder="e.g. Do not spend over $50 on any single Ad Set..." style={{ width: '100%', backgroundColor: '#111827', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', padding: '10px 14px', color: '#f3f4f6', minHeight: '60px', resize: 'vertical' }} />
          </div>
        </div>

        <button
          type="submit"
          style={{
            backgroundColor: '#06b6d4',
            color: '#090d16',
            border: 'none',
            padding: '14px 20px',
            borderRadius: '10px',
            fontWeight: 700,
            fontSize: '15px',
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
          {saved ? <Check style={{ width: '18px', height: '18px' }} /> : <Save style={{ width: '18px', height: '18px' }} />}
          <span>{saved ? 'Profile Saved' : 'Save Business Profile'}</span>
        </button>
      </form>
    </div>
  );
};
