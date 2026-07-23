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
      name: 'get_active_campaigns',
      description: 'Fetches all active campaigns for the current user from the database, including their real-time performance metrics (impressions, clicks, spend, conversions, CPC, CTR, CPA, ROAS, CPM). Use this tool to OBSERVE the current state of the ad account.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_campaign_details',
      description: 'Fetches full details for a specific campaign by its ID, including targeting configuration and all performance metrics. Use this to deep-dive into a single campaign.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string', description: 'The UUID of the campaign to inspect.' }
        },
        required: ['campaign_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'propose_campaign_adjustment',
      description: 'Proposes an adjustment to a campaign. This does NOT execute the change — it returns a structured proposal for the user to approve. Use this to DECIDE and ACT after analyzing performance data. Actions: PAUSE (pause a losing campaign), INCREASE_BUDGET (scale a winning campaign), DECREASE_BUDGET (reduce spend on underperforming campaign), CHANGE_TARGETING (suggest new targeting parameters).',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string', description: 'The UUID of the campaign to adjust.' },
          campaign_name: { type: 'string', description: 'The name of the campaign.' },
          action: { type: 'string', enum: ['PAUSE', 'INCREASE_BUDGET', 'DECREASE_BUDGET', 'CHANGE_TARGETING', 'LAUNCH_NEW'], description: 'The type of adjustment to propose.' },
          new_daily_budget: { type: 'number', description: 'The new proposed daily budget (if adjusting budget).' },
          reasoning: { type: 'string', description: 'A detailed explanation of WHY this adjustment is recommended based on the data.' },
          expected_impact: { type: 'string', description: 'What the expected impact of this change will be on CPA/ROAS.' }
        },
        required: ['campaign_id', 'campaign_name', 'action', 'reasoning', 'expected_impact']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_campaign_draft',
      description: 'Creates a new campaign draft in the database with PAUSED status. Use this when the user wants to launch a brand new campaign. The agent should fill in all targeting parameters based on the business goals discussed.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Campaign name.' },
          daily_budget: { type: 'number', description: 'Proposed daily budget in USD.' },
          targeting: {
            type: 'object',
            description: 'Targeting configuration.',
            properties: {
              age_min: { type: 'number' },
              age_max: { type: 'number' },
              gender: { type: 'string', enum: ['male', 'female', 'all'] },
              interests: { type: 'array', items: { type: 'string' } },
              geo: { type: 'string', description: 'Comma-separated country codes.' }
            }
          },
          objective: { type: 'string', description: 'Campaign objective (e.g., CONVERSIONS, TRAFFIC, AWARENESS).' },
          suggested_ad_copy: { type: 'string', description: 'AI-generated ad copy for the campaign.' }
        },
        required: ['name', 'daily_budget', 'targeting', 'objective', 'suggested_ad_copy']
      }
    }
  }
]

// ============================================================
// SYSTEM PROMPT — The Agent's core identity and reasoning framework
// ============================================================
const SYSTEM_PROMPT = `You are MetaAgent AI, an autonomous Meta Ads optimization agent. You follow the OODA Loop (Observe, Orient, Decide, Act) methodology to manage advertising campaigns.

## Your Core Capabilities
- You have direct access to the user's campaign database via tools.
- You can observe real-time campaign metrics (ROAS, CPA, CTR, CPC, CPM, Impressions, Conversions).
- You can propose specific, data-driven adjustments to campaigns.
- You can draft new campaigns with optimized targeting based on business goals.

## Your Reasoning Process (OODA Loop)
For every user request, you MUST follow this loop:
1. **OBSERVE**: Call get_active_campaigns to fetch the latest data. Never guess or assume metrics.
2. **ORIENT**: Analyze the data against the user's goals. Identify winners (ROAS > 3.0x, CPA within target) and losers (ROAS < 1.5x, CPA > 2x target).
3. **DECIDE**: Formulate a specific strategy based on the data.
4. **ACT**: Call propose_campaign_adjustment or create_campaign_draft to produce structured, actionable proposals.

## Key Rules
- ALWAYS call get_active_campaigns first before giving any advice. You must ground your analysis in real data.
- When a campaign has ROAS < 1.5x, recommend pausing or drastically reducing its budget.
- When a campaign has ROAS > 3.5x, recommend scaling its budget by 15-25%.
- A healthy CPA is typically below $35 for e-commerce. Flag anything above $50 as critical.
- NEVER fabricate metrics. Only reference numbers returned by your tools.
- When proposing adjustments, ALWAYS use the propose_campaign_adjustment tool so the user gets a structured approval card.
- Be concise, data-driven, and direct. You are an expert strategist, not a chatbot.`

// ============================================================
// TOOL EXECUTION — Actually runs the tool against Supabase
// ============================================================
async function executeTool(
  toolName: string,
  toolArgs: Record<string, any>,
  supabaseClient: any,
  userId: string
): Promise<string> {
  switch (toolName) {
    case 'get_active_campaigns': {
      const { data, error } = await supabaseClient
        .from('campaign_state')
        .select('*')
        .eq('user_id', userId)
      if (error) return JSON.stringify({ error: error.message })
      return JSON.stringify(data)
    }

    case 'get_campaign_details': {
      const { data, error } = await supabaseClient
        .from('campaign_state')
        .select('*')
        .eq('id', toolArgs.campaign_id)
        .eq('user_id', userId)
        .single()
      if (error) return JSON.stringify({ error: error.message })
      return JSON.stringify(data)
    }

    case 'propose_campaign_adjustment': {
      // This tool doesn't mutate. It returns a structured proposal for the frontend.
      return JSON.stringify({
        type: 'PROPOSAL',
        campaign_id: toolArgs.campaign_id,
        campaign_name: toolArgs.campaign_name,
        action: toolArgs.action,
        new_daily_budget: toolArgs.new_daily_budget || null,
        reasoning: toolArgs.reasoning,
        expected_impact: toolArgs.expected_impact
      })
    }

    case 'create_campaign_draft': {
      const { data, error } = await supabaseClient
        .from('campaign_state')
        .insert({
          user_id: userId,
          name: toolArgs.name,
          status: 'PAUSED',
          daily_budget: toolArgs.daily_budget,
          targeting: toolArgs.targeting || {},
          performance_metrics: { impressions: 0, clicks: 0, spend: 0, conversions: 0, cpc: 0, ctr: 0, cpa: 0, roas: 0, cpm: 0 }
        })
        .select()
        .single()
      if (error) return JSON.stringify({ error: error.message })
      return JSON.stringify({
        type: 'CAMPAIGN_CREATED',
        campaign: data,
        suggested_ad_copy: toolArgs.suggested_ad_copy,
        objective: toolArgs.objective
      })
    }

    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` })
  }
}

// ============================================================
// MAIN HANDLER — The Agentic OODA Loop
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

    const { prompt } = await req.json()
    if (!prompt) {
      return new Response(JSON.stringify({ error: 'Prompt is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      })
    }

    // Fetch user's OpenRouter API key securely
    const { data: settings, error: settingsError } = await supabaseClient
      .from('user_settings')
      .select('openrouter_key, preferred_model')
      .eq('id', user.id)
      .single()

    if (settingsError || !settings?.openrouter_key) {
      return new Response(
        JSON.stringify({ error: 'OpenRouter API Key not found. Please save it in Settings.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const openRouterKey = settings.openrouter_key
    const model = settings.preferred_model || 'google/gemini-3.6-flash'

    // Build the initial conversation
    const messages: any[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt }
    ]

    // Track tool executions for the frontend
    const toolExecutions: any[] = []
    const thinkingSteps: string[] = ['Initializing OODA Loop...']
    let proposals: any[] = []

    // ============================================================
    // THE AGENTIC LOOP — Keep calling the LLM until it stops requesting tools
    // ============================================================
    const MAX_ITERATIONS = 6
    let finalContent = ''

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      thinkingSteps.push(`Iteration ${i + 1}: Sending ${messages.length} messages to ${model}...`)

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
          messages: messages,
          tools: AGENT_TOOLS,
          tool_choice: 'auto'
        })
      })

      if (!openRouterResponse.ok) {
        const errorText = await openRouterResponse.text()
        throw new Error(`OpenRouter Error: ${errorText}`)
      }

      const aiData = await openRouterResponse.json()
      const choice = aiData.choices[0]
      const assistantMessage = choice.message

      // Add the assistant's response to the conversation history
      messages.push(assistantMessage)

      // Check if the LLM wants to call tools
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name
          let toolArgs = {}
          try {
            toolArgs = JSON.parse(toolCall.function.arguments || '{}')
          } catch {
            toolArgs = {}
          }

          thinkingSteps.push(`Executing Tool: ${toolName}(${JSON.stringify(toolArgs).substring(0, 100)}...)`)

          // Execute the tool against our Supabase database
          const toolResult = await executeTool(toolName, toolArgs, supabaseClient, user.id)

          // Check if the tool returned a proposal
          try {
            const parsed = JSON.parse(toolResult)
            if (parsed.type === 'PROPOSAL') {
              proposals.push(parsed)
            }
            if (parsed.type === 'CAMPAIGN_CREATED') {
              proposals.push(parsed)
            }
          } catch {}

          toolExecutions.push({
            name: toolName,
            args: toolArgs,
            result: toolResult.substring(0, 500), // Truncate for frontend display
            status: 'success'
          })

          // Add the tool result back into the conversation so the LLM can continue reasoning
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult
          })
        }
        // Continue the loop — the LLM will process the tool results and may call more tools
      } else {
        // No more tool calls — the LLM has finished reasoning
        finalContent = assistantMessage.content || ''
        thinkingSteps.push('OODA Loop complete. Generating final response.')
        break
      }
    }

    // Log this entire agent interaction
    await supabaseClient.from('agent_logs').insert({
      user_id: user.id,
      action: 'OODA_LOOP_CYCLE',
      details: {
        prompt,
        model,
        iterations: toolExecutions.length,
        tools_called: toolExecutions.map(t => t.name),
        proposals: proposals.length
      }
    })

    return new Response(
      JSON.stringify({
        response: finalContent,
        thinkingSteps,
        toolCalls: toolExecutions,
        proposals
      }),
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
