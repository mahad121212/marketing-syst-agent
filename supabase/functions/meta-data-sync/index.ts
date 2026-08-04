import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MetaInsight {
  spend?: string;
  impressions?: string;
  inline_link_clicks?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  actions?: Array<{ action_type: string; value: string }>;
  purchase_roas?: Array<{ action_type: string; value: string }>;
}

function parseInsights(insightsList: MetaInsight[] | undefined) {
  const defaultMetrics = {
    spend: 0,
    impressions: 0,
    clicks: 0,
    ctr: 0,
    cpc: 0,
    cpm: 0,
    conversions: 0,
    cpa: 0,
    roas: 0
  }

  if (!insightsList || insightsList.length === 0) {
    return defaultMetrics
  }

  const insight = insightsList[0]
  const spend = parseFloat(insight.spend || '0')
  const impressions = parseInt(insight.impressions || '0', 10)
  const clicks = parseInt(insight.inline_link_clicks || insight.clicks || '0', 10)
  const ctr = parseFloat(insight.ctr || '0')
  const cpc = parseFloat(insight.cpc || '0')
  const cpm = parseFloat(insight.cpm || '0')

  // Find conversions (look for purchase first, then lead, fallback to sum of actions)
  let conversions = 0
  if (insight.actions) {
    const purchaseAction = insight.actions.find(a => a.action_type === 'purchase' || a.action_type === 'offsite_conversion.fb_pixel_purchase')
    const leadAction = insight.actions.find(a => a.action_type === 'lead' || a.action_type === 'offsite_conversion.fb_pixel_lead')
    
    if (purchaseAction) {
      conversions = parseInt(purchaseAction.value || '0', 10)
    } else if (leadAction) {
      conversions = parseInt(leadAction.value || '0', 10)
    } else {
      // Sum all offsite conversion values or landing page views
      conversions = insight.actions
        .filter(a => a.action_type.startsWith('offsite_conversion') || a.action_type === 'landing_page_view')
        .reduce((sum, a) => sum + parseInt(a.value || '0', 10), 0)
    }
  }

  const cpa = conversions > 0 ? parseFloat((spend / conversions).toFixed(2)) : 0

  // ROAS
  let roas = 0
  if (insight.purchase_roas) {
    const purchaseRoas = insight.purchase_roas.find(r => r.action_type === 'purchase' || r.action_type === 'offsite_conversion.fb_pixel_purchase')
    if (purchaseRoas) {
      roas = parseFloat(purchaseRoas.value || '0')
    }
  }

  return {
    spend,
    impressions,
    clicks,
    ctr,
    cpc,
    cpm,
    conversions,
    cpa,
    roas
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Authenticate the caller (User JWT or Service Role)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')

    const tokenPart = authHeader.replace('Bearer ', '')
    const isServiceRole = tokenPart === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    let userId = ''
    
    if (isServiceRole) {
      let body: any = {}
      try {
        body = await req.json()
      } catch (e) {
        // body might be empty or already read, fallback to query param or header
      }
      userId = body.user_id
      if (!userId) {
        // Fallback: check query parameter
        const urlObj = new URL(req.url)
        userId = urlObj.searchParams.get('user_id') || ''
      }
      if (!userId) throw new Error('user_id is required when invoking with Service Role Key')
    } else {
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser(tokenPart)
      if (userError || !user) throw new Error('Unauthorized')
      userId = user.id
    }

    // Fetch user settings to get Meta credentials
    const { data: settings, error: settingsError } = await supabaseClient
      .from('user_settings')
      .select('meta_access_token, meta_ad_account_id')
      .eq('id', userId)
      .single()

    if (settingsError || !settings?.meta_access_token || !settings?.meta_ad_account_id) {
      throw new Error('Meta credentials not configured. Please save them in Settings first.')
    }

    const token = settings.meta_access_token
    let adAccountId = settings.meta_ad_account_id.trim()
    if (!adAccountId.startsWith('act_')) {
      adAccountId = `act_${adAccountId}`
    }

    console.log(`Starting Meta sync for user ${userId} and ad account ${adAccountId}...`)

    // 1. Fetch campaigns from Meta
    const filteringParam = encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] }]))
    const campaignsUrl = `https://graph.facebook.com/v21.0/${adAccountId}/campaigns?fields=id,name,status,effective_status,daily_budget,objective,insights{spend,impressions,inline_link_clicks,actions,purchase_roas}&filtering=${filteringParam}&limit=100&access_token=${token}`
    const campaignsRes = await fetch(campaignsUrl)
    const campaignsData = await campaignsRes.json()
    if (!campaignsRes.ok) throw new Error(`Meta Campaigns API Error: ${campaignsData.error?.message}`)

    const metaCampaigns = (campaignsData.data || []).filter((c: any) => c.effective_status !== 'DELETED' && c.effective_status !== 'ARCHIVED')
    console.log(`Pulled ${metaCampaigns.length} active/paused campaigns from Meta.`)

    // 2. Fetch ad sets from Meta
    const adSetsUrl = `https://graph.facebook.com/v21.0/${adAccountId}/adsets?fields=id,campaign_id,name,status,targeting,insights{spend,impressions,inline_link_clicks,actions,purchase_roas}&limit=150&access_token=${token}`
    const adSetsRes = await fetch(adSetsUrl)
    const adSetsData = await adSetsRes.json()
    if (!adSetsRes.ok) throw new Error(`Meta Ad Sets API Error: ${adSetsData.error?.message}`)

    const metaAdSets = adSetsData.data || []
    console.log(`Pulled ${metaAdSets.length} ad sets from Meta.`)

    // 3. Fetch ads from Meta
    const adsUrl = `https://graph.facebook.com/v21.0/${adAccountId}/ads?fields=id,adset_id,name,status,creative{image_url,body,title,call_to_action_type},insights{spend,impressions,inline_link_clicks,actions,purchase_roas}&limit=300&access_token=${token}`
    const adsRes = await fetch(adsUrl)
    const adsData = await adsRes.json()
    if (!adsRes.ok) throw new Error(`Meta Ads API Error: ${adsData.error?.message}`)

    const metaAds = adsData.data || []
    console.log(`Pulled ${metaAds.length} ads from Meta.`)

    // ==========================================
    // UPSERT CAMPAIGNS
    // ==========================================
    const campaignIdMap = new Map<string, string>() // meta_id -> local_uuid

    for (const mc of metaCampaigns) {
      const metrics = parseInsights(mc.insights?.data)
      
      const { data, error } = await supabaseClient
        .from('campaigns')
        .upsert({
          user_id: userId,
          meta_id: mc.id,
          name: mc.name,
          status: mc.status,
          daily_budget: mc.daily_budget ? parseFloat(mc.daily_budget) / 100 : 0, // Meta returns daily_budget in cents/micro-currency for some, let's normalize or use raw
          targeting: { objective: mc.objective },
          performance_metrics: metrics
        }, { onConflict: 'meta_id' })
        .select('id')
        .single()

      if (error) {
        console.error(`Failed to upsert campaign ${mc.id}:`, error.message)
        continue
      }
      campaignIdMap.set(mc.id, data.id)
    }

    // ==========================================
    // UPSERT AD SETS
    // ==========================================
    const adSetIdMap = new Map<string, string>() // meta_id -> local_uuid

    for (const ms of metaAdSets) {
      const localCampaignId = campaignIdMap.get(ms.campaign_id)
      if (!localCampaignId) {
        console.warn(`Skipping ad set ${ms.id} because parent campaign ${ms.campaign_id} was not synced.`)
        continue
      }

      const metrics = parseInsights(ms.insights?.data)

      const { data, error } = await supabaseClient
        .from('ad_sets')
        .upsert({
          user_id: userId,
          campaign_id: localCampaignId,
          meta_id: ms.id,
          name: ms.name,
          status: ms.status,
          targeting: ms.targeting || {},
          performance_metrics: metrics
        }, { onConflict: 'meta_id' })
        .select('id')
        .single()

      if (error) {
        console.error(`Failed to upsert ad set ${ms.id}:`, error.message)
        continue
      }
      adSetIdMap.set(ms.id, data.id)
    }

    // ==========================================
    // UPSERT ADS
    // ==========================================
    for (const ma of metaAds) {
      const localAdSetId = adSetIdMap.get(ma.adset_id)
      if (!localAdSetId) {
        console.warn(`Skipping ad ${ma.id} because parent ad set ${ma.adset_id} was not synced.`)
        continue
      }

      const metrics = parseInsights(ma.insights?.data)
      const creative = ma.creative || {}
      
      const { error } = await supabaseClient
        .from('ads')
        .upsert({
          user_id: userId,
          ad_set_id: localAdSetId,
          meta_id: ma.id,
          name: ma.name,
          status: ma.status,
          creative_url: creative.image_url || '',
          copy: creative.body || '',
          cta: creative.call_to_action_type || 'LEARN_MORE',
          performance_metrics: metrics
        }, { onConflict: 'meta_id' })

      if (error) {
        console.error(`Failed to upsert ad ${ma.id}:`, error.message)
      }
    }

    // ==========================================
    // CAPTURE STATE SNAPSHOTS FOR HISTORY
    // ==========================================
    // We can run a snapshot log for every campaign synced to build the history graph
    const { data: currentCampaigns } = await supabaseClient
      .from('campaigns')
      .select('id, performance_metrics')
      .eq('user_id', userId)
      .not('meta_id', 'is', null)

    for (const camp of (currentCampaigns || [])) {
      await supabaseClient
        .from('metrics_snapshots')
        .insert({
          target_id: camp.id,
          target_level: 'campaign',
          metrics: camp.performance_metrics
        })
    }

    console.log(`Sync completed successfully.`)

    return new Response(
      JSON.stringify({
        success: true,
        campaigns_synced: metaCampaigns.length,
        ad_sets_synced: metaAdSets.length,
        ads_synced: metaAds.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Meta sync error:', error.message)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
