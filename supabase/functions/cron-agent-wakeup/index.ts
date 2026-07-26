import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================
// TOOL DEFINITIONS
// ============================================================
var AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_campaign_hierarchy',
      description: 'Fetches active campaigns, including their nested Ad Sets and Ads, and their real-time performance metrics. Use this tool to OBSERVE the current state of the ad account.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_agent_memory',
      description: 'Checks your own memory for a specific campaign or ad set to see what decisions you made previously.',
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
      description: 'Proposes an adjustment to a campaign, ad set, or ad. This creates an Action Card for the user.',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'The UUID of the target to adjust.' },
          action_type: { type: 'string', enum: ['PAUSE', 'INCREASE_BUDGET', 'DECREASE_BUDGET', 'CHANGE_TARGETING', 'CREATE_NEW'], description: 'The type of adjustment.' },
          priority: { type: 'string', enum: ['LOW', 'HIGH', 'MANDATORY'], description: 'The priority.' },
          proposed_changes: { type: 'object', description: 'JSON object detailing the exact changes.' },
          reasoning: { type: 'string', description: 'WHY this adjustment is recommended.' }
        },
        required: ['target_id', 'action_type', 'priority', 'proposed_changes', 'reasoning']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_goal_schedule',
      description: 'Sets a schedule for when you should wake up and re-analyze. Minimum gap is 4 hours. You MUST call this at the end of every background wake-up to keep the monitoring loop alive.',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'The UUID of the target to monitor.' },
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
      description: 'Fetches the historical state timeline (up to 10 snapshots) for a specific target. Note: During background wake-ups, snapshots are already pre-loaded in your context. Only use this tool if you need snapshots for a DIFFERENT target than the one you woke up for.',
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
      description: 'Report that you reviewed a target and determined NO changes are needed. Doing nothing is a valid decision.',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'The UUID of the target.' },
          target_level: { type: 'string', enum: ['campaign', 'ad_set', 'ad'], description: 'The level.' },
          reason: { type: 'string', description: 'Why no action is needed.' }
        },
        required: ['target_id', 'target_level', 'reason']
      }
    }
  }
]

// ============================================================
// SYSTEM PROMPT GENERATOR
// ============================================================
function generateSystemPrompt(businessProfile: any): string {
  var profileContext = 'No business profile found.';
  if (businessProfile) {
    profileContext = [
      'BUSINESS CONTEXT:',
      '- Name: ' + (businessProfile.business_name || 'N/A'),
      '- Industry: ' + (businessProfile.industry || 'N/A'),
      '- Market: ' + (businessProfile.country || 'N/A') + ' (' + (businessProfile.currency || 'USD') + ')',
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
    '- Less than 3 days old: UNTOUCHABLE. Use report_no_action.',
    '- 3-7 days old: OBSERVATION ONLY unless catastrophically bad.',
    '- 7-14 days old: ACTIONABLE with caution.',
    '- More than 14 days old: FULLY ACTIONABLE.',
    '',
    '## Anti-Sycophancy',
    'Evaluate every item strictly according to its age_days and performance_metrics.',
    '',
    '## OODA Loop',
    '1. OBSERVE: Review the pre-loaded snapshot timeline and your past decisions.',
    '2. ORIENT: Is this actually a problem or just normal variance? Look at the trendline.',
    '3. DECIDE: Do nothing (report_no_action), tweak (propose_action_card), or continue monitoring (set_goal_schedule).',
    '4. ACT: Execute the exact tool.',
    '',
    '## CRITICAL: You MUST call set_goal_schedule at the end to keep the monitoring loop alive.'
  ].join('\n');
}

// ============================================================
// BUILD THE RICH WAKE-UP PROMPT
// ============================================================
function buildWakeUpPrompt(
  goal: any,
  chatHistory: any[],
  pastGoals: any[],
  pastDecisions: any[],
  snapshots: any[]
): string {
  var lines: string[] = []
  
  lines.push('===============================================')
  lines.push('BACKGROUND GOAL WAKE-UP')
  lines.push('===============================================')
  lines.push('')
  lines.push('GOAL: "' + goal.goal_description + '"')
  lines.push('TARGET: ' + goal.target_level + ' ' + goal.target_id)
  lines.push('')
  
  // --- Enhancement A2: Temporal Context ---
  var nowDate = new Date()
  var goalCreated = new Date(goal.created_at)
  var scheduledFor = new Date(goal.next_run_at)
  var hoursElapsed = Math.round((nowDate.getTime() - goalCreated.getTime()) / (1000 * 60 * 60))
  var hoursSinceScheduled = Math.round((nowDate.getTime() - scheduledFor.getTime()) / (1000 * 60 * 60))
  
  lines.push('## TEMPORAL CONTEXT')
  lines.push('- Goal was originally set: ' + goalCreated.toISOString())
  lines.push('- This wake-up was scheduled for: ' + scheduledFor.toISOString())
  lines.push('- Current time: ' + nowDate.toISOString())
  lines.push('- Time elapsed since goal was set: ' + hoursElapsed + ' hours')
  lines.push('')
  
  // --- Enhancement B: Past Decision History ---
  if (pastDecisions.length > 0) {
    lines.push('## YOUR PAST DECISIONS FOR THIS TARGET')
    for (var d = 0; d < pastDecisions.length; d++) {
      var dec = pastDecisions[d]
      var decDate = new Date(dec.created_at)
      var decHoursAgo = Math.round((nowDate.getTime() - decDate.getTime()) / (1000 * 60 * 60))
      lines.push((d + 1) + '. [' + decHoursAgo + 'h ago] ' + dec.decision_made + ' - ' + (dec.reasoning_snapshot || 'No reasoning recorded'))
    }
    lines.push('')
    lines.push('Use this history to evaluate whether your past decisions had the desired effect.')
    lines.push('')
  } else {
    lines.push('## YOUR PAST DECISIONS FOR THIS TARGET')
    lines.push('No previous decisions recorded for this target. This is your first analysis.')
    lines.push('')
  }
  
  // --- Enhancement B: Past Goal History ---
  if (pastGoals.length > 0) {
    lines.push('## PREVIOUS GOAL SCHEDULE HISTORY')
    for (var g = 0; g < pastGoals.length; g++) {
      var pg = pastGoals[g]
      var pgDate = new Date(pg.updated_at || pg.created_at)
      var pgHoursAgo = Math.round((nowDate.getTime() - pgDate.getTime()) / (1000 * 60 * 60))
      lines.push((g + 1) + '. [' + pgHoursAgo + 'h ago] "' + pg.goal_description + '" -> ' + pg.status)
    }
    lines.push('')
  }
  
  // --- Enhancement C1: Force-Injected Snapshots ---
  if (snapshots.length > 0) {
    lines.push('## HISTORICAL PERFORMANCE TIMELINE (pre-loaded, 12h cadence)')
    lines.push('These are the ' + snapshots.length + ' most recent snapshots for your target:')
    lines.push('')
    for (var s = 0; s < snapshots.length; s++) {
      var snap = snapshots[s]
      var snapDate = new Date(snap.created_at)
      var snapHoursAgo = Math.round((nowDate.getTime() - snapDate.getTime()) / (1000 * 60 * 60))
      var metricsStr = ''
      if (snap.metrics) {
        var m = snap.metrics
        var parts: string[] = []
        if (m.spend !== undefined) parts.push('spend=$' + m.spend)
        if (m.roas !== undefined) parts.push('roas=' + m.roas + 'x')
        if (m.cpa !== undefined) parts.push('cpa=$' + m.cpa)
        if (m.clicks !== undefined) parts.push('clicks=' + m.clicks)
        if (m.conversions !== undefined) parts.push('conversions=' + m.conversions)
        if (m.impressions !== undefined) parts.push('impressions=' + m.impressions)
        if (m.ctr !== undefined) parts.push('ctr=' + m.ctr + '%')
        if (m.status) parts.push('status=' + m.status)
        if (m.daily_budget !== undefined) parts.push('budget=$' + m.daily_budget)
        if (m.name) parts.push('name="' + m.name + '"')
        metricsStr = parts.join(', ')
      }
      lines.push((s + 1) + '. [' + snapHoursAgo + 'h ago | ' + snapDate.toISOString() + '] ' + metricsStr)
    }
    lines.push('')
    lines.push('Analyze the trendline. Is performance improving, degrading, or stable?')
    lines.push('')
  } else {
    lines.push('## HISTORICAL PERFORMANCE TIMELINE')
    lines.push('No snapshots available for this target yet. Use get_campaign_hierarchy to fetch current state.')
    lines.push('')
  }
  
  lines.push('## INSTRUCTIONS')
  lines.push('1. Analyze the trend from the snapshot timeline above.')
  lines.push('2. Compare current performance to your past decisions — did they have the desired effect?')
  lines.push('3. Make your decision: report_no_action, propose_action_card, or set_goal_schedule.')
  lines.push('4. CRITICAL: You MUST call set_goal_schedule at the end to schedule your next wake-up and keep the monitoring loop alive.')
  lines.push('===============================================')
  
  return lines.join('\n')
}

// ============================================================
// TOOL EXECUTION
// ============================================================
async function executeTool(
  toolName: string,
  toolArgs: Record<string, any>,
  supabaseClient: any,
  userId: string,
  sessionId: string
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
        .order('created_at', { ascending: false }).limit(10);
      if (snapshotsRes.error) return JSON.stringify({ error: snapshotsRes.error.message });
      return JSON.stringify(snapshotsRes.data || []);
    }

    case 'check_agent_memory': {
      var memRes = await supabaseClient.from('agent_memory').select('*')
        .eq('campaign_id', toolArgs.target_id).eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(3)
      if (memRes.error) return JSON.stringify({ error: memRes.error.message })
      return JSON.stringify(memRes.data && memRes.data.length > 0 ? memRes.data : { note: 'No previous memory.' })
    }

    case 'report_no_action': {
      var noActionRes = await supabaseClient.from('agent_memory').insert({
        user_id: userId, campaign_id: toolArgs.target_id,
        decision_made: 'NO ACTION (' + toolArgs.target_level + ')',
        reasoning_snapshot: toolArgs.reason
      })
      if (noActionRes.error) return JSON.stringify({ error: noActionRes.error.message })
      return JSON.stringify({ success: true, message: 'Logged NO ACTION for ' + toolArgs.target_level })
    }

    case 'propose_action_card': {
      var cardRes = await supabaseClient.from('action_cards').insert({
        user_id: userId, campaign_id: toolArgs.target_id,
        priority: toolArgs.priority, action_type: toolArgs.action_type,
        proposed_changes: toolArgs.proposed_changes, reasoning: toolArgs.reasoning,
        status: 'PENDING'
      }).select().single()
      if (cardRes.error) return JSON.stringify({ error: cardRes.error.message })
      await supabaseClient.from('agent_memory').insert({
        user_id: userId, campaign_id: toolArgs.target_id,
        decision_made: 'Proposed ' + toolArgs.action_type, reasoning_snapshot: toolArgs.reasoning
      })
      return JSON.stringify({ type: 'PROPOSAL', card: cardRes.data, message: 'Action Card created with ' + toolArgs.priority + ' priority.' })
    }

    case 'set_goal_schedule': {
      var reviewHours = Math.max(toolArgs.hours_until_next_review || 4, 4)
      var nowD = new Date()
      var nextReview = new Date(nowD.getTime() + reviewHours * 60 * 60 * 1000)
      var goalRes = await supabaseClient.from('goal_schedules').insert({
        user_id: userId, session_id: sessionId,
        target_id: toolArgs.target_id, target_level: toolArgs.target_level,
        goal_description: toolArgs.goal_description,
        next_run_at: nextReview.toISOString(), status: 'ACTIVE'
      }).select().single()
      if (goalRes.error) return JSON.stringify({ error: goalRes.error.message })
      return JSON.stringify({ type: 'GOAL_PROPOSAL', card: goalRes.data, success: true,
        message: 'Recurring Goal scheduled for next execution at ' + nextReview.toISOString() + '.'
      })
    }

    default:
      return JSON.stringify({ error: 'Unknown tool: ' + toolName })
  }
}

// ============================================================
// MAIN CRON HANDLER
// ============================================================
serve(async () => {
  try {
    var supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    )

    // 1. Fetch all ACTIVE goals that are due
    var goalsRes = await supabaseClient
      .from('goal_schedules').select('*')
      .eq('status', 'ACTIVE')
      .lte('next_run_at', new Date().toISOString())

    if (goalsRes.error) throw new Error('Failed to fetch goals: ' + goalsRes.error.message)
    
    var processed = 0;

    for (var gi = 0; gi < (goalsRes.data || []).length; gi++) {
      var goal = goalsRes.data![gi]
      console.log('Processing goal ' + goal.id + ' for user ' + goal.user_id)
      
      // Mark as COMPLETED so it does not run again
      await supabaseClient.from('goal_schedules').update({ status: 'COMPLETED' }).eq('id', goal.id)

      // Fetch user settings
      var settingsRes = await supabaseClient.from('user_settings').select('openrouter_key, preferred_model').eq('id', goal.user_id).single()
      if (!settingsRes.data || !settingsRes.data.openrouter_key) continue;
      var openRouterKey = String(settingsRes.data.openrouter_key).trim()
      if (!openRouterKey.startsWith('sk-or-')) continue;
      var model = settingsRes.data.preferred_model || 'google/gemini-2.5-flash'

      var profileRes = await supabaseClient.from('business_profiles').select('*').eq('user_id', goal.user_id).single()
      var businessProfile = profileRes.data

      // ============================================================
      // ENHANCEMENT A1: Load conversation history from the session
      // ============================================================
      var chatHistoryRes = await supabaseClient
        .from('chat_messages').select('role, content')
        .eq('session_id', goal.session_id)
        .eq('user_id', goal.user_id)
        .order('created_at', { ascending: false })
        .limit(10)
      var chatHistory = (chatHistoryRes.data || []).reverse().map(function(msg: any) {
        return {
          role: msg.role === 'agent' ? 'assistant' : 'user',
          content: msg.content || ''
        }
      })

      // ============================================================
      // ENHANCEMENT B: Past decisions + past goals for this target
      // ============================================================
      var pastDecisionsRes = await supabaseClient
        .from('agent_memory').select('decision_made, reasoning_snapshot, created_at')
        .eq('campaign_id', goal.target_id)
        .eq('user_id', goal.user_id)
        .order('created_at', { ascending: false })
        .limit(5)
      var pastDecisions = pastDecisionsRes.data || []

      var pastGoalsRes = await supabaseClient
        .from('goal_schedules').select('goal_description, status, created_at, updated_at')
        .eq('target_id', goal.target_id)
        .eq('user_id', goal.user_id)
        .eq('status', 'COMPLETED')
        .neq('id', goal.id)
        .order('updated_at', { ascending: false })
        .limit(5)
      var pastGoals = pastGoalsRes.data || []

      // ============================================================
      // ENHANCEMENT C1: Pre-fetch snapshots for the goal target
      // ============================================================
      var snapshotsRes = await supabaseClient
        .from('metrics_snapshots').select('*')
        .eq('target_id', goal.target_id)
        .order('created_at', { ascending: false })
        .limit(10)
      var snapshots = snapshotsRes.data || []

      // ============================================================
      // BUILD THE RICH WAKE-UP PROMPT
      // ============================================================
      var wakeUpPrompt = buildWakeUpPrompt(goal, chatHistory, pastGoals, pastDecisions, snapshots)

      // Build messages: system + chat history (A1) + wake-up prompt
      var finalMessages: any[] = [
        { role: 'system', content: generateSystemPrompt(businessProfile) }
      ]
      // Inject conversation history so the agent has context of what user discussed
      for (var ch = 0; ch < chatHistory.length; ch++) {
        finalMessages.push(chatHistory[ch])
      }
      // The rich wake-up prompt as the final user message
      finalMessages.push({ role: 'user', content: wakeUpPrompt })

      // ============================================================
      // OODA LOOP
      // ============================================================
      var toolExecutions: any[] = []
      var thinkingSteps: string[] = ['Initializing Context-Aware Background OODA Loop...']
      thinkingSteps.push('Loaded ' + chatHistory.length + ' chat messages from session history.')
      thinkingSteps.push('Loaded ' + pastDecisions.length + ' past decisions for this target.')
      thinkingSteps.push('Loaded ' + pastGoals.length + ' previous goal schedules.')
      thinkingSteps.push('Pre-loaded ' + snapshots.length + ' performance snapshots (12h cadence).')
      
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
            'X-Title': 'MetaAgent AI Background'
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
          console.error('OpenRouter error for goal ' + goal.id + ': ' + errText)
          thinkingSteps.push('ERROR: OpenRouter returned ' + openRouterResponse.status)
          finalContent = 'Background analysis failed due to an API error. The goal will need to be re-scheduled manually.'
          break;
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

            var toolResult = await executeTool(toolName, toolArgs, supabaseClient, goal.user_id, goal.session_id)

            try {
              var parsed = JSON.parse(toolResult)
              if (parsed.type === 'PROPOSAL' || parsed.type === 'GOAL_PROPOSAL') proposals.push(parsed)
            } catch(e) {}

            toolExecutions.push({ name: toolName, args: toolArgs, result: toolResult.substring(0, 500), status: 'success' })
            finalMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResult })
          }
        } else {
          finalContent = assistantMessage.content || ''
          thinkingSteps.push('Background OODA Loop complete.')
          break
        }
      }

      // Inject the background message into the chat session
      var agentMsgRes = await supabaseClient.from('chat_messages').insert({
        session_id: goal.session_id,
        user_id: goal.user_id,
        role: 'agent',
        content: finalContent,
        thinking_steps: thinkingSteps,
        tool_calls: toolExecutions,
        proposal: proposals.length > 0 ? proposals[0] : null
      })
      if (agentMsgRes.error) {
        console.error('Failed to save bg message: ' + agentMsgRes.error.message)
      }

      // Update session timestamp for unread badge
      await supabaseClient.from('chat_sessions').update({ updated_at: new Date().toISOString() }).eq('id', goal.session_id)
      
      processed++;
    }

    return new Response(JSON.stringify({ success: true, processed: processed }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err: any) {
    console.error('Cron Wakeup Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
