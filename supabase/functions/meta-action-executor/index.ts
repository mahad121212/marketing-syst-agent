import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')
    
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''))
    if (userError || !user) throw new Error('Unauthorized')

    const { action_card_id } = await req.json()
    if (!action_card_id) throw new Error('action_card_id is required')

    const { data: card, error: cardError } = await supabaseClient
      .from('action_cards')
      .select('*')
      .eq('id', action_card_id)
      .eq('user_id', user.id)
      .single()

    if (cardError || !card) throw new Error('Action Card not found')
    if (card.status === 'APPROVED' || card.status === 'AUTO_EXECUTED') {
      throw new Error('This action has already been executed.')
    }

    const targetId = card.campaign_id
    const actionType = card.action_type.toUpperCase()
    
    // Creation actions don't need a targetId — they create new entities
    const CREATION_ACTIONS = ['CREATE_CAMPAIGN', 'CREATE_AD_SET', 'CREATE_AD']
    if (!targetId && !CREATION_ACTIONS.includes(actionType)) {
      throw new Error('This action card does not have a target ID. The agent may not have linked it to a campaign/ad set/ad.')
    }

    const { data: settings, error: settingsError } = await supabaseClient
      .from('user_settings')
      .select('meta_access_token, meta_ad_account_id')
      .eq('id', user.id)
      .single()

    if (settingsError || !settings?.meta_access_token || !settings?.meta_ad_account_id) {
      throw new Error('Meta credentials not configured. Please save them in Settings first.')
    }

    const token = settings.meta_access_token
    let cleanId = settings.meta_ad_account_id.trim()
    if (!cleanId.startsWith('act_')) {
      cleanId = `act_${cleanId}`
    }

    const proposedChanges = card.proposed_changes || {}

    // --- CREATION ACTIONS ---

    if (actionType === 'CREATE_CAMPAIGN') {
      const objMap: Record<string, string> = {
        'CONVERSIONS': 'OUTCOME_SALES',
        'SALES': 'OUTCOME_SALES',
        'LEADS': 'OUTCOME_LEADS',
        'TRAFFIC': 'OUTCOME_TRAFFIC',
        'AWARENESS': 'OUTCOME_AWARENESS',
        'REACH': 'OUTCOME_AWARENESS',
        'ENGAGEMENT': 'OUTCOME_ENGAGEMENT'
      }
      const mappedObjective = objMap[(proposedChanges.objective || 'CONVERSIONS').toUpperCase()] || 'OUTCOME_SALES'
      const budgetInCents = Math.round((proposedChanges.daily_budget || 50) * 100)

      const metaUrl = `https://graph.facebook.com/v21.0/${cleanId}/campaigns`
      const res = await fetch(metaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: proposedChanges.name,
          objective: mappedObjective,
          status: 'PAUSED',
          daily_budget: budgetInCents,
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          special_ad_categories: ['NONE'],
          access_token: token
        })
      })

      const metaData = await res.json()
      if (!res.ok) throw new Error(`Meta API Error: ${JSON.stringify(metaData.error || metaData)}`)

      const metaCampaignId = metaData.id

      const newCampaign = await supabaseClient.from('campaigns').insert({
        user_id: user.id,
        meta_id: metaCampaignId,
        name: proposedChanges.name,
        status: 'PAUSED',
        daily_budget: proposedChanges.daily_budget,
        targeting: proposedChanges.targeting || {},
        performance_metrics: { spend: 0, impressions: 0, ctr: 0, cpc: 0, objective: mappedObjective }
      }).select().single()

      if (newCampaign.error) throw new Error(newCampaign.error.message)

      await supabaseClient.from('action_cards').update({ status: 'APPROVED', resolved_at: new Date().toISOString() }).eq('id', action_card_id)

      await supabaseClient.from('agent_memory').insert({
        user_id: user.id,
        campaign_id: newCampaign.data.id,
        decision_made: 'EXECUTED ACTION: CREATE_CAMPAIGN',
        reasoning_snapshot: `Created campaign on Meta (ID: ${metaCampaignId})`
      })

      return new Response(JSON.stringify({ success: true, meta_id: metaCampaignId, level: 'campaign' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (actionType === 'CREATE_AD_SET') {
      const { data: campaign } = await supabaseClient.from('campaigns').select('meta_id').eq('id', proposedChanges.campaign_id).single()
      if (!campaign?.meta_id) throw new Error('Parent campaign does not have a real Meta ID.')

      const metaUrl = `https://graph.facebook.com/v21.0/${cleanId}/adsets`
      const payload: any = {
        campaign_id: campaign.meta_id,
        name: proposedChanges.name,
        status: 'ACTIVE',
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LINK_CLICKS',
        targeting: { geo_locations: { countries: ['PK'] }, age_min: 18, age_max: 65 },
        access_token: token
      }
      if (proposedChanges.bid_amount) payload.bid_amount = Math.round(proposedChanges.bid_amount * 100)

      const res = await fetch(metaUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const metaData = await res.json()
      if (!res.ok) throw new Error(`Meta API Error: ${JSON.stringify(metaData.error || metaData)}`)

      const metaAdSetId = metaData.id

      const newAdSet = await supabaseClient.from('ad_sets').insert({
        user_id: user.id,
        campaign_id: proposedChanges.campaign_id,
        meta_id: metaAdSetId,
        name: proposedChanges.name,
        targeting: proposedChanges.targeting || {},
        status: 'ACTIVE',
        performance_metrics: { spend: 0, impressions: 0, ctr: 0, cpc: 0 }
      }).select().single()

      if (newAdSet.error) throw new Error(newAdSet.error.message)

      await supabaseClient.from('action_cards').update({ status: 'APPROVED', resolved_at: new Date().toISOString() }).eq('id', action_card_id)

      await supabaseClient.from('agent_memory').insert({
        user_id: user.id,
        campaign_id: proposedChanges.campaign_id,
        decision_made: 'EXECUTED ACTION: CREATE_AD_SET',
        reasoning_snapshot: `Created ad set on Meta (ID: ${metaAdSetId})`
      })

      return new Response(JSON.stringify({ success: true, meta_id: metaAdSetId, level: 'ad_set' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (actionType === 'CREATE_AD') {
      const { data: adSet } = await supabaseClient.from('ad_sets').select('meta_id').eq('id', proposedChanges.ad_set_id).single()
      if (!adSet?.meta_id) throw new Error('Parent ad set does not have a real Meta ID.')

      const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`)
      const pagesData = await pagesRes.json()
      const pageId = pagesData.data?.[0]?.id
      if (!pageId) throw new Error('No Facebook Page found connected to this token.')

      const creativeRes = await fetch(`https://graph.facebook.com/v21.0/${cleanId}/adcreatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Creative for ${proposedChanges.name}`,
          object_story_spec: { page_id: pageId, link_data: { message: proposedChanges.copy, link: 'https://metaagent.ai', name: proposedChanges.name } },
          access_token: token
        })
      })
      const creativeData = await creativeRes.json()
      if (!creativeRes.ok) throw new Error(`Meta Ad Creative Error: ${JSON.stringify(creativeData.error || creativeData)}`)
      const creativeId = creativeData.id

      const adRes = await fetch(`https://graph.facebook.com/v21.0/${cleanId}/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adset_id: adSet.meta_id, creative: { creative_id: creativeId }, name: proposedChanges.name, status: 'ACTIVE', access_token: token })
      })
      const adData = await adRes.json()
      if (!adRes.ok) throw new Error(`Meta Ad Error: ${JSON.stringify(adData.error || adData)}`)
      const metaAdId = adData.id

      const newAd = await supabaseClient.from('ads').insert({
        user_id: user.id,
        ad_set_id: proposedChanges.ad_set_id,
        meta_id: metaAdId,
        name: proposedChanges.name,
        creative_url: proposedChanges.creative_url || '',
        copy: proposedChanges.copy || '',
        cta: proposedChanges.cta || 'SHOP_NOW',
        status: 'ACTIVE',
        performance_metrics: { spend: 0, impressions: 0, ctr: 0, cpc: 0 }
      }).select().single()

      if (newAd.error) throw new Error(newAd.error.message)

      await supabaseClient.from('action_cards').update({ status: 'APPROVED', resolved_at: new Date().toISOString() }).eq('id', action_card_id)

      await supabaseClient.from('agent_memory').insert({
        user_id: user.id,
        campaign_id: proposedChanges.ad_set_id, // ad set id for tracking reference
        decision_made: 'EXECUTED ACTION: CREATE_AD',
        reasoning_snapshot: `Created ad on Meta (ID: ${metaAdId})`
      })

      return new Response(JSON.stringify({ success: true, meta_id: metaAdId, level: 'ad' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // --- MODIFICATION ACTIONS (from propose_action_card) ---
    // The agent uses propose_action_card with freeform action_types like:
    //   PAUSE_CAMPAIGN, RESUME_CAMPAIGN, INCREASE_BUDGET, DECREASE_BUDGET,
    //   RENAME, CREATE_NEW, UPDATE_TARGETING, PAUSE_AD_SET, PAUSE_AD, etc.
    // We normalize these to figure out WHAT to do and WHICH level to target.

    let metaId = ''
    let level = ''

    // Multi-strategy Meta ID resolution:
    // Strategy 1: Is targetId directly a numeric Meta ID? (e.g. "52586793602259")
    if (targetId && /^\d+$/.test(targetId)) {
      metaId = targetId
      level = 'campaign'
    }

    // Strategy 2: Look up by UUID or meta_id across campaigns, ad_sets, ads tables
    if (!metaId && targetId) {
      try {
        const { data: campaign } = await supabaseClient.from('campaigns').select('id, meta_id, name').or(`id.eq.${targetId},meta_id.eq.${targetId}`).maybeSingle()
        if (campaign?.meta_id) {
          metaId = campaign.meta_id
          level = 'campaign'
        } else {
          const { data: adSet } = await supabaseClient.from('ad_sets').select('id, meta_id, name').or(`id.eq.${targetId},meta_id.eq.${targetId}`).maybeSingle()
          if (adSet?.meta_id) {
            metaId = adSet.meta_id
            level = 'ad_set'
          } else {
            const { data: ad } = await supabaseClient.from('ads').select('id, meta_id, name').or(`id.eq.${targetId},meta_id.eq.${targetId}`).maybeSingle()
            if (ad?.meta_id) {
              metaId = ad.meta_id
              level = 'ad'
            }
          }
        }
      } catch (_e) {
        // In case targetId is not a valid UUID format for PostgreSQL id column
      }
    }

    // Strategy 3: Check if targetId was an action_card ID
    if (!metaId && targetId) {
      try {
        const { data: targetCard } = await supabaseClient.from('action_cards').select('proposed_changes').eq('id', targetId).maybeSingle()
        if (targetCard?.proposed_changes?.name) {
          const cardName = targetCard.proposed_changes.name
          const { data: matchedCamp } = await supabaseClient.from('campaigns').select('meta_id').ilike('name', cardName).maybeSingle()
          if (matchedCamp?.meta_id) {
            metaId = matchedCamp.meta_id
            level = 'campaign'
          }
        }
      } catch (_e) {}
    }

    // Strategy 4: Look up by old_name or name in local campaigns table
    const searchName = proposedChanges.old_name || proposedChanges.name
    if (!metaId && searchName) {
      const { data: campByName } = await supabaseClient.from('campaigns').select('meta_id').ilike('name', searchName).maybeSingle()
      if (campByName?.meta_id) {
        metaId = campByName.meta_id
        level = 'campaign'
      }
    }

    // Strategy 5: Query Meta Graph API directly to find matching campaign by name or ID
    if (!metaId && (searchName || targetId)) {
      try {
        const metaFindUrl = `https://graph.facebook.com/v21.0/${cleanId}/campaigns?fields=id,name&access_token=${token}`
        const metaFindRes = await fetch(metaFindUrl)
        if (metaFindRes.ok) {
          const metaFindData = await metaFindRes.json()
          const list = metaFindData.data || []
          const found = list.find((c: any) => 
            (searchName && c.name?.toLowerCase().includes(searchName.toLowerCase())) ||
            (targetId && c.id === targetId)
          )
          if (found?.id) {
            metaId = found.id
            level = 'campaign'
          }
        }
      } catch (err) {
        console.warn('Failed to query Meta for matching campaign:', err)
      }
    }

    // Build the update payload from proposed_changes
    const updateBody: any = { access_token: token }
    const localDbPayload: any = {}

    // Normalize action types — the agent may send PAUSE_CAMPAIGN, PAUSE_AD_SET, PAUSE, etc.
    const normalizedAction = actionType
      .replace(/_CAMPAIGN/g, '')
      .replace(/_AD_SET/g, '')
      .replace(/_AD$/g, '')

    // 1. Status changes (PAUSE, RESUME, ACTIVATE)
    if (normalizedAction === 'PAUSE' || proposedChanges.status === 'PAUSED') {
      updateBody.status = 'PAUSED'
      localDbPayload.status = 'PAUSED'
    } else if (normalizedAction === 'RESUME' || normalizedAction === 'ACTIVATE' || proposedChanges.status === 'ACTIVE') {
      updateBody.status = 'ACTIVE'
      localDbPayload.status = 'ACTIVE'
    }

    // 2. Name changes (RENAME, CREATE_NEW, or any action with new_name)
    const newName = proposedChanges.new_name || proposedChanges.name
    if (newName) {
      updateBody.name = newName
      localDbPayload.name = newName
    }

    // 3. Budget changes — the agent may use various field names
    const newBudget = proposedChanges.daily_budget || proposedChanges.budget || proposedChanges.new_budget || proposedChanges.new_daily_budget
    if (newBudget) {
      updateBody.daily_budget = Math.round(parseFloat(newBudget) * 100)
      localDbPayload.daily_budget = parseFloat(newBudget)
    }

    // If we found a real Meta ID, push the update to Meta
    if (metaId && Object.keys(updateBody).length > 1) {
      console.log(`Executing Meta Action on ${level} (ID: ${metaId}):`, JSON.stringify(updateBody))

      const metaUrl = `https://graph.facebook.com/v21.0/${metaId}`
      const response = await fetch(metaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody)
      })

      const data = await response.json()
      if (!response.ok) throw new Error(`Meta API Write Error: ${data.error?.message || 'Unknown error'}`)

      // Sync local DB
      if (targetId && Object.keys(localDbPayload).length > 0) {
        const localTableMap: Record<string, string> = { 'campaign': 'campaigns', 'ad_set': 'ad_sets', 'ad': 'ads' }
        const tableName = localTableMap[level]
        if (tableName) {
          const { error: dbUpdateErr } = await supabaseClient.from(tableName).update(localDbPayload).eq('id', targetId)
          if (dbUpdateErr) console.warn(`Meta updated but failed to update local DB:`, dbUpdateErr.message)
        }
      }

      await supabaseClient.from('action_cards').update({ status: 'APPROVED', resolved_at: new Date().toISOString() }).eq('id', action_card_id)

      await supabaseClient.from('agent_memory').insert({
        user_id: user.id,
        campaign_id: targetId,
        decision_made: `EXECUTED ACTION: ${actionType} on ${level.toUpperCase()}`,
        reasoning_snapshot: `Successfully executed action on Meta (ID: ${metaId}) and synchronized local database.`
      })

      return new Response(JSON.stringify({ success: true, meta_id: metaId, level }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // If we have local-only changes (no Meta ID, or action doesn't map to Meta API),
    // still sync locally and mark card as approved
    if (targetId && Object.keys(localDbPayload).length > 0) {
      // Try to update local DB even without Meta
      for (const table of ['campaigns', 'ad_sets', 'ads']) {
        const { error } = await supabaseClient.from(table).update(localDbPayload).eq('id', targetId)
        if (!error) {
          level = table === 'campaigns' ? 'campaign' : table === 'ad_sets' ? 'ad_set' : 'ad'
          break
        }
      }
    }

    // Always mark the card as approved since the user explicitly approved it
    await supabaseClient.from('action_cards').update({ status: 'APPROVED', resolved_at: new Date().toISOString() }).eq('id', action_card_id)

    await supabaseClient.from('agent_memory').insert({
      user_id: user.id,
      campaign_id: targetId,
      decision_made: `EXECUTED ACTION: ${actionType}`,
      reasoning_snapshot: metaId 
        ? `Action executed on Meta (ID: ${metaId}) but had no changes to push.`
        : `Action "${actionType}" approved. ${Object.keys(localDbPayload).length > 0 ? 'Local database updated.' : 'No direct Meta API update was possible (entity may not be synced with Meta yet).'} Card marked as approved.`
    })

    return new Response(JSON.stringify({ 
      success: true, 
      meta_id: metaId || null, 
      level: level || 'unknown',
      note: metaId ? 'Action completed.' : `Action "${actionType}" approved and logged. The target entity may not be synced with Meta yet.`
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error: any) {
    console.error('Meta action executor error:', error.message)
    return new Response(JSON.stringify({ success: false, error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 })
  }
})
