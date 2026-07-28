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
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error('Unauthorized')

    const { meta_access_token, meta_ad_account_id } = await req.json()
    if (!meta_access_token) throw new Error('Meta Access Token is required')
    if (!meta_ad_account_id) throw new Error('Meta Ad Account ID is required')

    // Clean up the Ad Account ID format (ensure it has the 'act_' prefix)
    let cleanId = meta_ad_account_id.trim()
    if (!cleanId.startsWith('act_')) {
      cleanId = `act_${cleanId}`
    }

    // Call Meta Graph API
    const metaUrl = `https://graph.facebook.com/v21.0/${cleanId}?fields=name,account_status,currency,timezone_name&access_token=${meta_access_token}`
    console.log(`Calling Meta API: GET https://graph.facebook.com/v21.0/${cleanId}...`)

    const response = await fetch(metaUrl)
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || 'Meta API returned an error')
    }

    // Translate account status code to human readable string
    // Statuses: 1 = ACTIVE, 2 = DISABLED, 3 = UNSETTLED, 7 = PENDING_RISK_REVIEW, etc.
    const statusMap: Record<number, string> = {
      1: 'ACTIVE',
      2: 'DISABLED',
      3: 'UNSETTLED',
      7: 'PENDING_RISK_REVIEW',
      9: 'IN_GRACE_PERIOD',
      100: 'PENDING_CLOSURE',
      101: 'CLOSED',
      201: 'RETRYABLE_BILLING_FAILURE',
      202: 'NEW_ACCOUNT_MONITOR'
    }

    const friendlyStatus = statusMap[data.account_status] || `UNKNOWN (${data.account_status})`

    return new Response(
      JSON.stringify({
        success: true,
        account_name: data.name,
        currency: data.currency,
        timezone: data.timezone_name,
        status: friendlyStatus,
        raw_status: data.account_status
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Meta connection test error:', error.message)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
