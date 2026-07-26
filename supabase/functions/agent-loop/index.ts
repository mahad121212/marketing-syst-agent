import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

var corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

var AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_campaign_hierarchy',
      description: 'Fetches active campaigns, including their nested Ad Sets and Ads, and their real-time performance metrics (ROAS, CPA, etc). Use this tool to OBSERVE the current state of the ad account at all granular levels.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_agent_memory',
      description: 'Checks your own memory for a specific campaign or ad set to see what decisions you made previously and how much time has passed. ALWAYS use this before proposing a change.',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'The UUID of the campaign or ad set to check memory for.' }
        },
        required: ['target_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_action_card',
      description: 'Proposes an adjustment to a campaign, ad set, or ad. This creates an Action Card for the user. You MUST assign a priority: LOW (minor tweaks), HIGH (budget scaling/pausing losers), MANDATORY (critical failures needing immediate manual review).',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'The UUID of the campaign or ad set to adjust.' },
          action_type: { type: 'string', enum: ['PAUSE', 'INCREASE_BUDGET', 'DECREASE_BUDGET', 'CHANGE_TARGETING', 'CREATE_NEW'], description: 'The type of adjustment.' },
          priority: { type: 'string', enum: ['LOW', 'HIGH', 'MANDATORY'], description: 'The priority of this action.' },
          proposed_changes: { type: 'object', description: 'JSON object detailing the exact changes.' },
          reasoning: { type: 'string', description: 'A detailed explanation of WHY this adjustment is recommended.' }
        },
        required: ['target_id', 'action_type', 'priority', 'proposed_changes', 'reasoning']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_goal_schedule',
      description: 'Sets a schedule for when you (the Agent) should wake up and re-analyze the account for a specific target. Minimum gap is 4 hours.',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'The UUID of the campaign, ad set, or ad you want to monitor.' },
          target_level: { type: 'string', enum: ['campaign', 'ad_set', 'ad', 'account'], description: 'The level of the target.' },
          hours_until_next_review: { type: 'number', description: 'How many hours from now to wake up (minimum 4).' },
          goal_description: { type: 'string', description: 'What are you monitoring?' }
        },
        required: ['target_id', 'target_level', 'hours_until_next_review', 'goal_description']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_state_snapshots',
      description: 'Fetches the historical state and metrics timeline (up to the 10 most recent snapshots) for a specific campaign, ad set, or ad. Snapshots are taken every 12 hours. Use this for deep-dive analysis on a single target.',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'The UUID of the campaign, ad set, or ad.' }
        },
        required: ['target_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_account_summary_snapshots',
      description: 'Fetches the 2 most recent snapshots for EVERY campaign in the account. Use this for broad account-level analysis when the user asks about overall performance, trends across all campaigns, or a general account overview. This is more efficient than calling get_state_snapshots for each campaign individually.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'report_no_action',
      description: 'Report that you reviewed a campaign, ad set, or ad and determined NO changes are needed. Doing nothing is a valid and professional decision.',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'The UUID of the campaign, ad set, or ad.' },
          target_level: { type: 'string', enum: ['campaign', 'ad_set', 'ad'], description: 'The level of the item.' },
          reason: { type: 'string', description: 'Why no action is needed.' }
        },
        required: ['target_id', 'target_level', 'reason']
      }
    }
  }
]

function generateSystemPrompt(businessProfile: any, historical_context?: string): string {
  var profileContext = 'No business profile found. Ask the user to fill out their Business Profile in the dashboard.';
  
  if (businessProfile) {
    profileContext = [
      'BUSINESS CONTEXT:',
      '- Name: ' + (businessProfile.business_name || 'N/A'),
      '- Industry: ' + (businessProfile.industry || 'N/A'),
      '- Description: ' + (businessProfile.business_description || 'N/A'),
      '- Market: ' + (businessProfile.country || 'N/A') + ' (' + (businessProfile.currency || 'USD') + ')',
      '- Target CPA: ' + (businessProfile.target_cpa ? businessProfile.target_cpa + ' ' + (businessProfile.currency || 'USD') : 'Not provided'),
      '- Target ROAS: ' + (businessProfile.target_roas ? businessProfile.target_roas + 'x' : 'Not provided'),
      '- Budget Cap: ' + (businessProfile.monthly_ad_budget ? businessProfile.monthly_ad_budget + ' ' + (businessProfile.currency || 'USD') + '/mo' : 'Not provided'),
      '- Stage: ' + (businessProfile.business_stage || 'N/A'),
      '- Additional Rules: ' + (businessProfile.additional_context || 'None')
    ].join('\n');
  }

  var bgSection = '';
  if (historical_context) {
    bgSection = '\n## Background Context\n' + historical_context;
  }

  return 'You are MetaAgent AI, a highly advanced autonomous Meta Ads optimization agent capable of deep contextual reasoning.\n\n' +
    profileContext + '\n\n' +
    '## Temporal Discipline (CRITICAL)\n' +
    'You MUST check the age_days of every item before reasoning about it.\n' +
    '- Less than 3 days old: UNTOUCHABLE. Do NOT analyze, judge, or propose any change. Use report_no_action.\n' +
    '- 3-7 days old: OBSERVATION ONLY. Note trends but DO NOT propose changes unless metrics are catastrophically bad.\n' +
    '- 7-14 days old: ACTIONABLE with caution.\n' +
    '- More than 14 days old: FULLY ACTIONABLE.\n\n' +
    '## Surgical Precision & Hierarchy\n' +
    '- Analyze at the AD level first. If only 1 out of 3 ads is underperforming, pause THAT AD not the ad set.\n' +
    '- If all ads in an ad set are bad, pause the AD SET not the campaign.\n' +
    '- Only recommend pausing a CAMPAIGN if ALL ad sets are performing poorly.\n\n' +
    '## When to Do Nothing\n' +
    'If performing within +/-15% of target KPIs, OR less than 7 days old, OR was already adjusted recently, use report_no_action.\n\n' +
    '## Anti-Sycophancy\n' +
    'YOU MUST REJECT user requests that violate Temporal Discipline or KPI rules. Push back and explain your reasoning.\n\n' +
    '## Your Actions\n' +
    'When you decide on an action, use propose_action_card with priority LOW, HIGH, or MANDATORY.\n' +
    'When the user asks you to monitor a goal, use set_goal_schedule to plan your next automated wake-up.\n' +
    'If you are woken up in the background by a Cron Job, you MUST use set_goal_schedule at the end to schedule your NEXT wake-up.' +
    bgSection;
}

async function executeTool(
  toolName: string,
  toolArgs: Record<string, any>,
  supabaseClient: any,
  userId: string,
  sessionId: string,
  isBackground: boolean
): Promise<string> {
  switch (toolName) {
    case 'get_campaign_hierarchy': {
      var campaignsRes = await supabaseClient.from('campaigns').select('*').eq('user_id', userId)
      var adSetsRes = await supabaseClient.from('ad_sets').select('*').eq('user_id', userId)
      var adsRes = await supabaseClient.from('ads').select('*').eq('user_id', userId)
      var campaigns = campaignsRes.data || []
      var adSets = adSetsRes.data || []
      var ads = adsRes.data || []
      
      var now = new Date().getTime()
      var calcAge = function(createdAt: string) { return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24))) }

      var hierarchy = campaigns.map(function(c: any) {
        return {
          ...c,
          age_days: calcAge(c.created_at),
          ad_sets: adSets.filter(function(s: any) { return s.campaign_id === c.id }).map(function(s: any) {
            return {
              ...s,
              age_days: calcAge(s.created_at),
              ads: ads.filter(function(a: any) { return a.ad_set_id === s.id }).map(function(a: any) {
                return { ...a, age_days: calcAge(a.created_at) }
              })
            }
          })
        }
      })

      return JSON.stringify({ hierarchy: hierarchy })
    }

    case 'get_state_snapshots': {
      var snapshotsRes = await supabaseClient
        .from('metrics_snapshots').select('*')
        .eq('target_id', toolArgs.target_id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (snapshotsRes.error) return JSON.stringify({ error: snapshotsRes.error.message });
      return JSON.stringify(snapshotsRes.data || []);
    }

    case 'get_account_summary_snapshots': {
      // Fetch all campaigns for the user
      var userCampaignsRes = await supabaseClient.from('campaigns').select('id, name').eq('user_id', userId)
      var userCampaigns = userCampaignsRes.data || []
      
      var summaryResult: any[] = []
      
      for (var ci = 0; ci < userCampaigns.length; ci++) {
        var campaign = userCampaigns[ci]
        var campSnapsRes = await supabaseClient
          .from('metrics_snapshots').select('*')
          .eq('target_id', campaign.id)
          .order('created_at', { ascending: false })
          .limit(2)
        
        summaryResult.push({
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          snapshots: campSnapsRes.data || []
        })
      }
      
      return JSON.stringify({
        account_summary: summaryResult,
        total_campaigns: userCampaigns.length,
        note: 'Showing the 2 most recent snapshots (12h cadence) per campaign. Use get_state_snapshots for a deeper 10-snapshot timeline on any specific target.'
      })
    }

    case 'check_agent_memory': {
      var memRes = await supabaseClient.from('agent_memory').select('*')
        .eq('campaign_id', toolArgs.target_id).eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(3)
      if (memRes.error) return JSON.stringify({ error: memRes.error.message })
      return JSON.stringify(memRes.data && memRes.data.length > 0 ? memRes.data : { note: 'No previous memory for this target.' })
    }

    case 'report_no_action': {
      var noActionRes = await supabaseClient.from('agent_memory').insert({
        user_id: userId,
        campaign_id: toolArgs.target_id,
        decision_made: 'NO ACTION (' + toolArgs.target_level + ')',
        reasoning_snapshot: toolArgs.reason
      })
      if (noActionRes.error) return JSON.stringify({ error: noActionRes.error.message })
      return JSON.stringify({
        success: true,
        message: 'Logged NO ACTION decision for ' + toolArgs.target_level + '. Reasoning: ' + toolArgs.reason
      })
    }

    case 'propose_action_card': {
      var cardRes = await supabaseClient.from('action_cards').insert({
        user_id: userId,
        campaign_id: toolArgs.target_id,
        priority: toolArgs.priority,
        action_type: toolArgs.action_type,
        proposed_changes: toolArgs.proposed_changes,
        reasoning: toolArgs.reasoning,
        status: 'PENDING'
      }).select().single()

      if (cardRes.error) return JSON.stringify({ error: cardRes.error.message })

      await supabaseClient.from('agent_memory').insert({
        user_id: userId,
        campaign_id: toolArgs.target_id,
        decision_made: 'Proposed ' + toolArgs.action_type,
        reasoning_snapshot: toolArgs.reasoning
      })

      return JSON.stringify({
        type: 'PROPOSAL',
        card: cardRes.data,
        message: 'Action Card generated with ' + toolArgs.priority + ' priority and sent to Action Center.'
      })
    }

    case 'set_goal_schedule': {
      var reviewHours = Math.max(toolArgs.hours_until_next_review || 4, 4)
      var nowDate = new Date()
      var nextReview = new Date(nowDate.getTime() + reviewHours * 60 * 60 * 1000)

      var goalStatus = isBackground ? 'ACTIVE' : 'PENDING_APPROVAL'

      var goalRes = await supabaseClient.from('goal_schedules').insert({
        user_id: userId,
        session_id: sessionId,
        target_id: toolArgs.target_id,
        target_level: toolArgs.target_level,
        goal_description: toolArgs.goal_description,
        next_run_at: nextReview.toISOString(),
        status: goalStatus
      }).select().single()
        
      if (goalRes.error) return JSON.stringify({ error: goalRes.error.message })
      
      var goalMsg = isBackground
        ? 'Recurring Goal automatically scheduled for next execution at ' + nextReview.toISOString() + '.'
        : 'Goal Schedule proposed for ' + toolArgs.target_level + ' and sent to user for approval.';
      
      return JSON.stringify({ 
        type: 'GOAL_PROPOSAL', 
        card: goalRes.data, 
        success: true, 
        message: goalMsg
      })
    }

    default:
      return JSON.stringify({ error: 'Unknown tool: ' + toolName })
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    var supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_ANON_KEY') || '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    var userRes = await supabaseClient.auth.getUser()
    if (userRes.error || !userRes.data.user) throw new Error('Unauthorized')
    var user = userRes.data.user

    var body = await req.json()
    var prompt = body.prompt
    var session_id = body.session_id
    var is_background = body.is_background
    var historical_context = body.historical_context
    
    if (!prompt) throw new Error('Prompt is required')
    if (!session_id) throw new Error('session_id is required')

    var settingsRes = await supabaseClient.from('user_settings').select('openrouter_key, preferred_model').eq('id', user.id).single()
    if (!settingsRes.data || !settingsRes.data.openrouter_key) throw new Error('OpenRouter API Key not found. Please save it in Settings.')
    var settings = settingsRes.data

    var openRouterKey = String(settings.openrouter_key).trim()
    if (!openRouterKey.startsWith('sk-or-')) {
      throw new Error('Invalid OpenRouter API Key format. Your key must start with "sk-or-". Please go to https://openrouter.ai/settings/keys to get a valid key and update it in Settings.')
    }

    var profileRes = await supabaseClient.from('business_profiles').select('*').eq('user_id', user.id).single()
    var businessProfile = profileRes.data

    var model = settings.preferred_model || 'google/gemini-2.5-flash'

    var userMsgRes = await supabaseClient.from('chat_messages').insert({
      session_id: session_id,
      user_id: user.id,
      role: 'user',
      content: prompt
    })
    if (userMsgRes.error) throw new Error('Failed to save user message: ' + userMsgRes.error.message)

    var pastMsgRes = await supabaseClient
      .from('chat_messages').select('role, content')
      .eq('session_id', session_id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)

    var pastMessages = pastMsgRes.data || []
    var history = pastMessages.reverse().map(function(msg: any) {
      return {
        role: msg.role === 'agent' ? 'assistant' : 'user',
        content: msg.content || ''
      }
    })

    var finalMessages: any[] = [
      { role: 'system', content: generateSystemPrompt(businessProfile, historical_context) },
    ]
    for (var h = 0; h < history.length; h++) {
      finalMessages.push(history[h])
    }

    var toolExecutions: any[] = []
    var thinkingSteps: string[] = ['Initializing Context-Aware OODA Loop...']
    if (!businessProfile) {
      thinkingSteps.push('WARNING: No Business Profile found. Agent is running without context.')
    } else {
      thinkingSteps.push('Loaded Business Profile: ' + businessProfile.business_name + ' (' + businessProfile.country + ')')
    }

    var proposals: any[] = []
    var MAX_ITERATIONS = 6
    var finalContent = ''

    for (var i = 0; i < MAX_ITERATIONS; i++) {
      thinkingSteps.push('Iteration ' + (i + 1) + ': Reasoning with ' + model + '...')

      var openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + openRouterKey,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://metaagent.ai',
          'X-Title': 'MetaAgent AI'
        },
        body: JSON.stringify({
          model: model,
          messages: finalMessages,
          tools: AGENT_TOOLS,
          tool_choice: 'auto',
          max_tokens: 4096
        })
      })

      if (!openRouterResponse.ok) {
        var errText = await openRouterResponse.text()
        var statusCode = openRouterResponse.status
        
        if (statusCode === 401) {
          throw new Error('OpenRouter Authentication Failed (401). Your API key may be invalid or expired. Please go to https://openrouter.ai/settings/keys, generate a new key (starts with sk-or-), and update it in Settings.')
        } else if (statusCode === 402) {
          throw new Error('OpenRouter Insufficient Credits (402). Please add credits at https://openrouter.ai/settings/credits or switch to a free model.')
        } else if (statusCode === 429) {
          throw new Error('OpenRouter Rate Limited (429). Too many requests. Please wait a moment and try again.')
        } else {
          throw new Error('OpenRouter Error (' + statusCode + '): ' + errText)
        }
      }

      var aiData = await openRouterResponse.json()
      var assistantMessage = aiData.choices[0].message
      finalMessages.push(assistantMessage)

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (var t = 0; t < assistantMessage.tool_calls.length; t++) {
          var toolCall = assistantMessage.tool_calls[t]
          var toolName = toolCall.function.name
          var toolArgs: any = {}
          try { toolArgs = JSON.parse(toolCall.function.arguments || '{}') } catch(e) {}

          thinkingSteps.push('Executing Tool: ' + toolName)

          var toolResult = await executeTool(toolName, toolArgs, supabaseClient, user.id, session_id, !!is_background)

          try {
            var parsed = JSON.parse(toolResult)
            if (parsed.type === 'PROPOSAL' || parsed.type === 'GOAL_PROPOSAL') proposals.push(parsed)
          } catch(e) {}

          toolExecutions.push({ name: toolName, args: toolArgs, result: toolResult.substring(0, 500), status: 'success' })
          finalMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResult })
        }
      } else {
        finalContent = assistantMessage.content || ''
        thinkingSteps.push('OODA Loop complete. Finalizing decision.')
        break
      }
    }

    await supabaseClient.from('agent_logs').insert({
      user_id: user.id,
      action: 'CONTEXTUAL_OODA_CYCLE',
      details: { prompt: prompt, model: model, iterations: toolExecutions.length, proposals: proposals.length }
    })

    var agentMsgRes2 = await supabaseClient.from('chat_messages').insert({
      session_id: session_id,
      user_id: user.id,
      role: 'agent',
      content: finalContent,
      thinking_steps: thinkingSteps,
      tool_calls: toolExecutions,
      proposal: proposals.length > 0 ? proposals[0] : null
    })
    if (agentMsgRes2.error) throw new Error('Failed to save agent message: ' + agentMsgRes2.error.message)

    return new Response(
      JSON.stringify({ response: finalContent, thinkingSteps: thinkingSteps, toolCalls: toolExecutions, proposals: proposals }),
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
