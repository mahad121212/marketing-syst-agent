import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================
// TOOL DEFINITIONS (Copied from agent-loop for independence)
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
      description: "Proposes an adjustment to a campaign, ad set, or ad. This creates an Action Card in the user's Action Center.",
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
          goal_description: { type: 'string', description: 'What are you monitoring?' },
          current_metrics_snapshot: { type: 'object', description: 'JSON object summarizing current performance metrics.' }
        },
        required: ['target_id', 'target_level', 'hours_until_next_review', 'goal_description', 'current_metrics_snapshot']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'report_no_action',
      description: 'Report that you reviewed a target and determined NO changes are needed.',
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

function generateSystemPrompt(businessProfile: any, historical_context: string) {
  let profileContext = 'No business profile found.';
  if (businessProfile) {
    profileContext = [
      'BUSINESS CONTEXT:',
      '- Name: ' + businessProfile.business_name,
      '- Industry: ' + businessProfile.industry,
      '- Market: ' + businessProfile.country + ' (' + businessProfile.currency + ')',
      '- Target CPA: ' + businessProfile.target_cpa + ' ' + businessProfile.currency,
      '- Target ROAS: ' + businessProfile.target_roas + 'x',
      '- Budget Cap: ' + businessProfile.monthly_ad_budget + ' ' + businessProfile.currency + '/mo'
    ].join('\n');
  }

  return [
    'You are MetaAgent AI, a highly advanced autonomous Meta Ads optimization agent.',
    '',
    profileContext,
    '',
    '## Temporal Discipline (CRITICAL)',
    'You MUST check the age_days of every item before reasoning about it.',
    '- < 3 days old: UNTOUCHABLE. Do NOT propose any change.',
    '- 3-7 days old: OBSERVATION ONLY unless catastrophically bad.',
    '- 7-14 days old: ACTIONABLE with caution.',
    '- > 14 days old: FULLY ACTIONABLE.',
    '',
    '## Anti-Sycophancy',
    'You must evaluate every item strictly according to its age_days and performance_metrics.',
    '',
    '## Your Actions',
    'When you decide on an action, use propose_action_card.',
    'If no action is needed, use report_no_action.',
    'You MUST use set_goal_schedule at the end to schedule your NEXT wake-up to keep the recurring loop alive.',
    '',
    '## Background Context',
    'BACKGROUND WAKE-UP: You have been woken up to monitor a recurring goal.',
    'Historical Context when goal was set: ' + historical_context,
    'Compare current metrics to this historical context to make decisions.'
  ].join('\n');
}

async function executeTool(
  toolName: string,
  toolArgs: Record<string, any>,
  supabaseClient: any,
  userId: string,
  sessionId: string
): Promise<string> {
  switch (toolName) {
    case 'get_campaign_hierarchy': {
      const { data: campaigns } = await supabaseClient.from('campaigns').select('*').eq('user_id', userId)
      const { data: adSets } = await supabaseClient.from('ad_sets').select('*').eq('user_id', userId)
      const { data: ads } = await supabaseClient.from('ads').select('*').eq('user_id', userId)
      
      const now = new Date().getTime()
      const calcAge = (createdAt: string) => Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)))

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
      const { data, error } = await supabaseClient.from('agent_memory').select('*').eq('campaign_id', toolArgs.target_id).eq('user_id', userId).order('created_at', { ascending: false }).limit(3)
      if (error) return JSON.stringify({ error: error.message })
      return JSON.stringify(data && data.length > 0 ? data : { note: 'No previous memory for this target.' })
    }

    case 'report_no_action': {
      const { error } = await supabaseClient.from('agent_memory').insert({
        user_id: userId,
        campaign_id: toolArgs.target_id,
        decision_made: 'NO ACTION (' + toolArgs.target_level + ')',
        reasoning_snapshot: toolArgs.reason
      })
      if (error) return JSON.stringify({ error: error.message })
      return JSON.stringify({ success: true, message: 'Logged NO ACTION decision for ' + toolArgs.target_level + '.' })
    }

    case 'propose_action_card': {
      const { data, error } = await supabaseClient.from('action_cards').insert({
        user_id: userId,
        campaign_id: toolArgs.target_id,
        priority: toolArgs.priority,
        action_type: toolArgs.action_type,
        proposed_changes: toolArgs.proposed_changes,
        reasoning: toolArgs.reasoning,
        status: 'PENDING'
      }).select().single()

      if (error) return JSON.stringify({ error: error.message })
      
      await supabaseClient.from('agent_memory').insert({
        user_id: userId,
        campaign_id: toolArgs.target_id,
        decision_made: 'Proposed ' + toolArgs.action_type,
        reasoning_snapshot: toolArgs.reasoning
      })

      return JSON.stringify({ type: 'PROPOSAL', card: data, message: 'Action Card generated.' })
    }

    case 'set_goal_schedule': {
      const reviewHours = Math.max(toolArgs.hours_until_next_review || 4, 4)
      const now = new Date()
      const nextReview = new Date(now.getTime() + reviewHours * 60 * 60 * 1000)

      const { data, error } = await supabaseClient.from('goal_schedules').insert({
        user_id: userId,
        session_id: sessionId,
        target_id: toolArgs.target_id,
        target_level: toolArgs.target_level,
        goal_description: toolArgs.goal_description,
        metrics_snapshot: toolArgs.current_metrics_snapshot,
        next_run_at: nextReview.toISOString(),
        status: 'ACTIVE'
      }).select().single()
        
      if (error) return JSON.stringify({ error: error.message })
      
      return JSON.stringify({ 
        type: 'GOAL_PROPOSAL', 
        card: data, 
        success: true, 
        message: 'Recurring Goal automatically scheduled for next execution at ' + nextReview.toISOString() + '.'
      })
    }

    default:
      return JSON.stringify({ error: 'Unknown tool: ' + toolName })
  }
}

// ============================================================
// MAIN CRON HANDLER
// ============================================================
serve(async (req) => {
  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Fetch all ACTIVE goals that are due to run
    const { data: ripeGoals, error: fetchError } = await supabaseClient
      .from('goal_schedules')
      .select('*')
      .eq('status', 'ACTIVE')
      .lte('next_run_at', new Date().toISOString())

    if (fetchError) throw new Error('Failed to fetch goals: ' + fetchError.message)
    
    let processed = 0;

    for (const goal of (ripeGoals || [])) {
      console.log('Processing goal ' + goal.id + ' for user ' + goal.user_id)
      
      // Mark this goal as COMPLETED so it doesn't run again. The agent must schedule a new one.
      await supabaseClient.from('goal_schedules').update({ status: 'COMPLETED' }).eq('id', goal.id)

      // Fetch user settings
      const { data: settings } = await supabaseClient.from('user_settings').select('openrouter_key, preferred_model').eq('id', goal.user_id).single()
      if (!settings?.openrouter_key) continue;

      const { data: businessProfile } = await supabaseClient.from('business_profiles').select('*').eq('user_id', goal.user_id).single()

      const openRouterKey = settings.openrouter_key
      const model = settings.preferred_model || 'google/gemini-3.6-flash'
      
      const promptContext = JSON.stringify(goal.metrics_snapshot || {})
      const prompt = 'BACKGROUND TASK WAKE-UP: Please execute the goal "' + goal.goal_description + '". Target is ' + goal.target_level + ' ' + goal.target_id + '.'

      const finalMessages: any[] = [
        { role: 'system', content: generateSystemPrompt(businessProfile, promptContext) },
        { role: 'user', content: prompt }
      ]

      const toolExecutions: any[] = []
      const thinkingSteps: string[] = ['Initializing Background OODA Loop...']
      let proposals: any[] = []
      const MAX_ITERATIONS = 6
      let finalContent = ''

      for (let i = 0; i < MAX_ITERATIONS; i++) {
        thinkingSteps.push('Iteration ' + (i + 1) + ': Reasoning with ' + model + '...')

        const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + openRouterKey,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://metaagent.ai',
            'X-Title': 'MetaAgent AI Background'
          },
          body: JSON.stringify({
            model: model,
            messages: finalMessages,
            tools: AGENT_TOOLS,
            tool_choice: 'auto'
          })
        })

        if (!openRouterResponse.ok) break;

        const aiData = await openRouterResponse.json()
        const assistantMessage = aiData.choices[0].message
        finalMessages.push(assistantMessage)

        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name
            let toolArgs = {}
            try { toolArgs = JSON.parse(toolCall.function.arguments || '{}') } catch {}

            thinkingSteps.push('Executing Tool: ' + toolName)

            const toolResult = await executeTool(toolName, toolArgs, supabaseClient, goal.user_id, goal.session_id)

            try {
              const parsed = JSON.parse(toolResult)
              if (parsed.type === 'PROPOSAL' || parsed.type === 'GOAL_PROPOSAL') proposals.push(parsed)
            } catch {}

            toolExecutions.push({ name: toolName, args: toolArgs, result: toolResult.substring(0, 500), status: 'success' })
            finalMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResult })
          }
        } else {
          finalContent = assistantMessage.content || ''
          thinkingSteps.push('Background Loop complete.')
          break
        }
      }

      // Inject the background message into the original chat session
      await supabaseClient.from('chat_messages').insert({
        session_id: goal.session_id,
        user_id: goal.user_id,
        role: 'agent',
        content: '**(BACKGROUND TASK)** ' + finalContent,
        thinking_steps: thinkingSteps,
        tool_calls: toolExecutions,
        proposal: proposals.length > 0 ? proposals[0] : null
      })
      
      // Update chat session timestamp so sidebar picks up the unread badge
      await supabaseClient.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', goal.session_id)
      
      processed++;
    }

    return new Response(JSON.stringify({ success: true, processed }), { headers: { 'Content-Type': 'application/json' } })
  } catch (error: any) {
    console.error('Cron Wakeup Error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})
