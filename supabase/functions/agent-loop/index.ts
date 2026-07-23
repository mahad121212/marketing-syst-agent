import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    // Get the session/user from the request's Authorization header
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser()

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      })
    }

    // Read the request body
    const { prompt } = await req.json()
    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Prompt is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // Fetch user settings securely from the database
    const { data: settings, error: settingsError } = await supabaseClient
      .from('user_settings')
      .select('openrouter_key, preferred_model')
      .eq('id', user.id)
      .single()

    if (settingsError || !settings?.openrouter_key) {
      return new Response(
        JSON.stringify({ error: 'OpenRouter API Key not found in user settings' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const openRouterKey = settings.openrouter_key
    const model = settings.preferred_model || 'google/gemini-3.6-flash'

    // Call OpenRouter API
    const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://metaagent.ai', // Optional but recommended by OpenRouter
        'X-Title': 'MetaAgent AI'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are an autonomous Meta Ads Agent. Analyze the user request and propose a campaign strategy.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    })

    if (!openRouterResponse.ok) {
      const errorText = await openRouterResponse.text()
      throw new Error(`OpenRouter Error: ${errorText}`)
    }

    const aiData = await openRouterResponse.json()
    const content = aiData.choices[0].message.content

    // Log this action to the agent_logs table
    await supabaseClient.from('agent_logs').insert({
      user_id: user.id,
      action: 'OODA_LOOP_CYCLE',
      details: { prompt, response: content, model }
    })

    return new Response(
      JSON.stringify({ response: content }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Edge Function Error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
