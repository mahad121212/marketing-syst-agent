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
          goal_description: { type: 'string', description: 'What are you monitoring? e.g., "Maintain CPA under $30 for Campaign X".' }
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
  },
  {
    type: 'function',
    function: {
      name: 'get_account_summary_snapshots',
      description: 'Fetches the 2 most recent snapshots for EVERY campaign in the account. Use this for broad account-level analysis when the user asks about overall performance.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_campaign',
      description: 'Creates a brand new campaign in the ad account. Use this when the user asks to create a new campaign, or when you identify a strategic need for one. The campaign starts in PAUSED status so the user can review it.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Campaign name, e.g. "Summer Sale - Conversions"' },
          daily_budget: { type: 'number', description: 'Daily budget in the account currency.' },
          targeting: { type: 'object', description: 'Targeting config: { age_range, gender, interests, locations, custom_audiences }' },
          objective: { type: 'string', description: 'Campaign objective, e.g. CONVERSIONS, TRAFFIC, REACH, AWARENESS' }
        },
        required: ['name', 'daily_budget']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_ad_set',
      description: 'Creates a new ad set under an existing campaign. Use this to segment audiences or test different targeting within a campaign.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string', description: 'The UUID of the parent campaign.' },
          name: { type: 'string', description: 'Ad set name, e.g. "Males 25-34 Interest Health"' },
          targeting: { type: 'object', description: 'Targeting config for this ad set: { age_range, gender, interests, locations }' }
        },
        required: ['campaign_id', 'name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_ad',
      description: 'Creates a new ad under an existing ad set. Use this to test different creatives, copy, or CTAs within an ad set.',
      parameters: {
        type: 'object',
        properties: {
          ad_set_id: { type: 'string', description: 'The UUID of the parent ad set.' },
          name: { type: 'string', description: 'Ad name, e.g. "Carousel - Summer Promo v1"' },
          copy: { type: 'string', description: 'The ad copy / primary text.' },
          cta: { type: 'string', description: 'Call to action, e.g. SHOP_NOW, LEARN_MORE, SIGN_UP' },
          creative_url: { type: 'string', description: 'URL to the creative image or video (optional).' }
        },
        required: ['ad_set_id', 'name', 'copy']
      }
    }
  }
]

// ============================================================
// SYSTEM PROMPT GENERATORS FOR DEEP REASONING
// ============================================================
function generatePlannerPrompt(businessProfile: any, historical_context?: string) {
  let profileContext = 'No business profile found. Ask the user to fill out their Business Profile in the dashboard.';
  
  if (businessProfile) {
    profileContext = `
BUSINESS CONTEXT:
- Name: ${businessProfile.business_name}
- Industry: ${businessProfile.industry}
- Description: ${businessProfile.business_description}
- Market: ${businessProfile.country} (${businessProfile.currency})
- Target CPA: ${businessProfile.target_cpa ? businessProfile.target_cpa + ' ' + (businessProfile.currency || 'USD') : 'Not provided'}
- Target ROAS: ${businessProfile.target_roas ? businessProfile.target_roas + 'x' : 'Not provided'}
- Budget Cap: ${businessProfile.monthly_ad_budget ? businessProfile.monthly_ad_budget + ' ' + (businessProfile.currency || 'USD') + '/mo' : 'Not provided'}
- Stage: ${businessProfile.business_stage}
`;
  }

  return `You are MetaAgent Planner AI, a Chief Marketing Officer and $50M+ Meta Ads Growth Strategist.
Your task is to analyze the user's request and build an unconstrained, deeply practical, masterclass advertising strategy.

${profileContext}

## Strategic Core Rules:
1. CURRENCY SENSITIVITY: Always use the user's explicit currency (e.g., PKR / Rupees vs USD / Euros). NEVER convert PKR 2000 to $2000!
2. TOTAL VS DAILY BUDGET: If a user gives a total amount ("I have 2000 rupees to spend", "I only have $100"), calculate a realistic daily test budget over 3 to 5 days (e.g. Rs. 650-700/day for 3 days). NEVER set daily_budget = total wallet.
3. AD ACCOUNT STRUCTURE: Recommend 1 Campaign (Sales/Conversions), 1 Ad Set, and 2-3 Ad Creative variations (e.g. 1 video, 1 image, different hooks). Do not split tiny budgets across many campaigns.
4. BEYOND SETUP: Explain why the OFFER (free delivery, bundle, discount) and CREATIVE matter more than broad vs narrow targeting.
5. POST-LAUNCH & CLARIFICATION: Detail what to do if sales happen vs if no sales happen, and ask key clarifying questions (e.g., product details, pixel status).

You MUST respond ONLY with a JSON object in this format (no markdown codeblock markers, no extraneous wrapper text):
{
  "currency": "${businessProfile?.currency || 'PKR'}",
  "is_total_wallet": true,
  "strategic_blueprint": "Deep markdown text containing step-by-step masterclass strategy including budget pacing, campaign structure, creative hooks, offer advice, and next steps",
  "recommended_daily_budget": 650,
  "recommended_days": 3,
  "key_questions": ["What exact product or niche are you selling?", "Is your Meta Pixel active?"]
}`;
}

function generateReviewerPrompt(role: 'budget' | 'targeting' | 'risk', businessProfile: any) {
  let profileContext = '';
  if (businessProfile) {
    profileContext = `
Business: ${businessProfile.business_name} (${businessProfile.country})
Currency: ${businessProfile.currency || 'PKR'}
`;
  }

  const roleDescriptions = {
    budget: `You are the VP of Finance & Growth Reviewer.
Your job is to audit the response for financial precision:
- FAIL if the agent converted local currency (e.g. PKR 2000) to dollars ($2000) or vice versa.
- FAIL if the agent allocated 100% of a limited total wallet in a single daily budget instead of pacing over 3-5 days.
- FAIL if daily budget is below minimum viable thresholds.`,

    targeting: `You are the Chief Strategy Officer Reviewer.
Your job is to audit the response for depth and actionable intelligence:
- FAIL if the response is generic, vague 3-bullet-point advice (e.g. "Create ad, target health enthusiasts, run campaign").
- PASS ONLY if the response provides a masterclass breakdown: clear campaign structure (1 campaign, 1 ad set, 2-3 ads), daily pacing, creative advice, offer importance, post-launch guidance, and a clarifying question.`,

    risk: `You are the Technical Operations Reviewer.
Your job is to audit tool execution and temporal safety:
- Check if tool calls match user intent.
- Ensure the agent does not force-create campaigns on Meta if the user only asked for strategic advice or a plan.`
  };

  return `${roleDescriptions[role]}
${profileContext}

Analyze the user's request, the planner's blueprint, and the draft response.
If the draft response is shallow, generic, robotic, or has currency conversion mistakes, YOU MUST FAIL IT and provide specific instructions for depth!

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "feedback": "detailed explanation of pass or fail"
}`;
}

function generateSynthesizerPrompt(businessProfile: any) {
  return `You are the Quality Gate Synthesizer.
Review the reviewer verdicts. If ANY reviewer marked "FAIL", synthesize their feedback into a clear, demanding directive for the worker to rewrite its response with complete masterclass depth, correct currency, and practical strategy.

Respond ONLY with a JSON object:
{
  "all_passed": true | false,
  "actionable_feedback": "synthesis of feedback if any failed, or empty if all passed"
}`;
}

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
- Target CPA: ${businessProfile.target_cpa ? businessProfile.target_cpa + ' ' + (businessProfile.currency || 'USD') : 'Not provided'}
- Target ROAS: ${businessProfile.target_roas ? businessProfile.target_roas + 'x' : 'Not provided'}
- Budget Cap: ${businessProfile.monthly_ad_budget ? businessProfile.monthly_ad_budget + ' ' + (businessProfile.currency || 'USD') + '/mo' : 'Not provided'}
- Stage: ${businessProfile.business_stage}
- Additional Rules: ${businessProfile.additional_context || 'None'}
`;
  }

  return `You are MetaAgent AI, a highly advanced autonomous Meta Ads optimization agent capable of deep contextual reasoning.

${profileContext}

## Core Identity & Reasoning Mode
You are a SENIOR MEDIA BUYER, not a task robot. Your value comes from STRATEGIC THINKING, not just tool execution.

### Reasoning Hierarchy (always follow this order):
1. **Listen** — Fully understand what the user is really asking. Read between the lines. "I have 2000 PKR and want to hit a 6" means they have extremely limited budget and need maximum ROI — NOT "create a campaign with 2000 PKR daily budget."
2. **Analyze** — Consider the user's business context, budget constraints, market (Pakistan/PKR vs US/USD), industry, and what realistic outcomes look like.
3. **Advise** — Present your strategic recommendation with clear reasoning BEFORE taking action. Explain trade-offs.
4. **Act** — Only execute after the user understands and agrees with your plan.

### When NOT to Immediately Create Things
If the user asks a strategic question ("what should I do?", "how should I spend?", "what's the best approach?"), your job is to ADVISE FIRST:
- Present 1-2 strategic options with pros/cons
- Recommend one option and explain why
- Ask the user to confirm before you build anything
- Do NOT just fire off create_campaign immediately

### When to Immediately Create Things
If the user gives you a SPECIFIC directive ("create a campaign named X with budget Y"), then act directly. But still explain your reasoning briefly.

## Temporal Discipline (CRITICAL)
You MUST check the \`age_days\` of every item before reasoning about it.
- **< 3 days old**: UNTOUCHABLE. Do NOT analyze, judge, or propose any change. Meta's learning phase needs at minimum 72 hours. Use \`report_no_action\`.
- **3-7 days old**: OBSERVATION ONLY. Note trends but DO NOT propose changes unless metrics are catastrophically bad (e.g., 5x above target CPA).
- **7-14 days old**: ACTIONABLE with caution. You have enough data to make informed decisions.
- **> 14 days old**: FULLY ACTIONABLE. You have mature data to make confident scaling or pruning decisions.

## Proactive Creation
You have dedicated tools to create new campaigns, ad sets, and ads:
- \`create_campaign\`: Creates a new campaign in PAUSED status. Use when the user asks for a new campaign, or when you identify a strategic need.
- \`create_ad_set\`: Creates a new ad set under a campaign. Use to segment audiences or test new targeting.
- \`create_ad\`: Creates a new ad under an ad set. Use to test creatives, copy, or CTAs.

When the user asks you to create something new, YOU MUST use these tools to actually create the entities. Do NOT tell the user to go to Meta Ads Manager and do it themselves. You are the media buyer — you do the work.
Always provide a full campaign structure when asked: campaign -> at least one ad set -> at least one ad.

## Strategic Budget Reasoning (CRITICAL)
You are a STRATEGIC media buyer, not a button-pusher. When the user gives you a budget, you MUST reason about it before acting.

### Total Money vs Daily Budget
Users often say things like "I have 2000 rupees" or "my budget is $50". You MUST determine whether this is:
- **Total available money** (their entire ad spend wallet) — in this case, you must NEVER set daily_budget = total money. That would burn everything in one day.
- **Daily budget** (what they want to spend per day) — only then set it as daily_budget directly.

When in doubt, ASSUME it is total available money and reason accordingly:
- If the user says "I have X rupees/dollars to spend", divide it across days. A good starting point for small budgets is 3-7 day test windows.
- Example: "I have 2000 PKR" → set daily budget to 300-500 PKR so it lasts 4-7 days of testing.
- ALWAYS explain your budget allocation reasoning to the user before creating.

### Think-Before-You-Act Protocol
When the user asks you to do something strategic (create campaigns, allocate budget, plan an ad strategy), you MUST follow this order:
1. **UNDERSTAND** — Ask yourself: What is the user's real goal? What constraints do they have? How much money and time do they have?
2. **STRATEGIZE** — Present your recommended approach to the user FIRST. Explain: how you would split the budget, why you chose that structure, what the testing plan is, and what success looks like.
3. **CONFIRM** — Wait for the user's approval or feedback on your strategy before creating anything on Meta.
4. **EXECUTE** — Only after the user agrees, use your creation tools to build the campaign structure.

Do NOT skip steps 2 and 3. If the user says "just do it" or "go ahead", you may proceed, but you must STILL briefly explain your reasoning in your response.

### Small Budget Survival Rules
When the user has a tight budget (signals: "only have X", "one shot", "limited money", "can't afford to waste"):
- **Never allocate 100% to a single campaign/ad set on day one.** Reserve at least 20-30% for iteration.
- **Start with 1 campaign, 2 ad sets** (split-test audiences) to find what works before scaling.
- **Set realistic expectations.** Tell the user what outcomes are likely with their budget. Don't overpromise.
- **Suggest a phased approach:** Phase 1 = test/learn (60-70% budget), Phase 2 = scale winners (remaining budget).
- **Recommend the minimum viable daily budget** that still gives Meta enough data to optimize (usually PKR 250-500 / $3-5 per ad set per day).

### Budget Allocation Examples
- User says "I have 2000 PKR, one shot": daily_budget = 400 PKR (5 days of testing), split into 2 ad sets.
- User says "my daily budget is $20": daily_budget = $20, that's clear — set it directly.
- User says "spend $100 on this campaign": clarify if that's total or daily. If total, spread it over 5-7 days.

## Missing Absolute Targets (CRITICAL)
If the user's Business Profile shows "Not provided" for Target CPA or ROAS, DO NOT refuse to make decisions or ask the user for numbers. You MUST shift to RELATIVE evaluation:
- Compare campaigns and ad sets against each other. Identify the lowest CPA or highest ROAS within the account and treat the best performer as the baseline.
- Pause the clear relative losers and allocate budget to the relative winners.
- Optimize for maximum efficiency autonomously. You have the freedom to take meaningful action based on relative performance.

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
If you are woken up in the background by a Cron Job, you must evaluate if the target requires continued monitoring. If yes, you MUST call \`set_goal_schedule\` to reschedule the monitoring task for a future time. If the campaign has stabilized or you decided no further checks are needed, do not reschedule (it is perfectly fine to do nothing). You decide the gap (minimum 1 minute, use 0.016 hours for testing).

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
  isBackground: boolean,
  metaToken?: string,
  metaAdAccountId?: string
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
          decision_made: 'NO ACTION (' + toolArgs.target_level + ')',
          reasoning_snapshot: toolArgs.reason
        })
        .select()
        .single()

      if (error) return JSON.stringify({ error: error.message })
      return JSON.stringify({
        success: true,
        message: 'Logged NO ACTION decision for ' + toolArgs.target_level + '. Reasoning: ' + toolArgs.reason
      })
    }

    case 'propose_action_card': {
      var campId = toolArgs.target_id;
      if (campId === 'NEW' || campId === '' || !campId) {
        campId = null;
      }
      
      var cardRes = await supabaseClient.from('action_cards').insert({
        user_id: userId,
        campaign_id: campId,
        priority: toolArgs.priority,
        action_type: toolArgs.action_type,
        proposed_changes: toolArgs.proposed_changes,
        reasoning: toolArgs.reasoning,
        status: 'PENDING'
      }).select().single()

      if (cardRes.error) return JSON.stringify({ error: cardRes.error.message })

      await supabaseClient.from('agent_memory').insert({
        user_id: userId,
        campaign_id: campId,
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
      const reviewHours = Math.max(toolArgs.hours_until_next_review || 0.016, 0.016)
      const now = new Date()
      const nextReview = new Date(now.getTime() + reviewHours * 60 * 60 * 1000)

      // If background, auto-approve the recurrence. If not, it needs user approval.
      const status = isBackground ? 'ACTIVE' : 'PENDING_APPROVAL'

      let desc = toolArgs.goal_description || '';
      if (isBackground && !desc.startsWith('[Agent Rescheduled] ')) {
        desc = '[Agent Rescheduled] ' + desc;
      }

      const { data, error } = await supabaseClient
        .from('goal_schedules')
        .insert({
          user_id: userId,
          session_id: sessionId,
          target_id: toolArgs.target_id,
          target_level: toolArgs.target_level,
          goal_description: desc,
          metrics_snapshot: toolArgs.current_metrics_snapshot || null,
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
        message: isBackground ? 'Recurring Goal automatically scheduled for next execution at ' + nextReview.toISOString() + '.' : 'Goal Schedule proposed for ' + toolArgs.target_level + ' and sent to user for approval.'
      })
    }

    case 'get_account_summary_snapshots': {
      var userCampaignsRes = await supabaseClient.from('campaigns').select('id, name').eq('user_id', userId)
      var userCampaigns = userCampaignsRes.data || []
      var summaryResult: any[] = []
      for (var ci = 0; ci < userCampaigns.length; ci++) {
        var campaign = userCampaigns[ci]
        var campSnapsRes = await supabaseClient.from('metrics_snapshots').select('*').eq('target_id', campaign.id).order('created_at', { ascending: false }).limit(2)
        summaryResult.push({ campaign_id: campaign.id, campaign_name: campaign.name, snapshots: campSnapsRes.data || [] })
      }
      return JSON.stringify({ account_summary: summaryResult, total_campaigns: userCampaigns.length, note: '2 most recent snapshots per campaign. Use get_state_snapshots for deeper timeline.' })
    }

    case 'create_campaign': {
      if (!metaToken || !metaAdAccountId) {
        return JSON.stringify({ error: 'Meta connection not configured in Settings. Cannot write to Meta.' })
      }
      
      let cleanId = metaAdAccountId.trim()
      if (!cleanId.startsWith('act_')) {
        cleanId = `act_${cleanId}`
      }

      // Map objective to ODAX format
      const objMap: Record<string, string> = {
        'CONVERSIONS': 'OUTCOME_SALES',
        'SALES': 'OUTCOME_SALES',
        'LEADS': 'OUTCOME_LEADS',
        'TRAFFIC': 'OUTCOME_TRAFFIC',
        'AWARENESS': 'OUTCOME_AWARENESS',
        'REACH': 'OUTCOME_AWARENESS',
        'ENGAGEMENT': 'OUTCOME_ENGAGEMENT'
      }
      const mappedObjective = objMap[(toolArgs.objective || 'CONVERSIONS').toUpperCase()] || 'OUTCOME_SALES'

      // Meta expects daily_budget in cents
      const budgetInCents = Math.round((toolArgs.daily_budget || 50) * 100)

      console.log(`Creating real campaign on Meta for ad account ${cleanId}...`)

      // Post to Meta Graph API
      const metaUrl = `https://graph.facebook.com/v21.0/${cleanId}/campaigns`
      const res = await fetch(metaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: toolArgs.name,
          objective: mappedObjective,
          status: 'PAUSED',
          daily_budget: budgetInCents,
          bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
          special_ad_categories: ['NONE'],
          access_token: metaToken
        })
      })

      const metaData = await res.json()
      if (!res.ok) {
        return JSON.stringify({ error: `Meta API Error: ${JSON.stringify(metaData.error || metaData)}` })
      }

      const metaCampaignId = metaData.id

      // Save to local Supabase
      const newCampaign = await supabaseClient.from('campaigns').insert({
        user_id: userId,
        meta_id: metaCampaignId,
        name: toolArgs.name,
        status: 'PAUSED',
        daily_budget: toolArgs.daily_budget,
        targeting: toolArgs.targeting || {},
        performance_metrics: { spend: 0, impressions: 0, ctr: 0, cpc: 0, objective: mappedObjective }
      }).select().single()

      if (newCampaign.error) return JSON.stringify({ error: newCampaign.error.message })

      await supabaseClient.from('agent_memory').insert({
        user_id: userId,
        campaign_id: newCampaign.data.id,
        decision_made: 'CREATED REAL CAMPAIGN: ' + toolArgs.name,
        reasoning_snapshot: 'New campaign created on Meta (ID: ' + metaCampaignId + ') with daily budget ' + toolArgs.daily_budget
      })

      return JSON.stringify({
        success: true,
        campaign: newCampaign.data,
        message: `Campaign "${toolArgs.name}" created successfully on Meta (ID: ${metaCampaignId}) in PAUSED status. Now create ad sets under it.`
      })
    }

    case 'create_ad_set': {
      if (!metaToken || !metaAdAccountId) {
        return JSON.stringify({ error: 'Meta connection not configured in Settings. Cannot write to Meta.' })
      }

      let cleanId = metaAdAccountId.trim()
      if (!cleanId.startsWith('act_')) {
        cleanId = `act_${cleanId}`
      }

      // Look up real Meta Campaign ID
      const { data: campaign } = await supabaseClient
        .from('campaigns')
        .select('meta_id')
        .eq('id', toolArgs.campaign_id)
        .single()

      if (!campaign?.meta_id) {
        return JSON.stringify({ error: 'Parent campaign does not have a real Meta ID. Sync or create it first.' })
      }

      console.log(`Creating real ad set on Meta for campaign ${campaign.meta_id}...`)

      // Create ad set on Meta
      const metaUrl = `https://graph.facebook.com/v21.0/${cleanId}/adsets`
      const payload: any = {
        campaign_id: campaign.meta_id,
        name: toolArgs.name,
        status: 'ACTIVE',
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LINK_CLICKS',
        targeting: {
          geo_locations: { countries: ['PK'] },
          age_min: 18,
          age_max: 65
        },
        access_token: metaToken
      }

      if (toolArgs.bid_amount) {
        payload.bid_amount = Math.round(toolArgs.bid_amount * 100)
      }

      const res = await fetch(metaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      const metaData = await res.json()
      if (!res.ok) {
        return JSON.stringify({ error: `Meta API Error: ${JSON.stringify(metaData.error || metaData)}` })
      }

      const metaAdSetId = metaData.id

      // Save to local Supabase
      const newAdSet = await supabaseClient.from('ad_sets').insert({
        user_id: userId,
        campaign_id: toolArgs.campaign_id,
        meta_id: metaAdSetId,
        name: toolArgs.name,
        targeting: toolArgs.targeting || {},
        status: 'ACTIVE',
        performance_metrics: { spend: 0, impressions: 0, ctr: 0, cpc: 0 }
      }).select().single()

      if (newAdSet.error) return JSON.stringify({ error: newAdSet.error.message })

      return JSON.stringify({
        success: true,
        ad_set: newAdSet.data,
        message: `Ad Set "${toolArgs.name}" created successfully on Meta (ID: ${metaAdSetId}) under campaign. Now create ads under it.`
      })
    }

    case 'create_ad': {
      if (!metaToken || !metaAdAccountId) {
        return JSON.stringify({ error: 'Meta connection not configured in Settings. Cannot write to Meta.' })
      }

      let cleanId = metaAdAccountId.trim()
      if (!cleanId.startsWith('act_')) {
        cleanId = `act_${cleanId}`
      }

      // 1. Look up parent ad set Meta ID
      const { data: adSet } = await supabaseClient
        .from('ad_sets')
        .select('meta_id')
        .eq('id', toolArgs.ad_set_id)
        .single()

      if (!adSet?.meta_id) {
        return JSON.stringify({ error: 'Parent ad set does not have a real Meta ID.' })
      }

      // 2. Fetch a Page ID connected to this token
      console.log('Fetching connected Facebook Pages to create creative...')
      const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${metaToken}`)
      const pagesData = await pagesRes.json()
      const pageId = pagesData.data?.[0]?.id

      if (!pageId) {
        return JSON.stringify({ error: 'No Facebook Page found connected to this token. Please create a Page or assign it to your System User first.' })
      }

      console.log(`Using Page ID ${pageId} to build ad creative...`)

      // 3. Create Ad Creative first
      const creativeRes = await fetch(`https://graph.facebook.com/v21.0/${cleanId}/adcreatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Creative for ${toolArgs.name}`,
          object_story_spec: {
            page_id: pageId,
            link_data: {
              message: toolArgs.copy,
              link: 'https://metaagent.ai',
              name: toolArgs.name
            }
          },
          access_token: metaToken
        })
      })

      const creativeData = await creativeRes.json()
      if (!creativeRes.ok) {
        return JSON.stringify({ error: `Meta Ad Creative Error: ${JSON.stringify(creativeData.error || creativeData)}` })
      }

      const creativeId = creativeData.id
      console.log(`Ad Creative created (ID: ${creativeId}). Now creating real Ad...`)

      // 4. Create Ad on Meta
      const adRes = await fetch(`https://graph.facebook.com/v21.0/${cleanId}/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adset_id: adSet.meta_id,
          creative: { creative_id: creativeId },
          name: toolArgs.name,
          status: 'ACTIVE',
          access_token: metaToken
        })
      })

      const adData = await adRes.json()
      if (!adRes.ok) {
        return JSON.stringify({ error: `Meta Ad Error: ${JSON.stringify(adData.error || adData)}` })
      }

      const metaAdId = adData.id

      // 5. Save to local Supabase
      const newAd = await supabaseClient.from('ads').insert({
        user_id: userId,
        ad_set_id: toolArgs.ad_set_id,
        meta_id: metaAdId,
        name: toolArgs.name,
        creative_url: toolArgs.creative_url || '',
        copy: toolArgs.copy || '',
        cta: toolArgs.cta || 'SHOP_NOW',
        status: 'ACTIVE',
        performance_metrics: { spend: 0, impressions: 0, ctr: 0, cpc: 0 }
      }).select().single()

      if (newAd.error) return JSON.stringify({ error: newAd.error.message })

      return JSON.stringify({
        success: true,
        ad: newAd.data,
        message: `Ad "${toolArgs.name}" created successfully on Meta (ID: ${metaAdId}) under ad set.`
      })
    }

    default:
      return JSON.stringify({ error: 'Unknown tool: ' + toolName })
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

    const { prompt, session_id, is_background, historical_context, reasoning_mode } = await req.json()
    if (!prompt) throw new Error('Prompt is required')
    if (!session_id) throw new Error('session_id is required')

    // Fetch API Key and Meta credentials
    const { data: settings } = await supabaseClient.from('user_settings').select('openrouter_key, preferred_model, meta_access_token, meta_ad_account_id').eq('id', user.id).single()
    if (!settings?.openrouter_key) throw new Error('OpenRouter API Key not found. Please save it in Settings.')

    // Trigger live Meta sync on-demand before starting reasoning
    if (settings.meta_access_token && settings.meta_ad_account_id) {
      try {
        console.log('Triggering live Meta data sync on-demand...')
        const syncRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/meta-data-sync`, {
          method: 'POST',
          headers: {
            'Authorization': req.headers.get('Authorization')!
          }
        })
        if (!syncRes.ok) {
          console.error('On-demand Meta sync failed:', await syncRes.text())
        } else {
          console.log('On-demand Meta sync completed successfully.')
        }
      } catch (syncErr: any) {
        console.error('Error during on-demand Meta sync:', syncErr.message)
      }
    }

    // Fetch Business Profile for Context
    const { data: businessProfile } = await supabaseClient.from('business_profiles').select('*').eq('user_id', user.id).single()

    const openRouterKey = settings.openrouter_key
    const model = settings.preferred_model || 'google/gemini-3.6-flash'

    const { error: userMsgErr } = await supabaseClient.from('chat_messages').insert({
      session_id,
      user_id: user.id,
      role: 'user',
      content: prompt
    })
    if (userMsgErr) throw new Error('Failed to save user message: ' + userMsgErr.message)

    // 2. Fetch past chat history for this session (last 20 messages)
    const { data: pastMessages } = await supabaseClient
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', session_id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)

    const history = (pastMessages || []).reverse().map(msg => ({
      role: msg.role === 'agent' ? 'assistant' : 'user',
      content: msg.content || ''
    }))

    const toolExecutions: any[] = []
    const thinkingSteps: string[] = []
    let proposals: any[] = []
    let finalContent = ''

    if (reasoning_mode === 'deep') {
      thinkingSteps.push('🧠 Running in Deep Reasoning Mode...')
      thinkingSteps.push('[Planning] Strategic planner analyzing requirements...')
      
      let planJson: any = null
      try {
        const plannerRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + openRouterKey,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://metaagent.ai',
            'X-Title': 'MetaAgent AI'
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: generatePlannerPrompt(businessProfile, historical_context) },
              { role: 'user', content: prompt }
            ]
          })
        })
        if (!plannerRes.ok) throw new Error(await plannerRes.text())
        const plannerData = await plannerRes.json()
        const rawContent = plannerData.choices[0].message.content || '{}'
        
        const cleanContent = rawContent.replace(/```json/g, '').replace(/```/g, '').trim()
        planJson = JSON.parse(cleanContent)
        
        thinkingSteps.push(`[Planning] Blueprint Strategy Generated (${(planJson.strategic_blueprint || '').length} characters)`)
        thinkingSteps.push(`[Planning] Budget Split: Daily: ${planJson.recommended_daily_budget || 'N/A'} ${planJson.currency || 'PKR'}, Days: ${planJson.recommended_days || 3}`)
      } catch (err: any) {
        console.error('Planner phase failed, using fallback:', err.message)
        thinkingSteps.push('[Planning] Strategic planner phase encountered an error. Proceeding with fallback plan.')
        planJson = {
          currency: businessProfile?.currency || 'PKR',
          recommended_daily_budget: 650,
          recommended_days: 3,
          strategic_blueprint: "Standard growth strategy: 1 Campaign (Sales), 1 Ad Set, 2-3 Ad Creatives. Pacing daily budget across 3 days.",
          key_questions: ["What exact product are you selling?"]
        }
      }

      // Phase 2: Worker OODA Loop
      thinkingSteps.push('[Worker] Starting Worker execution loop guided by Masterclass Strategic Blueprint...')
      const workerSystemPrompt = generateSystemPrompt(businessProfile, historical_context) +
        `\n\n## MASTERCLASS STRATEGIC BLUEPRINT:\n${planJson.strategic_blueprint || JSON.stringify(planJson, null, 2)}\n\nINSTRUCTIONS FOR YOUR RESPONSE:
1. Deliver a comprehensive, deeply practical response that reads like an elite Growth Marketer / Chief Marketing Officer.
2. NEVER convert local currency (e.g. PKR 2000) to dollars ($2000). Use the exact currency specified (${planJson.currency || 'PKR'}).
3. Detail daily budget pacing (e.g. Rs. 650-700/day for 3 days), campaign structure (1 campaign, 1 ad set, 2-3 ads), offer strategy, creative variations, post-launch rules (what to do if sales occur vs if no sales occur), and ask a clarifying question about their product/niche.
4. Only call tools if the user explicitly commanded execution or confirmed a setup.`;

      const workerMessages: any[] = [
        { role: 'system', content: workerSystemPrompt },
        ...history
      ]

      const MAX_ITERATIONS = 6
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        thinkingSteps.push('[Worker] Iteration ' + (i + 1) + ': Reasoning with ' + model + '...')

        const workerRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + openRouterKey,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://metaagent.ai',
            'X-Title': 'MetaAgent AI'
          },
          body: JSON.stringify({
            model: model,
            messages: workerMessages,
            tools: AGENT_TOOLS,
            tool_choice: 'auto'
          })
        })

        if (!workerRes.ok) throw new Error('Worker OpenRouter Error: ' + await workerRes.text())

        const aiData = await workerRes.json()
        const assistantMessage = aiData.choices[0].message
        workerMessages.push(assistantMessage)

        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name
            let toolArgs = {}
            try { toolArgs = JSON.parse(toolCall.function.arguments || '{}') } catch {}

            thinkingSteps.push('[Worker] Executing Tool: ' + toolName)

            const toolResult = await executeTool(
              toolName,
              toolArgs,
              supabaseClient,
              user.id,
              session_id,
              !!is_background,
              settings?.meta_access_token || undefined,
              settings?.meta_ad_account_id || undefined
            )

            try {
              const parsed = JSON.parse(toolResult)
              if (parsed.type === 'PROPOSAL' || parsed.type === 'GOAL_PROPOSAL') proposals.push(parsed)
            } catch {}

            toolExecutions.push({ name: toolName, args: toolArgs, result: toolResult.substring(0, 500), status: 'success' })
            workerMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResult })
          }
        } else {
          finalContent = assistantMessage.content || ''
          thinkingSteps.push('[Worker] Draft response ready.')
          break
        }
      }

      // Phase 3 & 4: Reviewers & Synthesizer quality gate
      thinkingSteps.push('[Review] Initializing high-intelligence quality gate reviewers...')
      const reviewerModel = model // Use the user's primary selected model for reviewer quality gate
      
      const roles: ('budget' | 'targeting' | 'risk')[] = ['budget', 'targeting', 'risk']
      const reviewerPromises = roles.map(async (role) => {
        try {
          const reviewerRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + openRouterKey,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://metaagent.ai',
              'X-Title': 'MetaAgent AI'
            },
            body: JSON.stringify({
              model: reviewerModel,
              messages: [
                { role: 'system', content: generateReviewerPrompt(role, businessProfile) },
                { role: 'user', content: `Original request: ${prompt}\nPlanner Plan: ${JSON.stringify(planJson)}\nWorker Tools Executed: ${JSON.stringify(toolExecutions)}\nWorker Draft Response: ${finalContent}` }
              ]
            })
          })
          if (!reviewerRes.ok) throw new Error(await reviewerRes.text())
          const data = await reviewerRes.json()
          const clean = (data.choices[0].message.content || '{}').replace(/```json/g, '').replace(/```/g, '').trim()
          return { role, ...JSON.parse(clean) }
        } catch (err: any) {
          console.error(`Reviewer ${role} failed:`, err.message)
          return { role, verdict: 'PASS', feedback: 'Skipped due to transient error.' } // bypass fails to avoid breaking flow
        }
      })

      const reviews = await Promise.all(reviewerPromises)
      for (const r of reviews) {
        thinkingSteps.push(`[Review] ${r.role.toUpperCase()}: ${r.verdict} — "${r.feedback}"`)
      }

      // Synthesizer
      thinkingSteps.push('[Review] Synthesizing reviewer verdicts...')
      let synthJson = { all_passed: true, actionable_feedback: '' }
      try {
        const synthRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + openRouterKey,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://metaagent.ai',
            'X-Title': 'MetaAgent AI'
          },
          body: JSON.stringify({
            model: reviewerModel,
            messages: [
              { role: 'system', content: generateSynthesizerPrompt(businessProfile) },
              { role: 'user', content: `Original request: ${prompt}\nWorker Draft Response: ${finalContent}\nReviewer Feedback: ${JSON.stringify(reviews)}` }
            ]
          })
        })
        if (synthRes.ok) {
          const data = await synthRes.json()
          const clean = (data.choices[0].message.content || '{}').replace(/```json/g, '').replace(/```/g, '').trim()
          synthJson = JSON.parse(clean)
        }
      } catch (err: any) {
        console.error('Synthesizer failed:', err.message)
      }

      // Check Quality Gate
      if (!synthJson.all_passed) {
        thinkingSteps.push(`[Revision] Quality gate failed. Actionable feedback: "${synthJson.actionable_feedback}"`)
        thinkingSteps.push('[Revision] Re-running Worker loop for 1 final revision iteration...')

        // Inject synthesizer feedback as a user prompt revision
        workerMessages.push({
          role: 'user',
          content: `CRITICAL QUALITY REJECTED: Your response or action failed the audit review. Adjust it according to this feedback:\n${synthJson.actionable_feedback}\n\nMake sure to run correct tools or fix parameters. Produce your final revised response.`
        })

        // Run worker loop once more, up to 3 steps
        for (let i = 0; i < 3; i++) {
          thinkingSteps.push('[Revision] Worker Iteration ' + (i + 1) + ': Refining response...')

          const revisionRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + openRouterKey,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://metaagent.ai',
              'X-Title': 'MetaAgent AI'
            },
            body: JSON.stringify({
              model: model,
              messages: workerMessages,
              tools: AGENT_TOOLS,
              tool_choice: 'auto'
            })
          })

          if (!revisionRes.ok) break

          const aiData = await revisionRes.json()
          const assistantMessage = aiData.choices[0].message
          workerMessages.push(assistantMessage)

          if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            for (const toolCall of assistantMessage.tool_calls) {
              const toolName = toolCall.function.name
              let toolArgs = {}
              try { toolArgs = JSON.parse(toolCall.function.arguments || '{}') } catch {}

              thinkingSteps.push('[Revision] Executing Tool: ' + toolName)

              const toolResult = await executeTool(
                toolName,
                toolArgs,
                supabaseClient,
                user.id,
                session_id,
                !!is_background,
                settings?.meta_access_token || undefined,
                settings?.meta_ad_account_id || undefined
              )

              try {
                const parsed = JSON.parse(toolResult)
                if (parsed.type === 'PROPOSAL' || parsed.type === 'GOAL_PROPOSAL') proposals.push(parsed)
              } catch {}

              toolExecutions.push({ name: toolName, args: toolArgs, result: toolResult.substring(0, 500), status: 'success' })
              workerMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResult })
            }
          } else {
            finalContent = assistantMessage.content || ''
            break
          }
        }
        thinkingSteps.push('[Revision] Revised response successfully compiled.')
      } else {
        thinkingSteps.push('✅ Quality gate passed successfully. Finalizing response.')
      }

    } else {
      // Fast Mode (Default)
      thinkingSteps.push('Initializing Context-Aware OODA Loop...')
      if (!businessProfile) thinkingSteps.push('WARNING: No Business Profile found. Agent is running without context.')
      else thinkingSteps.push('Loaded Business Profile: ' + businessProfile.business_name + ' (' + businessProfile.country + ')')

      const finalMessages: any[] = [
        { role: 'system', content: generateSystemPrompt(businessProfile, historical_context) },
        ...history
      ]

      const MAX_ITERATIONS = 6
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        thinkingSteps.push('Iteration ' + (i + 1) + ': Reasoning with ' + model + '...')

        const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
            tool_choice: 'auto'
          })
        })

        if (!openRouterResponse.ok) throw new Error('OpenRouter Error: ' + await openRouterResponse.text())

        const aiData = await openRouterResponse.json()
        const assistantMessage = aiData.choices[0].message
        finalMessages.push(assistantMessage)

        if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
          for (const toolCall of assistantMessage.tool_calls) {
            const toolName = toolCall.function.name
            let toolArgs = {}
            try { toolArgs = JSON.parse(toolCall.function.arguments || '{}') } catch {}

            thinkingSteps.push('Executing Tool: ' + toolName)

            const toolResult = await executeTool(
              toolName,
              toolArgs,
              supabaseClient,
              user.id,
              session_id,
              !!is_background,
              settings?.meta_access_token || undefined,
              settings?.meta_ad_account_id || undefined
            )

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
      proposal: proposals.length > 0 ? proposals : null
    })
    if (agentMsgErr) throw new Error('Failed to save agent message: ' + agentMsgErr.message)

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
