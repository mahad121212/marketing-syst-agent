import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================
// TOOL DEFINITIONS — These are the actions the Agent can take
// ============================================================
const AGENT_TOOLS = [
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
      description: 'Proposes an adjustment to a campaign, ad set, or ad. This creates an Action Card in the user\'s Action Center. Use this to DECIDE and ACT. You MUST assign a priority: LOW (minor tweaks), HIGH (budget scaling/pausing losers), MANDATORY (critical failures needing immediate manual review).',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'The UUID of the campaign or ad set to adjust.' },
          action_type: { type: 'string', enum: ['PAUSE', 'INCREASE_BUDGET', 'DECREASE_BUDGET', 'CHANGE_TARGETING', 'CREATE_NEW'], description: 'The type of adjustment.' },
          priority: { type: 'string', enum: ['LOW', 'HIGH', 'MANDATORY'], description: 'The priority of this action.' },
          proposed_changes: { type: 'object', description: 'JSON object detailing the exact changes (e.g. {"new_budget": 150}).' },
          reasoning: { type: 'string', description: 'A detailed explanation of WHY this adjustment is recommended based on the data, business context, and time elapsed.' }
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
          goal_description: { type: 'string', description: 'What are you monitoring? e.g., "Maintain CPA under $30 for Campaign X".' },
          current_metrics_snapshot: { type: 'object', description: 'JSON object summarizing the current performance metrics of the target. This provides historical context for your next wake-up.' }
        },
        required: ['target_id', 'target_level', 'hours_until_next_review', 'goal_description', 'current_metrics_snapshot']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'report_no_action',
      description: 'Report that you reviewed a campaign, ad set, or ad and determined NO changes are needed. Use this to record your assessment. Doing nothing is a valid and professional decision if metrics are healthy or items are too young.',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'The UUID of the campaign, ad set, or ad.' },
          target_level: { type: 'string', enum: ['campaign', 'ad_set', 'ad'], description: 'The level of the item.' },
          reason: { type: 'string', description: 'Why no action is needed (e.g., "Performing well, ROAS is 4.2", "Too young, only 2 days old").' }
        },
        required: ['target_id', 'target_level', 'reason']
      }
    }
  }
]

// ============================================================
// SYSTEM PROMPT GENERATOR
// ============================================================
function generateSystemPrompt(businessProfile: any, historical_context?: string) {
  let profileContext = 'No business profile found. Ask the user to fill out their Business Profile in the dashboard.';
  
  if (businessProfile) {
    profileContext = `
BUSINESS CONTEXT:
- Name: ${businessProfile.business_name}
- Industry: ${businessProfile.industry}
- Description: ${businessProfile.business_description}
- Market: ${businessProfile.country} (${businessProfile.currency})
- Target CPA: ${businessProfile.target_cpa} ${businessProfile.currency}
- Target ROAS: ${businessProfile.target_roas}x
- Budget Cap: ${businessProfile.monthly_ad_budget} ${businessProfile.currency}/mo
- Stage: ${businessProfile.business_stage}
- Additional Rules: ${businessProfile.additional_context || 'None'}
`;
  }

  return `You are MetaAgent AI, a highly advanced autonomous Meta Ads optimization agent capable of deep contextual reasoning.

${profileContext}

## Temporal Discipline (CRITICAL)
You MUST check the \`age_days\` of every item before reasoning about it.
- **< 3 days old**: UNTOUCHABLE. Do NOT analyze, judge, or propose any change. Meta's learning phase needs at minimum 72 hours. Use \`report_no_action\`.
- **3-7 days old**: OBSERVATION ONLY. Note trends but DO NOT propose changes unless metrics are catastrophically bad (e.g., 5x above target CPA).
- **7-14 days old**: ACTIONABLE with caution. You have enough data to make informed decisions.
- **> 14 days old**: FULLY ACTIONABLE. You have mature data to make confident scaling or pruning decisions.

## Surgical Precision & Hierarchy
- Analyze at the AD level first. If only 1 out of 3 ads in an ad set is underperforming, pause THAT AD — not the ad set.
- If all ads in an ad set are bad, pause the AD SET — not the campaign.
- Only recommend pausing a CAMPAIGN if ALL ad sets are performing poorly.

## When to Do Nothing
If a campaign, ad set, or ad is:
- Performing within ±15% of target KPIs, OR
- Less than 7 days old (with normal metrics), OR
- Was already adjusted by you recently

Then use \`report_no_action\`. This is the CORRECT and PROFESSIONAL response. Doing nothing IS a decision.

## Strict Rule Enforcement (Anti-Sycophancy)
Users will often ask you to "increase budget on everything" or "delete all ads" out of panic or greed.
YOU MUST REJECT THESE REQUESTS if they violate your Temporal Discipline or KPI rules.
- If a user asks to increase budget on a 2-day old campaign, YOU MUST REFUSE and explain that it is in the learning phase.
- If a user asks to pause an ad that is beating its CPA target, YOU MUST REFUSE and explain why it is a bad idea.
- You are a professional media buyer, not a yes-man. Do NOT blindly follow user instructions if they destroy account performance. Push back and explain your reasoning. You must still evaluate every item strictly according to its \`age_days\` and \`performance_metrics\`.

## Your Actions
When you decide on an action, use \`propose_action_card\`.
- Priority LOW: Minor targeting tweaks or copy changes.
- Priority HIGH: Budget increases for winners, pausing clear losers.
- Priority MANDATORY: Critical account failures, massive budget changes, or things that definitively require human eyes.

When the user asks you to monitor or maintain a goal, use \`set_goal_schedule\` to plan your next automated wake-up.
If you are woken up in the background by a Cron Job, you MUST use \`set_goal_schedule\` at the end of your evaluation to schedule your NEXT wake-up to keep the recurring loop alive.

## Background Context
${historical_context ? `BACKGROUND WAKE-UP: You have been woken up to monitor a recurring goal.
Historical Context when goal was set: ${historical_context}
Compare current metrics to this historical context to make decisions.` : ''}
`
}

// ============================================================
// TOOL EXECUTION
// ============================================================
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
      const { data: campaigns } = await supabaseClient.from('campaigns').select('*').eq('user_id', userId)
      const { data: adSets } = await supabaseClient.from('ad_sets').select('*').eq('user_id', userId)
      const { data: ads } = await supabaseClient.from('ads').select('*').eq('user_id', userId)
      
      const now = new Date().getTime()
      const calcAge = (createdAt: string) => Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)))

      // Build nested hierarchy
      const hierarchy = campaigns?.map((c: any) => ({
        ...c,
        age_days: calcAge(c.created_at),
        ad_sets: adSets?.filter((s: any) => s.campaign_id === c.id).map((s: any) => ({
          ...s,
          age_days: calcAge(s.created_at),
          ads: ads?.filter((a: any) => a.ad_set_id === s.id).map((a: any) => ({
            ...a,
            age_days: calcAge(a.created_at)
          }))
        }))
      }))

      return JSON.stringify({ hierarchy })
    }

    case 'check_agent_memory': {
      const { data, error } = await supabaseClient
        .from('agent_memory')
        .select('*')
        .eq('campaign_id', toolArgs.target_id)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(3)
      if (error) return JSON.stringify({ error: error.message })
      return JSON.stringify(data && data.length > 0 ? data : { note: "No previous memory for this target." })
    }

    case 'report_no_action': {
      const { data, error } = await supabaseClient
        .from('agent_memory')
        .insert({
          user_id: userId,
          campaign_id: toolArgs.target_id,
          decision_made: `NO ACTION (${toolArgs.target_level})`,
          reasoning_snapshot: toolArgs.reason
        })
        .select()
        .single()

      if (error) return JSON.stringify({ error: error.message })
      return JSON.stringify({
        success: true,
        message: `Logged NO ACTION decision for ${toolArgs.target_level}. Reasoning: ${toolArgs.reason}`
      })
    }

    case 'propose_action_card': {
      const { data, error } = await supabaseClient
        .from('action_cards')
        .insert({
          user_id: userId,
          campaign_id: toolArgs.target_id,
          priority: toolArgs.priority,
          action_type: toolArgs.action_type,
          proposed_changes: toolArgs.proposed_changes,
          reasoning: toolArgs.reasoning,
          status: 'PENDING'
        })
        .select()
        .single()

      if (error) return JSON.stringify({ error: error.message })

      // Also record this in agent memory
      await supabaseClient.from('agent_memory').insert({
        user_id: userId,
        campaign_id: toolArgs.target_id,
        decision_made: `Proposed ${toolArgs.action_type}`,
        reasoning_snapshot: toolArgs.reasoning
      })

      return JSON.stringify({
        type: 'PROPOSAL',
        card: data,
        message: `Action Card generated with ${toolArgs.priority} priority and sent to Action Center.`
      })
    }

    case 'set_goal_schedule': {
      const reviewHours = Math.max(toolArgs.hours_until_next_review || 4, 4)
      const now = new Date()
      const nextReview = new Date(now.getTime() + reviewHours * 60 * 60 * 1000)

      // If background, auto-approve the recurrence. If not, it needs user approval.
      const status = isBackground ? 'ACTIVE' : 'PENDING_APPROVAL'

      const { data, error } = await supabaseClient
        .from('goal_schedules')
        .insert({
          user_id: userId,
          session_id: sessionId,
          target_id: toolArgs.target_id,
          target_level: toolArgs.target_level,
          goal_description: toolArgs.goal_description,
          metrics_snapshot: toolArgs.current_metrics_snapshot,
          next_run_at: nextReview.toISOString(),
          status: status
        })
        .select()
        .single()
        
      if (error) return JSON.stringify({ error: error.message })
      
      return JSON.stringify({ 
        type: 'GOAL_PROPOSAL', 
        card: data, 
        success: true, 
        message: isBackground ? `Recurring Goal automatically scheduled for next execution at ${nextReview.toISOString()}.` : `Goal Schedule proposed for ${toolArgs.target_level} and sent to user for approval.`
      })
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` })
  }
}

// ============================================================
// MAIN HANDLER
// ============================================================
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

    const { prompt, session_id, is_background, historical_context } = await req.json()
    if (!prompt) throw new Error('Prompt is required')
    if (!session_id) throw new Error('session_id is required')

    // Fetch API Key
    const { data: settings } = await supabaseClient.from('user_settings').select('openrouter_key, preferred_model').eq('id', user.id).single()
    if (!settings?.openrouter_key) throw new Error('OpenRouter API Key not found. Please save it in Settings.')

    // Fetch Business Profile for Context
    const { data: businessProfile } = await supabaseClient.from('business_profiles').select('*').eq('user_id', user.id).single()

    const openRouterKey = settings.openrouter_key
    const model = settings.preferred_model || 'google/gemini-3.6-flash'

    // 1. Save the incoming user prompt
    const { error: userMsgErr } = await supabaseClient.from('chat_messages').insert({
      session_id,
      user_id: user.id,
      role: 'user',
      content: prompt
    })
    if (userMsgErr) throw new Error(`Failed to save user message: ${userMsgErr.message}`)

    // 2. Fetch past chat history for this session (last 10 messages)
    const { data: pastMessages } = await supabaseClient
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', session_id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)

    const history = (pastMessages || []).reverse().map(msg => ({
      role: msg.role === 'agent' ? 'assistant' : 'user',
      content: msg.content || ''
    }))

    // Build the conversation array: system prompt + chat history
    const finalMessages: any[] = [
      { role: 'system', content: generateSystemPrompt(businessProfile, historical_context) },
      ...history
    ]

    const toolExecutions: any[] = []
    const thinkingSteps: string[] = ['Initializing Context-Aware OODA Loop...']
    if (!businessProfile) thinkingSteps.push('WARNING: No Business Profile found. Agent is running without context.')
    else thinkingSteps.push(`Loaded Business Profile: ${businessProfile.business_name} (${businessProfile.country})`)

    let proposals: any[] = []
    const MAX_ITERATIONS = 6
    let finalContent = ''

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      thinkingSteps.push(`Iteration ${i + 1}: Reasoning with ${model}...`)

      const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://metaagent.ai',
          'X-Title': 'MetaAgent AI'
        },
        body: JSON.stringify({
          model: model,
          messages: finalMessages,
          tools: AGENT_TOOLS,
          tool_choice: 'auto'
        })
      })

      if (!openRouterResponse.ok) throw new Error(`OpenRouter Error: ${await openRouterResponse.text()}`)

      const aiData = await openRouterResponse.json()
      const assistantMessage = aiData.choices[0].message
      finalMessages.push(assistantMessage)

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name
          let toolArgs = {}
          try { toolArgs = JSON.parse(toolCall.function.arguments || '{}') } catch {}

          thinkingSteps.push(`Executing Tool: ${toolName}`)

          const toolResult = await executeTool(toolName, toolArgs, supabaseClient, user.id, session_id, !!is_background)

          try {
            const parsed = JSON.parse(toolResult)
            if (parsed.type === 'PROPOSAL' || parsed.type === 'GOAL_PROPOSAL') proposals.push(parsed)
          } catch {}

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
      details: { prompt, model, iterations: toolExecutions.length, proposals: proposals.length }
    })

    // 3. Save the final agent response to history
    const { error: agentMsgErr } = await supabaseClient.from('chat_messages').insert({
      session_id,
      user_id: user.id,
      role: 'agent',
      content: finalContent,
      thinking_steps: thinkingSteps,
      tool_calls: toolExecutions,
      proposal: proposals.length > 0 ? proposals[0] : null
    })
    if (agentMsgErr) throw new Error(`Failed to save agent message: ${agentMsgErr.message}`)

    return new Response(
      JSON.stringify({ response: finalContent, thinkingSteps, toolCalls: toolExecutions, proposals }),
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
