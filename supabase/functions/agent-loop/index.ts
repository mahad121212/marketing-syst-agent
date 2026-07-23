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
      description: 'Sets a schedule for when you (the Agent) should wake up and re-analyze the account. Use this when the user asks you to monitor or maintain a goal. Minimum gap is 4 hours. Goal cannot be modified before 18 hours unless explicitly requested.',
      parameters: {
        type: 'object',
        properties: {
          hours_until_next_review: { type: 'number', description: 'How many hours from now to wake up (minimum 4).' },
          lock_goal_hours: { type: 'number', description: 'How many hours to lock this goal from being overridden (default 18).' },
          goal_description: { type: 'string', description: 'What are you monitoring? e.g., "Maintain CPA under $30 for Campaign X".' }
        },
        required: ['hours_until_next_review', 'lock_goal_hours', 'goal_description']
      }
    }
  }
]

// ============================================================
// SYSTEM PROMPT GENERATOR
// ============================================================
function generateSystemPrompt(businessProfile: any) {
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

## Your Reasoning Framework
Do NOT use rigid if/else rules. You must reason conceptually:
1. **Business Context**: A $50 CPA is terrible for a $20 product but excellent for a $500 product. Respect the Target CPA and ROAS above.
2. **Market Context**: You are operating in ${businessProfile?.country || 'an unknown country'} using ${businessProfile?.currency || 'USD'}. Adjust your expectations for CPMs and Clicks accordingly.
3. **Temporal Context**: Never judge a campaign that is too young. Meta requires time to exit the learning phase.
4. **Hierarchy**: Analyze at the Ad Set and Ad levels. Don't pause an entire campaign if only one Ad Set is dragging it down.
5. **Memory**: ALWAYS use the \`check_agent_memory\` tool before taking action to ensure you aren't repeating a decision you made 2 hours ago.

## Your Actions
When you decide on an action, use \`propose_action_card\`.
- Priority LOW: Minor targeting tweaks or copy changes.
- Priority HIGH: Budget increases for winners, pausing clear losers.
- Priority MANDATORY: Critical account failures, massive budget changes, or things that definitively require human eyes.

When the user gives you a long-term directive (e.g. "keep cost low"), use \`set_goal_schedule\` to plan your next automated wake-up.`
}

// ============================================================
// TOOL EXECUTION
// ============================================================
async function executeTool(
  toolName: string,
  toolArgs: Record<string, any>,
  supabaseClient: any,
  userId: string
): Promise<string> {
  switch (toolName) {
    case 'get_campaign_hierarchy': {
      // In a real app, this would do a JOIN. For now, we query the tables we have.
      const { data: campaigns } = await supabaseClient.from('campaigns').select('*').eq('user_id', userId)
      const { data: adSets } = await supabaseClient.from('ad_sets').select('*').eq('user_id', userId)
      const { data: ads } = await supabaseClient.from('ads').select('*').eq('user_id', userId)
      
      return JSON.stringify({ campaigns, adSets, ads })
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
      return JSON.stringify(data.length > 0 ? data : { note: "No previous memory for this target." })
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
      const lockHours = Math.max(toolArgs.lock_goal_hours || 18, 18)
      const reviewHours = Math.max(toolArgs.hours_until_next_review || 4, 4)
      
      const now = new Date()
      const nextReview = new Date(now.getTime() + reviewHours * 60 * 60 * 1000)
      const lockedUntil = new Date(now.getTime() + lockHours * 60 * 60 * 1000)

      const { data, error } = await supabaseClient
        .from('agent_memory')
        .insert({
          user_id: userId,
          decision_made: `Goal Scheduled: ${toolArgs.goal_description}`,
          next_review_at: nextReview.toISOString(),
          goal_locked_until: lockedUntil.toISOString()
        })
        .select()
        .single()
        
      if (error) return JSON.stringify({ error: error.message })
      return JSON.stringify({ success: true, next_review: nextReview, locked_until: lockedUntil })
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

    const { prompt, session_id } = await req.json()
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
    await supabaseClient.from('chat_messages').insert({
      session_id,
      user_id: user.id,
      role: 'user',
      content: prompt
    })

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

    // Build the initial conversation with history
    const messages: any[] = [
      { role: 'system', content: generateSystemPrompt(businessProfile) },
      ...history,
      { role: 'user', content: prompt } // the latest prompt is already in history, but we can append it directly if we exclude it from history, or we just rely on history.
    ]
    // Since we just inserted the user prompt, it will be in `history`. 
    // Wait, let's just use `...history` which includes the prompt.
    // Let's refine the messages array:
    const finalMessages = [
      { role: 'system', content: generateSystemPrompt(businessProfile) },
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

          const toolResult = await executeTool(toolName, toolArgs, supabaseClient, user.id)

          try {
            const parsed = JSON.parse(toolResult)
            if (parsed.type === 'PROPOSAL') proposals.push(parsed)
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
    await supabaseClient.from('chat_messages').insert({
      session_id,
      user_id: user.id,
      role: 'agent',
      content: finalContent,
      thinking_steps: thinkingSteps,
      tool_calls: toolExecutions,
      proposal: proposals.length > 0 ? proposals[0] : null
    })

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
