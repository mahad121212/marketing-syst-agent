import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' // Bypass RLS to read all and write to metrics_snapshots
    );

    const snapshots: any[] = [];

    // Fetch campaigns
    const { data: campaigns, error: campErr } = await supabaseClient.from('campaigns').select('*');
    if (!campErr && campaigns) {
      campaigns.forEach(c => {
        snapshots.push({
          target_id: c.id,
          target_level: 'campaign',
          metrics: c
        });
      });
    }

    // Fetch ad sets
    const { data: adSets, error: adSetErr } = await supabaseClient.from('ad_sets').select('*');
    if (!adSetErr && adSets) {
      adSets.forEach(a => {
        snapshots.push({
          target_id: a.id,
          target_level: 'ad_set',
          metrics: a
        });
      });
    }

    // Fetch ads
    const { data: ads, error: adsErr } = await supabaseClient.from('ads').select('*');
    if (!adsErr && ads) {
      ads.forEach(a => {
        snapshots.push({
          target_id: a.id,
          target_level: 'ad',
          metrics: a
        });
      });
    }

    // Insert all into metrics_snapshots
    if (snapshots.length > 0) {
      const { error: insertErr } = await supabaseClient
        .from('metrics_snapshots')
        .insert(snapshots);
        
      if (insertErr) throw insertErr;
    }

    return new Response(JSON.stringify({ success: true, processed: snapshots.length }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { 'Content-Type': 'application/json' },
      status: 500
    })
  }
})
