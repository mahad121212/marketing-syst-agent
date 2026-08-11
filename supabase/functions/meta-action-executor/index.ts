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

    let targetId = card.campaign_id || card.proposed_changes?.campaign_id || card.proposed_changes?.target_id || null
    const actionType = card.action_type.toUpperCase()
    const proposedChanges = card.proposed_changes || {}

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

    // --- BATCH CAMPAIGN ACTIONS (e.g. Pause all campaigns) ---
    if (Array.isArray(proposedChanges.campaign_ids) && proposedChanges.campaign_ids.length > 0) {
      const targetStatus = (actionType.includes('PAUSE') || proposedChanges.status === 'PAUSED') ? 'PAUSED' : 'ACTIVE'
      const updatedIds: string[] = []

      for (const cMetaId of proposedChanges.campaign_ids) {
        try {
          const res = await fetch(`https://graph.facebook.com/v21.0/${cMetaId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: targetStatus, access_token: token })
          })
          if (res.ok) updatedIds.push(cMetaId)
        } catch (err) {
          console.warn(`Failed to update campaign ${cMetaId}:`, err)
        }
      }

      await supabaseClient.from('action_cards').update({ status: 'APPROVED', resolved_at: new Date().toISOString() }).eq('id', action_card_id)
      await supabaseClient.from('agent_memory').insert({
        user_id: user.id,
        campaign_id: null,
        decision_made: `EXECUTED BATCH ACTION: ${actionType} on ${updatedIds.length} campaigns`,
        reasoning_snapshot: `Updated status to ${targetStatus} for campaigns: ${updatedIds.join(', ')}`
      })

      return new Response(JSON.stringify({ 
        success: true, 
        meta_id: updatedIds.join(', '), 
        level: 'campaigns',
        note: `Updated ${updatedIds.length} campaigns to ${targetStatus} on Meta.`
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // --- CREATION ACTIONS ---

    if (actionType === 'CREATE_CAMPAIGN' || actionType === 'CREATE_CAMPAIGN_STRUCTURE') {
      const objMap: Record<string, string> = {
        'CONVERSIONS': 'OUTCOME_SALES',
        'SALES': 'OUTCOME_SALES',
        'TRAFFIC': 'OUTCOME_TRAFFIC',
        'REACH': 'OUTCOME_AWARENESS',
        'AWARENESS': 'OUTCOME_AWARENESS',
        'ENGAGEMENT': 'OUTCOME_ENGAGEMENT',
        'LEADS': 'OUTCOME_LEADS',
      }
      const mappedObjective = objMap[(proposedChanges.objective || 'CONVERSIONS').toUpperCase()] || 'OUTCOME_SALES'

      // Step 1: Create Campaign on Meta
      const metaUrl = `https://graph.facebook.com/v21.0/${cleanId}/campaigns`
      const budget = proposedChanges.daily_budget ? Math.round(parseFloat(proposedChanges.daily_budget) * 100) : 150000
      const campaignRes = await fetch(metaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: proposedChanges.name,
          objective: mappedObjective,
          status: 'PAUSED',
          special_ad_categories: [],
          daily_budget: budget,
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          access_token: token
        })
      })
      const campaignData = await campaignRes.json()
      if (!campaignRes.ok) throw new Error(`Meta Campaign Error: ${JSON.stringify(campaignData.error || campaignData)}`)

      const metaCampaignId = campaignData.id

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

      const results: any = { campaign: { meta_id: metaCampaignId, name: proposedChanges.name }, ad_sets: [] }

      // Step 2: Create Ad Sets (if any)
      const adSets = proposedChanges.ad_sets || []
      for (const adSetDef of adSets) {
        try {
          const targeting: any = { 
            geo_locations: { countries: ['PK'] }, 
            age_min: 18, 
            age_max: 65,
            targeting_automation: { advantage_audience: 0 } 
          }
          if (adSetDef.targeting) {
            if (adSetDef.targeting.locations) {
              const locs = Array.isArray(adSetDef.targeting.locations) ? adSetDef.targeting.locations : ['PK']
              targeting.geo_locations.countries = locs.map((l: string) => l.length === 2 ? l : 'PK')
            }
            if (adSetDef.targeting.age_range) {
              targeting.age_min = adSetDef.targeting.age_range.min || adSetDef.targeting.age_range[0] || 18
              targeting.age_max = adSetDef.targeting.age_range.max || adSetDef.targeting.age_range[1] || 65
            }
          }

          const adSetRes = await fetch(`https://graph.facebook.com/v21.0/${cleanId}/adsets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              campaign_id: metaCampaignId,
              name: adSetDef.name,
              status: 'PAUSED',
              billing_event: 'IMPRESSIONS',
              optimization_goal: 'LINK_CLICKS',
              targeting,
              access_token: token
            })
          })
          const adSetData = await adSetRes.json()
          if (!adSetRes.ok) {
            console.warn(`Ad Set creation failed: ${JSON.stringify(adSetData.error || adSetData)}`)
            results.ad_sets.push({ name: adSetDef.name, error: adSetData.error?.message || 'Failed' })
            continue
          }

          const metaAdSetId = adSetData.id

          await supabaseClient.from('ad_sets').insert({
            user_id: user.id,
            campaign_id: newCampaign.data.id,
            meta_id: metaAdSetId,
            name: adSetDef.name,
            targeting: adSetDef.targeting || {},
            status: 'PAUSED',
            performance_metrics: { spend: 0, impressions: 0, ctr: 0, cpc: 0 }
          })

          const adSetResult: any = { name: adSetDef.name, meta_id: metaAdSetId, ads: [] }

          // Step 3: Create Ads under this Ad Set (if any)
          const ads = adSetDef.ads || []
          for (const adDef of ads) {
            try {
              // Get Facebook Page
              const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`)
              const pagesData = await pagesRes.json()
              const pageId = pagesData.data?.[0]?.id
              if (!pageId) {
                adSetResult.ads.push({ name: adDef.name, error: 'No Facebook Page connected to this token' })
                continue
              }

              // Create Ad Creative
              const creativeRes = await fetch(`https://graph.facebook.com/v21.0/${cleanId}/adcreatives`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: `Creative for ${adDef.name}`,
                  object_story_spec: { page_id: pageId, link_data: { message: adDef.copy, link: 'https://metaagent.ai', name: adDef.name } },
                  access_token: token
                })
              })
              const creativeData = await creativeRes.json()
              if (!creativeRes.ok) {
                adSetResult.ads.push({ name: adDef.name, error: `Creative failed: ${creativeData.error?.message || 'Unknown'}` })
                continue
              }

              // Create Ad
              const adRes = await fetch(`https://graph.facebook.com/v21.0/${cleanId}/ads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adset_id: metaAdSetId, creative: { creative_id: creativeData.id }, name: adDef.name, status: 'PAUSED', access_token: token })
              })
              const adData = await adRes.json()
              if (!adRes.ok) {
                adSetResult.ads.push({ name: adDef.name, error: `Ad failed: ${adData.error?.message || 'Unknown'}` })
                continue
              }

              await supabaseClient.from('ads').insert({
                user_id: user.id,
                ad_set_id: metaAdSetId,
                meta_id: adData.id,
                name: adDef.name,
                creative_url: adDef.creative_url || '',
                copy: adDef.copy || '',
                cta: adDef.cta || 'SHOP_NOW',
                status: 'PAUSED',
                performance_metrics: { spend: 0, impressions: 0, ctr: 0, cpc: 0 }
              })

              adSetResult.ads.push({ name: adDef.name, meta_id: adData.id })
              await supabaseClient.from('execution_logs').insert({
                user_id: user.id,
                session_id: sessionId,
                action_card_id: actionCardId,
                level: 'INFO',
                message: `Successfully created Ad: ${adDef.name}`,
                details: { meta_id: adData.id }
              })
            } catch (adErr: any) {
              adSetResult.ads.push({ name: adDef.name, error: adErr.message })
              await supabaseClient.from('execution_logs').insert({
                user_id: user.id,
                session_id: sessionId,
                action_card_id: actionCardId,
                level: 'ERROR',
                message: `Failed to create Ad: ${adDef.name}`,
                details: { error: adErr.message }
              })
            }
          }

          results.ad_sets.push(adSetResult)
          await supabaseClient.from('execution_logs').insert({
            user_id: user.id,
            session_id: sessionId,
            action_card_id: actionCardId,
            level: 'INFO',
            message: `Successfully created Ad Set: ${adSetDef.name}`,
            details: { meta_id: metaAdSetId }
          })
        } catch (asErr: any) {
          results.ad_sets.push({ name: adSetDef.name, error: asErr.message })
          await supabaseClient.from('execution_logs').insert({
            user_id: user.id,
            session_id: sessionId,
            action_card_id: actionCardId,
            level: 'ERROR',
            message: `Failed to create Ad Set: ${adSetDef.name}`,
            details: { error: asErr.message }
          })
        }
      }

      await supabaseClient.from('execution_logs').insert({
        user_id: user.id,
        session_id: sessionId,
        action_card_id: actionCardId,
        level: 'SUCCESS',
        message: `Successfully created Campaign structure: ${proposedChanges.name}`,
        details: { meta_id: metaCampaignId }
      })

      // Update Agent Memory
      await supabaseClient.from('action_cards').update({ status: 'APPROVED', resolved_at: new Date().toISOString() }).eq('id', action_card_id)

      await supabaseClient.from('agent_memory').insert({
        user_id: user.id,
        campaign_id: newCampaign.data.id,
        decision_made: 'EXECUTED ACTION: CREATE_CAMPAIGN_STRUCTURE',
        reasoning_snapshot: `Created full structure on Meta: Campaign ${metaCampaignId}, ${results.ad_sets.length} ad sets, ${results.ad_sets.reduce((s: number, a: any) => s + (a.ads?.length || 0), 0)} ads`
      })

      return new Response(JSON.stringify({ success: true, meta_id: metaCampaignId, level: 'campaign_structure', results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (actionType === 'CREATE_AD_SET') {
      // Multi-strategy resolution: the agent may pass a UUID, Meta ID, campaign name, or action card ID
      const campRef = proposedChanges.campaign_id || targetId
      let parentMetaId = ''
      let parentLocalId = ''

      if (campRef) {
        // Strategy 1: Direct UUID lookup
        const { data: byId } = await supabaseClient.from('campaigns').select('id, meta_id').eq('id', campRef).maybeSingle()
        if (byId?.meta_id) {
          parentMetaId = byId.meta_id
          parentLocalId = byId.id
        }

        // Strategy 2: Meta ID lookup
        if (!parentMetaId) {
          const { data: byMetaId } = await supabaseClient.from('campaigns').select('id, meta_id').eq('meta_id', campRef).maybeSingle()
          if (byMetaId?.meta_id) {
            parentMetaId = byMetaId.meta_id
            parentLocalId = byMetaId.id
          }
        }

        // Strategy 3: Name lookup
        if (!parentMetaId) {
          const { data: byName } = await supabaseClient.from('campaigns').select('id, meta_id').ilike('name', campRef).maybeSingle()
          if (byName?.meta_id) {
            parentMetaId = byName.meta_id
            parentLocalId = byName.id
          }
        }
      }

      // Strategy 4: Find most recently created campaign for this user
      if (!parentMetaId) {
        const { data: recent } = await supabaseClient.from('campaigns').select('id, meta_id').eq('user_id', user.id).not('meta_id', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (recent?.meta_id) {
          parentMetaId = recent.meta_id
          parentLocalId = recent.id
        }
      }

      if (!parentMetaId) throw new Error('Parent campaign does not have a real Meta ID. Please approve the campaign Action Card first.')

      const metaUrl = `https://graph.facebook.com/v21.0/${cleanId}/adsets`
      const payload: any = {
        campaign_id: parentMetaId,
        name: proposedChanges.name,
        status: 'ACTIVE',
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LINK_CLICKS',
        targeting: { geo_locations: { countries: ['PK'] }, age_min: 18, age_max: 65 },
        access_token: token
      }
      if (proposedChanges.bid_amount) payload.bid_amount = Math.round(proposedChanges.bid_amount * 100)

      // Apply targeting from proposed_changes if provided
      if (proposedChanges.targeting) {
        if (proposedChanges.targeting.locations) {
          payload.targeting.geo_locations.countries = Array.isArray(proposedChanges.targeting.locations) ? proposedChanges.targeting.locations : ['PK']
        }
        if (proposedChanges.targeting.age_range) {
          payload.targeting.age_min = proposedChanges.targeting.age_range.min || proposedChanges.targeting.age_range[0] || 18
          payload.targeting.age_max = proposedChanges.targeting.age_range.max || proposedChanges.targeting.age_range[1] || 65
        }
      }

      const res = await fetch(metaUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const metaData = await res.json()
      if (!res.ok) throw new Error(`Meta API Error: ${JSON.stringify(metaData.error || metaData)}`)

      const metaAdSetId = metaData.id

      const newAdSet = await supabaseClient.from('ad_sets').insert({
        user_id: user.id,
        campaign_id: parentLocalId,
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
        campaign_id: parentLocalId,
        decision_made: 'EXECUTED ACTION: CREATE_AD_SET',
        reasoning_snapshot: `Created ad set on Meta (ID: ${metaAdSetId}) under campaign ${parentMetaId}`
      })

      return new Response(JSON.stringify({ success: true, meta_id: metaAdSetId, level: 'ad_set' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (actionType === 'CREATE_AD') {
      // Multi-strategy resolution: the agent may pass a UUID, Meta ID, or ad set name
      const adSetRef = proposedChanges.ad_set_id || targetId
      let parentAdSetMetaId = ''
      let parentAdSetLocalId = ''

      if (adSetRef) {
        // Strategy 1: Direct UUID lookup
        const { data: byId } = await supabaseClient.from('ad_sets').select('id, meta_id').eq('id', adSetRef).maybeSingle()
        if (byId?.meta_id) {
          parentAdSetMetaId = byId.meta_id
          parentAdSetLocalId = byId.id
        }

        // Strategy 2: Meta ID lookup
        if (!parentAdSetMetaId) {
          const { data: byMetaId } = await supabaseClient.from('ad_sets').select('id, meta_id').eq('meta_id', adSetRef).maybeSingle()
          if (byMetaId?.meta_id) {
            parentAdSetMetaId = byMetaId.meta_id
            parentAdSetLocalId = byMetaId.id
          }
        }

        // Strategy 3: Name lookup
        if (!parentAdSetMetaId) {
          const { data: byName } = await supabaseClient.from('ad_sets').select('id, meta_id').ilike('name', adSetRef).maybeSingle()
          if (byName?.meta_id) {
            parentAdSetMetaId = byName.meta_id
            parentAdSetLocalId = byName.id
          }
        }
      }

      // Strategy 4: Find most recently created ad set for this user
      if (!parentAdSetMetaId) {
        const { data: recent } = await supabaseClient.from('ad_sets').select('id, meta_id').eq('user_id', user.id).not('meta_id', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (recent?.meta_id) {
          parentAdSetMetaId = recent.meta_id
          parentAdSetLocalId = recent.id
        }
      }

      if (!parentAdSetMetaId) throw new Error('Parent ad set does not have a real Meta ID. Please approve the Ad Set Action Card first.')

      const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`)
      const pagesData = await pagesRes.json()
      const pageId = pagesData.data?.[0]?.id
      if (!pageId) throw new Error('No Facebook Page found connected to this token. A Facebook Page is required to create ads.')

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
        body: JSON.stringify({ adset_id: parentAdSetMetaId, creative: { creative_id: creativeId }, name: proposedChanges.name, status: 'ACTIVE', access_token: token })
      })
      const adData = await adRes.json()
      if (!adRes.ok) throw new Error(`Meta Ad Error: ${JSON.stringify(adData.error || adData)}`)
      const metaAdId = adData.id

      const newAd = await supabaseClient.from('ads').insert({
        user_id: user.id,
        ad_set_id: parentAdSetLocalId,
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
        campaign_id: parentAdSetLocalId,
        decision_made: 'EXECUTED ACTION: CREATE_AD',
        reasoning_snapshot: `Created ad on Meta (ID: ${metaAdId}) under ad set ${parentAdSetMetaId}`
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

    // Normalize action types — the agent may send PAUSE_CAMPAIGN, CHANGE_STATUS, UPDATE_BUDGET, RENAME, etc.
    const normalizedAction = actionType
      .replace(/_CAMPAIGN/g, '')
      .replace(/_AD_SET/g, '')
      .replace(/_AD$/g, '')
      .replace(/^CHANGE_/, '')
      .replace(/^UPDATE_/, '')

    // 1. Status changes (PAUSE, RESUME, ACTIVATE, STATUS with proposed_changes)
    if (normalizedAction === 'PAUSE' || proposedChanges.status === 'PAUSED') {
      updateBody.status = 'PAUSED'
      localDbPayload.status = 'PAUSED'
    } else if (normalizedAction === 'RESUME' || normalizedAction === 'ACTIVATE' || normalizedAction === 'STATUS' || proposedChanges.status === 'ACTIVE') {
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
    
    // Safely attempt to log the global error to execution_logs if we have the necessary IDs
    try {
      if (typeof actionCardId !== 'undefined' && typeof user !== 'undefined' && typeof sessionId !== 'undefined') {
        await supabaseClient.from('execution_logs').insert({
          user_id: user.id,
          session_id: sessionId,
          action_card_id: actionCardId,
          level: 'ERROR',
          message: `Execution failed: ${error.message}`,
          details: { error: error.message }
        })
      }
    } catch (logErr) {
      console.error('Failed to write to execution_logs in catch block:', logErr)
    }

    // Return a 200 status with success: false so the frontend can display the actual error
    return new Response(JSON.stringify({ success: false, error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
  }
})
