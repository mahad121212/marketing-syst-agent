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
          target_id: { type: 'string', description: 'The UUID of the campaign or ad set to adjust. If creating a NEW campaign, omit this or pass "NEW".' },
          action_type: { type: 'string', enum: ['PAUSE', 'INCREASE_BUDGET', 'DECREASE_BUDGET', 'CHANGE_TARGETING', 'CREATE_NEW'], description: 'The type of adjustment.' },
          priority: { type: 'string', enum: ['LOW', 'HIGH', 'MANDATORY'], description: 'The priority of this action.' },
          proposed_changes: { type: 'object', description: 'JSON object detailing the exact changes.' },
          reasoning: { type: 'string', description: 'A detailed explanation of WHY this adjustment is recommended.' }
        },
        required: ['action_type', 'priority', 'proposed_changes', 'reasoning']
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
          hours_until_next_review: { type: 'number', description: 'How many hours from now to wake up (minimum 1 minute, use 0.016).' },
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
      description: 'Fetches the historical state and metrics timeline (up to the 10 most recent snapshots) for a specific campaign, ad set, or ad. Snapshots are taken every 12 hours. Use this to analyze trends, stability, and growth over a 5-day period before making critical optimization decisions.',
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
      '- Target CPA: ' + (businessProfile.target_cpa ? businessProfile.target_cpa + ' ' + (businessProfile.currency || 'USD') : 'Not provided'),
      '- Target ROAS: ' + (businessProfile.target_roas ? businessProfile.target_roas + 'x' : 'Not provided'),
      '- Budget Cap: ' + (businessProfile.monthly_ad_budget ? businessProfile.monthly_ad_budget + ' ' + (businessProfile.currency || 'USD') + '/mo' : 'Not provided')
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
    '## Proactive Creation (CREATE_NEW)',
    'You are empowered to proactively create new campaigns, ad sets, or ads using the `CREATE_NEW` action type.',
    '- Use this when the user explicitly asks, or when you identify an untapped audience or fresh strategy based on the Business Profile.',
    '- Provide the complete JSON structure in `proposed_changes` and pass "NEW" for the `target_id`.',
    '- Do NOT tell the user to do it manually; YOU must propose the action card.',
    '',
    '## Missing Absolute Targets (CRITICAL)',
    'If the Business Profile shows "Not provided" for Target CPA or ROAS, DO NOT refuse to make decisions. You MUST shift to RELATIVE evaluation:',
    '- Compare targets against each other. Treat the best performing ad or ad set as the baseline.',
    '- Pause relative losers and scale relative winners.',
    '- Optimize for maximum efficiency autonomously without needing explicit target numbers.',
    '',
    '## Anti-Sycophancy',
    'You must evaluate every item strictly according to its age_days and performance_metrics.',
    '',
    '## Your OODA Loop:',
    '1. OBSERVE: You are provided the target ID. Use `get_state_snapshots` to view its 5-day historical performance timeline.',
    '2. ORIENT: Is this actually a problem or just normal variance? Look at the trendline over multiple snapshots.',
    '3. DECIDE: Do nothing (`report_no_action`), tweak (`propose_action_card`), or set a future wake up (`set_goal_schedule`).',
    '   - Autonomous Rescheduling: After reviewing a background goal, evaluate if the campaign/target requires further checking. If yes, you must call `set_goal_schedule` to schedule a future check. If the campaign has stabilized or you decided no further checks are needed, do not reschedule (it is perfectly fine to do nothing). You decide the gap (minimum 1 minute, use 0.016 hours for testing).',
    '4. ACT: Execute the exact tool.',
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

    case 'get_state_snapshots': {
      const { target_id } = toolArgs;
      const { data, error } = await supabaseClient
        .from('metrics_snapshots')
        .select('*')
        .eq('target_id', target_id)
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (error) {
        return JSON.stringify({ error: error.message });
      }
      return JSON.stringify(data || []);
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
      return JSON.stringify({ success: true, message: 'Logged NO ACTION decision for ' + toolArgs.target_level + '. Reasoning: ' + toolArgs.reason })
    }

    case 'propose_action_card': {
      var campId = toolArgs.target_id;
      if (campId === 'NEW' || campId === '' || !campId) {
        campId = null;
      }
      
      const { data, error } = await supabaseClient.from('action_cards').insert({
        user_id: userId,
        campaign_id: campId,
        priority: toolArgs.priority,
        action_type: toolArgs.action_type,
        proposed_changes: toolArgs.proposed_changes,
        reasoning: toolArgs.reasoning,
        status: 'PENDING'
      }).select().single()

      if (error) return JSON.stringify({ error: error.message })
      
      await supabaseClient.from('agent_memory').insert({
        user_id: userId,
        campaign_id: campId,
        decision_made: 'Proposed ' + toolArgs.action_type,
        reasoning_snapshot: toolArgs.reasoning
      })

      return JSON.stringify({ type: 'PROPOSAL', card: data, message: 'Action Card generated with ' + toolArgs.priority + ' priority and sent to Action Center.' })
    }

    case 'set_goal_schedule': {
      const reviewHours = Math.max(toolArgs.hours_until_next_review || 0.016, 0.016)
      const now = new Date()
      const nextReview = new Date(now.getTime() + reviewHours * 60 * 60 * 1000)

      let desc = toolArgs.goal_description || '';
      if (isBackground && !desc.startsWith('[Agent Rescheduled] ')) {
        desc = '[Agent Rescheduled] ' + desc;
      }

      const { data, error } = await supabaseClient.from('goal_schedules').insert({
        user_id: userId,
        session_id: sessionId,
        target_id: toolArgs.target_id,
        target_level: toolArgs.target_level,
        goal_description: desc,
        metrics_snapshot: toolArgs.current_metrics_snapshot || null,
        next_run_at: nextReview.toISOString(),
        status: 'ACTIVE'
      }).select().single()
        
      if (error) return JSON.stringify({ error: error.message })
      
      return JSON.stringify({ 
        type: 'GOAL_PROPOSAL', 
        card: data, 
        success: true, 
        message: isBackground ? 'Recurring Goal automatically rescheduled for next execution at ' + nextReview.toISOString() + '.' : 'Goal Schedule proposed for ' + toolArgs.target_level + ' and sent to user for approval.'
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

    // Parse request body for targeted goal execution
    let goalId: string | null = null;
    try {
      const body = await req.json()
      goalId = body?.goal_id || null
    } catch (e) {
      // Body may be empty
    }

    let ripeGoals: any[] = [];
    if (goalId) {
      const { data, error: fetchError } = await supabaseClient
        .from('goal_schedules')
        .select('*')
        .eq('id', goalId)
        .eq('status', 'ACTIVE')
      if (fetchError) throw new Error('Failed to fetch targeted goal: ' + fetchError.message)
      ripeGoals = data || []
    } else {
      // Fallback: Fetch all ACTIVE goals that are due to run
      const { data, error: fetchError } = await supabaseClient
        .from('goal_schedules')
        .select('*')
        .eq('status', 'ACTIVE')
        .lte('next_run_at', new Date().toISOString())
      if (fetchError) throw new Error('Failed to fetch goals: ' + fetchError.message)
      ripeGoals = data || []
    }
    
    let processed = 0;

    for (const goal of (ripeGoals || [])) {
      console.log('Processing goal ' + goal.id + ' for user ' + goal.user_id)
      
      // Mark this goal as COMPLETED so it doesn't run again. The agent must schedule a new one.
      await supabaseClient.from('goal_schedules').update({ status: 'COMPLETED' }).eq('id', goal.id)

      // Save the trigger event to the chat timeline so both user and follow-up agents have context
      const triggerContent = `🤖 [Background Goal Triggered]\nGoal: "${goal.goal_description}"\nTarget: ${goal.target_level} (${goal.target_id})`
      await supabaseClient.from('chat_messages').insert({
        session_id: goal.session_id,
        user_id: goal.user_id,
        role: 'user',
        content: triggerContent
      })

      // Fetch user settings
      const { data: settings } = await supabaseClient.from('user_settings').select('openrouter_key, preferred_model').eq('id', goal.user_id).single()
      if (!settings?.openrouter_key) continue;

      const { data: businessProfile } = await supabaseClient.from('business_profiles').select('*').eq('user_id', goal.user_id).single()

      const openRouterKey = settings.openrouter_key
      const model = settings.preferred_model || 'google/gemini-3.6-flash'
      
      const prompt = 'BACKGROUND TASK WAKE-UP: Please execute the goal "' + goal.goal_description + '". Target is ' + goal.target_level + ' ' + goal.target_id + '. Use your get_state_snapshots tool to pull the recent timeline data for this target, then make a decision.'

      const finalMessages: any[] = [
        { role: 'system', content: generateSystemPrompt(businessProfile, '') },
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

            const toolResult = await executeTool(toolName, toolArgs, supabaseClient, goal.user_id, goal.session_id, true)

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
      const { error: agentMsgErr } = await supabaseClient.from('chat_messages').insert({
        session_id: goal.session_id,
        user_id: goal.user_id,
        role: 'agent',
        content: finalContent,
        thinking_steps: thinkingSteps,
        tool_calls: toolExecutions,
        proposal: proposals.length > 0 ? proposals : null
      })
      if (agentMsgErr) throw new Error('Failed to save background agent message: ' + agentMsgErr.message)

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
