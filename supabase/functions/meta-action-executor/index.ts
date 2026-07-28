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

    // Authenticate the user
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')
    
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''))
    if (userError || !user) throw new Error('Unauthorized')

    // Parse the Action Card ID
    const { action_card_id } = await req.json()
    if (!action_card_id) throw new Error('action_card_id is required')

    // Fetch the Action Card
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

    const targetId = card.campaign_id // Note: database column holds the target UUID (campaign_id)
    if (!targetId) throw new Error('This action card does not have a target ID.')

    // Fetch user settings to get Meta credentials
    const { data: settings, error: settingsError } = await supabaseClient
      .from('user_settings')
      .select('meta_access_token, meta_ad_account_id')
      .eq('id', user.id)
      .single()

    if (settingsError || !settings?.meta_access_token || !settings?.meta_ad_account_id) {
      throw new Error('Meta credentials not configured. Please save them in Settings first.')
    }

    const token = settings.meta_access_token

    // Look up meta_id by searching campaigns, ad_sets, and ads
    let metaId = ''
    let level = '' // 'campaign', 'ad_set', or 'ad'

    // Check campaigns first
    const { data: campaign } = await supabaseClient
      .from('campaigns')
      .select('meta_id')
      .eq('id', targetId)
      .maybeSingle()

    if (campaign?.meta_id) {
      metaId = campaign.meta_id
      level = 'campaign'
    } else {
      // Check ad_sets
      const { data: adSet } = await supabaseClient
        .from('ad_sets')
        .select('meta_id')
        .eq('id', targetId)
        .maybeSingle()

      if (adSet?.meta_id) {
        metaId = adSet.meta_id
        level = 'ad_set'
      } else {
        // Check ads
        const { data: ad } = await supabaseClient
          .from('ads')
          .select('meta_id')
          .eq('id', targetId)
          .maybeSingle()

        if (ad?.meta_id) {
          metaId = ad.meta_id
          level = 'ad'
        }
      }
    }

    if (!metaId) {
      throw new Error('Target entity has no real Meta ID. It may be mock data.')
    }

    // Parse proposed changes to build Meta payload
    const proposedChanges = card.proposed_changes || {}
    const updateBody: any = { access_token: token }

    // Map actions
    const actionType = card.action_type.toUpperCase()
    if (actionType === 'PAUSE' || proposedChanges.status === 'PAUSED') {
      updateBody.status = 'PAUSED'
    } else if (actionType === 'RESUME' || proposedChanges.status === 'ACTIVE') {
      updateBody.status = 'ACTIVE'
    }

    const newBudget = proposedChanges.daily_budget || proposedChanges.budget || proposedChanges.new_budget
    if (newBudget) {
      updateBody.daily_budget = Math.round(parseFloat(newBudget) * 100)
    }

    console.log(`Executing Meta Action on ${level} (ID: ${metaId}):`, JSON.stringify(updateBody))

    // Send update request to Meta Graph API
    const metaUrl = `https://graph.facebook.com/v21.0/${metaId}`
    const response = await fetch(metaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateBody)
    })

    const data = await response.json()
    if (!response.ok) {
      throw new Error(`Meta API Write Error: ${data.error?.message || 'Unknown error'}`)
    }

    // Success! Update local database row status to reflect the new state
    const localTableMap: Record<string, string> = {
      'campaign': 'campaigns',
      'ad_set': 'ad_sets',
      'ad': 'ads'
    }
    const tableName = localTableMap[level]

    const dbPayload: any = {}
    if (updateBody.status) dbPayload.status = updateBody.status
    if (newBudget) dbPayload.daily_budget = parseFloat(newBudget)

    const { error: dbUpdateErr } = await supabaseClient
      .from(tableName)
      .update(dbPayload)
      .eq('id', targetId)

    if (dbUpdateErr) {
      console.warn(`Meta updated but failed to update local DB status:`, dbUpdateErr.message)
    }

    // Mark the Action Card as APPROVED / RESOLVED
    const { error: cardUpdateErr } = await supabaseClient
      .from('action_cards')
      .update({ status: 'APPROVED', resolved_at: new Date().toISOString() })
      .eq('id', action_card_id)

    if (cardUpdateErr) {
      console.warn(`Failed to mark action card as APPROVED:`, cardUpdateErr.message)
    }

    // Log the successful execution in agent memory
    await supabaseClient.from('agent_memory').insert({
      user_id: user.id,
      campaign_id: targetId,
      decision_made: `EXECUTED ACTION: ${actionType} on ${level.toUpperCase()}`,
      reasoning_snapshot: `Successfully executed action on Meta (ID: ${metaId}) and synchronized local database.`
    })

    return new Response(
      JSON.stringify({ success: true, meta_id: metaId, level }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Meta action executor error:', error.message)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
