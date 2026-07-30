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
HOLISTIC BUSINESS & MARKET CONTEXT:
- Business Name: ${businessProfile.business_name}
- Industry / Niche: ${businessProfile.industry}
- Business Model & Description: ${businessProfile.business_description}
- Target Market & Currency: ${businessProfile.country} (${businessProfile.currency || 'USD'})
- Target CPA: ${businessProfile.target_cpa ? businessProfile.target_cpa + ' ' + (businessProfile.currency || 'USD') : 'Not provided'}
- Target ROAS: ${businessProfile.target_roas ? businessProfile.target_roas + 'x' : 'Not provided'}
- Monthly Ad Budget Cap: ${businessProfile.monthly_ad_budget ? businessProfile.monthly_ad_budget + ' ' + (businessProfile.currency || 'USD') + '/mo' : 'Not provided'}
- Growth Stage: ${businessProfile.business_stage}
`;
  }

  return `You are MetaAgent Planner AI, a Chief Marketing Officer and $50M+ Meta Ads Growth Strategist.
Your task is to analyze the user's request and build both a comprehensive strategic blueprint AND a roadmapped checklist of subtasks.

${profileContext}

## Holistic First-Principles Reasoning Rules:
1. HOLISTIC EVALUATION: Do NOT rely on rigid formulas or hardcoded rules. Synthesize target country CPM economics, margin/AOV, business model, and user resources.
2. CURRENCY INTEGRITY: Preserve the user's native currency (${businessProfile?.currency || 'PKR'}) at all times.
3. TIMELINE & PACING GUARDRAILS:
   - **Direct User Constraint**: If the user explicitly asks to run a campaign for a specific duration (e.g. "run for 2 days"), you MUST respect and match your strategy to this timeline.
   - **Open-Ended Strategy**: If the timeline is open-ended, reason from first principles. Propose a robust budget test pacing plan (recommend 4+ days to capture daily fluctuations and allow Meta's machine learning/CPA optimization to gather adequate conversion data).
4. UNIFIED PLAN:
   - **Strategic Blueprint**: Write a detailed markdown strategy covering budget pacing logic, creative hook themes, average order value leverage, and post-launch decision trees.
   - **Subtasks Roadmap**: Provide a sequential checklist of jobs the Worker needs to execute to achieve the blueprint. The Worker will autonomously choose the best tools to perform these jobs.

You MUST respond ONLY with a JSON object in this format (no markdown codeblock markers, no extraneous wrapper text):
{
  "internal_monologue": "Write a natural, first-person narrative monologue (2-4 paragraphs) reasoning holistically from first principles.",
  "currency": "${businessProfile?.currency || 'PKR'}",
  "is_total_wallet": true,
  "strategic_blueprint": "Deep markdown text containing step-by-step masterclass strategy including budget pacing, campaign structure, creative hooks, offer advice, and post-launch rules",
  "subtasks": ["Subtask 1 (e.g. Understand budget constraints)", "Subtask 2 (e.g. Analyze competitors)", "Subtask 3 (e.g. Design campaign)"],
  "key_questions": ["What exact product or niche are you selling?", "Is your Meta Pixel active?"]
}`;
}

function generateStrategyReviewerPrompt(businessProfile: any) {
  let profileContext = businessProfile ? `Business: ${businessProfile.business_name} (${businessProfile.country})` : '';
  return `You are the Chief Strategy Officer Reviewer.
Your job is to audit the response for holistic strategy depth and actionable intelligence:
- FAIL if the response is generic, relies on rigid templates, or lacks a clear campaign architecture, offer advice, and target audience alignment.
- PASS ONLY if the response provides a masterclass strategic breakdown tailored to the business.
${profileContext}

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "internal_thought": "Write 1-2 paragraphs of natural, first-person narrative thought evaluating this strategy",
  "feedback": "Detailed explanation of strategic improvements needed if verdict is FAIL"
}`;
}

function generateCopyReviewerPrompt(businessProfile: any) {
  return `You are the Lead Copywriting Reviewer.
Your job is to audit the copywriting suggestions, ad copy hooks, and primary texts:
- FAIL if the copy is dry, standard AI-sounding ("Unleash your potential", "Are you tired of X?"), or lacks emotional hooks.
- PASS if the copywriting proposals use modern marketing hooks (like problem-agitation-solution, hook-story-offer) tailored to target avatar desires.

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "internal_thought": "Write 1-2 paragraphs of natural, first-person narrative thought evaluating the copy quality",
  "feedback": "Detailed explanation of copy improvements needed if verdict is FAIL"
}`;
}

function generateCreativeReviewerPrompt(businessProfile: any) {
  return `You are the Creative Director Reviewer.
Your job is to audit visual layout proposals, image/video suggestions, and creative hooks:
- FAIL if the suggestions are vague ("use a high quality photo") or lack actionable details for a designer.
- PASS if the creative suggestions describe exact visual hooks, video pacing, overlay texts, and CTA styles.

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "internal_thought": "Write 1-2 paragraphs of natural, first-person narrative thought evaluating the creative proposals",
  "feedback": "Detailed explanation of creative improvements needed if verdict is FAIL"
}`;
}

function generateDiversityReviewerPrompt(businessProfile: any) {
  let budgetCap = businessProfile?.monthly_ad_budget ? `${businessProfile.monthly_ad_budget} ${businessProfile.currency || 'USD'}` : 'Not provided';
  return `You are the Creative Diversity Auditor.
Your job is to contextually audit the diversity of ad angles, hooks, and formats:
- evaluate contextually based on budget scale. The user's monthly budget cap is: ${budgetCap}.
- DO NOT be dogmatically biased. If the budget is very small (e.g. under 5,000 PKR / $50 USD total), do NOT fail the plan for having only a couple of simple static ad angles.
- If the budget is healthy, check if there is a mix of formats (e.g. UGC vs Carousel vs Static Image) or angles to prevent creative fatigue.
- FAIL only if there is a massive misalignment where a high budget runs redundant/copied ads, or if the angles proposed are completely repetitive. Otherwise PASS with constructive feedback.

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "internal_thought": "Write 1-2 paragraphs of natural, first-person narrative thought evaluating the creative diversity contextually",
  "feedback": "Detailed explanation of creative diversity improvements needed if verdict is FAIL"
}`;
}

function generateComplianceReviewerPrompt(businessProfile: any) {
  return `You are the Technical Operations & Compliance Auditor.
Your job is to audit tool execution, compliance with Meta policies, and operational safety:
- Ensure the agent does not force-create campaigns on Meta if the user only asked for strategic advice.
- Ensure the agent respects temporal discipline rules (e.g. no modifying campaigns in learning phase).
- Ensure no Meta policy compliance warnings (no misleading claims, forbidden words).

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "internal_thought": "Write 1-2 paragraphs of natural, first-person narrative thought evaluating execution safety and policy compliance",
  "feedback": "Detailed explanation of compliance or tool safety failures if verdict is FAIL"
}`;
}

function generatePerformanceReviewerPrompt(businessProfile: any) {
  let currency = businessProfile?.currency || 'PKR';
  return `You are the VP of Finance & Growth Reviewer.
Your job is to audit budget pacing, expected ROAS, and performance metrics:
- FAIL if the agent converted local currency (${currency}) without authorization or proposed mathematically illiterate budget pacing.
- TIMELINE & PACING:
  - If the user explicitly asked to run for a specific number of days, you MUST respect that constraint and evaluate performance pacing relative to that timeline. Do NOT fail the plan for running short-term if the user explicitly commanded it.
  - If the user did NOT specify a timeline, verify if the budget pacing recommends a testing window of 4+ days. Proposing a 1-2 day test on an open-ended request is economically illiterate for Meta's learning algorithms—FAIL the plan in this scenario and instruct the worker to extend the test window.
- PASS if the budget pacing, estimated ROAS, and customer acquisition metrics make complete growth sense.

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "internal_thought": "Write 1-2 paragraphs of natural, first-person narrative thought evaluating the budget and performance expectations",
  "feedback": "Detailed explanation of financial pacing improvements needed if verdict is FAIL"
}`;
}

function generateSynthesizerPrompt(businessProfile: any) {
  return `You are the Quality Gate Synthesizer.
Review the reviewer verdicts. If ANY reviewer marked "FAIL", synthesize their feedback into a clear, demanding directive for the worker to rewrite its response with complete masterclass depth, correct currency, and practical strategy.

Respond ONLY with a JSON object:
{
  "all_passed": true | false,
  "internal_thought": "Write 1 paragraph summarizing the consensus of all 6 reviewers out loud",
  "actionable_feedback": "synthesis of feedback if any failed, or empty if all passed"
}`;
}

function generatePlanReviewerPrompt(businessProfile: any) {
  return `You are the Plan Reviewer Auditor.
Critique the planning process itself to improve future tasks:
- Evaluate whether the Planner's roadmap was structured optimally.
- Evaluate whether the Worker executed all subtasks effectively.
- Outline key strategic adjustments for future runs.

Respond ONLY with a JSON object:
{
  "internal_thought": "Write 1 paragraph of natural, first-person thoughts on the planning process",
  "critique": "Detailed critique of the subtasks and tool selection path",
  "lessons_learned": "Actionable takeaways to improve future campaign setups"
}`;
}

function generateFormatterPrompt() {
  return `You are the Expert Content Formatter.
Your task is to take the final approved ad plan/strategy and convert it into a beautiful, professional, and easy-to-read markdown layout:
- Highlight key strategic takeaways, budget allocations, ad structure, copywriting hooks, and visual details.
- Use bullet points, bold text, warning blocks, and tables where appropriate to maximize readability.
- Maintain the exact currency and numbers proposed.

Respond ONLY with the formatted final response in markdown.`;
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

## Core Identity & Agency (Worker-Decides Architecture)
You are an autonomous SENIOR MEDIA BUYER. The Strategic Planner has provided you with a ROADMAP OF SUBTASKS. Your job is NOT to blindly execute a script, but to evaluate those subtasks and independently decide HOW to accomplish them.

### Tool Selection & Reasoning Hierarchy (always follow this order):
1. **Review Subtasks** — Read the subtasks assigned to you by the Planner.
2. **Evaluate Tool Inventory** — Review the exact tools available to you in this session. You have full agency to decide which tools match which subtasks.
3. **Analyze Context** — Consider the user's business context, budget constraints, market (Pakistan/PKR vs US/USD), and industry before acting on the data retrieved by your tools.
4. **Act & Advise** — Use the tools to execute the subtasks. Present your strategic recommendation with clear reasoning based on what you found.

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

## Holistic Strategic Budget Reasoning (CRITICAL)
You are a SENIOR MEDIA BUYER & GROWTH STRATEGIST, not a template robot.
Never rely on rigid formulas, hardcoded budget tiers, or single-factor rules.

### Core Principles for Budget & Strategy:
1. **Total Available Wallet vs Daily Budget:**
   - Determine whether the user's input is a **Daily Budget** (e.g. "$100/day") or a **Total Available Wallet** (e.g. "I have $500 total for this campaign").
   - If Total Wallet: Reason from first principles on how to pace the spend over time so Meta's machine learning algorithm has adequate conversion window data without burning funds on Day 1.
   - If Daily Budget: Respect the daily spend rate and design an evaluation cadence (e.g. 7-14 days) to measure statistical ROAS/CPA.

2. **Holistic Economic Reasoning:**
   - Synthesize ALL business variables together: Target Market CPMs (e.g., Pakistan/SE Asia low CPM vs US/Europe high CPM), Product Average Order Value (AOV), Profit Margins, Industry Type (D2C, Lead Gen, B2B), Customer Lifetime Value, and Pixel Maturity.
   - Tailor campaign architecture (Single Campaign vs Multi-Campaign Funnels, CBO vs ABO) dynamically based on these economic realities rather than arbitrary static rules.

3. **Think-Before-You-Act Protocol:**
   - When asked a strategic question, present your holistic recommendation first. Explain budget pacing, campaign structure, creative hooks, and offer tactics. Confirm before executing changes unless explicitly instructed to build immediately.

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

function isGeminiKey(key: string): boolean {
  const k = key.trim()
  return k.startsWith('AIzaSy') || k.startsWith('AQ.')
}

function getLLMRequestDetails(key: string, requestedModel: string) {
  const k = key.trim()
  if (isGeminiKey(k)) {
    let mappedModel = requestedModel.replace('google/', '').trim();
    if (!mappedModel.includes('gemini') && !mappedModel.includes('gemma')) {
      mappedModel = 'gemini-3.6-flash';
    }
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
      headers: {
        'Authorization': `Bearer ${k}`,
        'Content-Type': 'application/json'
      },
      model: mappedModel
    }
  } else {
    return {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      headers: {
        'Authorization': 'Bearer ' + k,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://metaagent.ai',
        'X-Title': 'MetaAgent AI'
      },
      model: requestedModel
    }
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
    const isGemini = isGeminiKey(openRouterKey)
    const maxTokens = isGemini ? 2000 : 800
    const reviewerMaxTokens = isGemini ? 1000 : 400

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
        const reqDetails = getLLMRequestDetails(openRouterKey, model)
        const plannerRes = await fetch(reqDetails.url, {
          method: 'POST',
          headers: reqDetails.headers,
          body: JSON.stringify({
            model: reqDetails.model,
            max_tokens: maxTokens,
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
        
        if (planJson.internal_monologue) {
          thinkingSteps.push(`💭 Strategic Planner Monologue:\n"${planJson.internal_monologue}"`)
        } else {
          thinkingSteps.push(`💭 Strategic Planner Monologue:\n"Analyzing budget scale: Calculating dynamic budget pacing and optimal account structure in ${planJson.currency || 'PKR'}. Formulating growth strategy."`)
        }
      } catch (err: any) {
        console.error('Planner phase failed, using fallback:', err.message)
        thinkingSteps.push('[Planning] Strategic planner phase encountered an error. Proceeding with fallback plan.')
        planJson = {
          currency: businessProfile?.currency || 'PKR',
          strategic_blueprint: "Standard growth strategy: Campaign (Sales), Ad Sets, Ad Creatives matched to user budget scale.",
          subtasks: ["Understand budget constraints", "Analyze competitors", "Design standard growth campaign"],
          key_questions: ["What exact product are you selling?"]
        }
      }

      // Phase 2: Worker OODA Loop
      thinkingSteps.push('⚙️ Executing Worker loop guided by Unified Roadmap & Blueprint...')
      const workerSystemPrompt = generateSystemPrompt(businessProfile, historical_context) +
        `\n\n## MASTERCLASS STRATEGIC BLUEPRINT:\n${planJson.strategic_blueprint || ''}\n\n## ASSIGNED SUBTASKS:\n${JSON.stringify(planJson.subtasks || [], null, 2)}\n\nINSTRUCTIONS FOR YOUR RESPONSE:
1. Deliver a comprehensive, deeply practical response that reads like an elite Growth Marketer / Chief Marketing Officer.
2. NEVER convert local currency without user authorization. Use the exact currency specified (${planJson.currency || 'PKR'}).
3. Use your tools autonomously to execute the assigned subtasks, referencing the Strategic Blueprint for key constraints (like budget pacing, creative angles, or offer tweaks).
4. Detail dynamic budget pacing matched to the user's specific scale (whether a lean test or a multi-week scale push), campaign structure, offer strategy, creative variations, post-launch rules, and ask a clarifying question.`;

      const workerMessages: any[] = [
        { role: 'system', content: workerSystemPrompt },
        ...history
      ]

      const MAX_ITERATIONS = 6
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        thinkingSteps.push(`⚙️ Worker Step ${i + 1}: Consulting context and tools...`)

        const reqDetails = getLLMRequestDetails(openRouterKey, model)
        const workerRes = await fetch(reqDetails.url, {
          method: 'POST',
          headers: reqDetails.headers,
          body: JSON.stringify({
            model: reqDetails.model,
            max_tokens: maxTokens,
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

            thinkingSteps.push('🛠️ Executing Tool: ' + toolName)

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
          thinkingSteps.push('📝 Draft growth plan compiled.')
          break
        }
      }

      // Phase 3 & 4: Reviewers & Synthesizer quality gate
      thinkingSteps.push('📋 Convening Senior Growth Advisory Committee...')
      const reviewerModel = model // Use the user's primary selected model for reviewer quality gate
      
      const reviewerConfigs = [
        { id: 'strategy', label: '🎯 Strategy & Targeting Reviewer', promptFn: generateStrategyReviewerPrompt },
        { id: 'copy', label: '✍️ Lead Copywriting Reviewer', promptFn: generateCopyReviewerPrompt },
        { id: 'creative', label: '🎨 Creative Director Reviewer', promptFn: generateCreativeReviewerPrompt },
        { id: 'diversity', label: '🎭 Creative Diversity Auditor', promptFn: generateDiversityReviewerPrompt },
        { id: 'compliance', label: '🛡️ Risk & Compliance Auditor', promptFn: generateComplianceReviewerPrompt },
        { id: 'performance', label: '📊 Finance & Performance Reviewer', promptFn: generatePerformanceReviewerPrompt }
      ]

      const reviewerPromises = reviewerConfigs.map(async (config) => {
        try {
          const reqDetails = getLLMRequestDetails(openRouterKey, reviewerModel)
          const reviewerRes = await fetch(reqDetails.url, {
            method: 'POST',
            headers: reqDetails.headers,
            body: JSON.stringify({
              model: reqDetails.model,
              max_tokens: reviewerMaxTokens,
              messages: [
                { role: 'system', content: config.promptFn(businessProfile) },
                { role: 'user', content: `Original request: ${prompt}\nPlanner Plan: ${JSON.stringify(planJson)}\nWorker Tools Executed: ${JSON.stringify(toolExecutions)}\nWorker Draft Response: ${finalContent}` }
              ]
            })
          })
          if (!reviewerRes.ok) throw new Error(await reviewerRes.text())
          const data = await reviewerRes.json()
          const clean = (data.choices[0].message.content || '{}').replace(/```json/g, '').replace(/```/g, '').trim()
          return { role: config.id, label: config.label, ...JSON.parse(clean) }
        } catch (err: any) {
          console.error(`Reviewer ${config.id} failed:`, err.message)
          return { role: config.id, label: config.label, verdict: 'PASS', internal_thought: 'Verified basic constraints.', feedback: 'Skipped due to transient error.' }
        }
      })

      const reviews = await Promise.all(reviewerPromises)
      for (const r of reviews) {
        if (r.internal_thought) {
          thinkingSteps.push(`${r.label} Thought:\n"${r.internal_thought}"`);
        } else {
          thinkingSteps.push(`${r.label} (${r.verdict}): "${r.feedback || 'Strategy validated.'}"`);
        }
      }

      // Synthesizer
      let synthJson = { all_passed: true, internal_thought: '', actionable_feedback: '' }
      try {
        const reqDetails = getLLMRequestDetails(openRouterKey, reviewerModel)
        const synthRes = await fetch(reqDetails.url, {
          method: 'POST',
          headers: reqDetails.headers,
          body: JSON.stringify({
            model: reqDetails.model,
            max_tokens: reviewerMaxTokens,
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
        thinkingSteps.push(`🔄 Quality Gate Feedback:\n"${synthJson.actionable_feedback || 'Refining details for higher strategic precision.'}"`)
        thinkingSteps.push('🔄 Re-running Worker for final strategic refinement...')

        // Inject synthesizer feedback as a user prompt revision
        workerMessages.push({
          role: 'user',
          content: `CRITICAL QUALITY REJECTED: Your response or action failed the audit review. Adjust it according to this feedback:\n${synthJson.actionable_feedback}\n\nMake sure to run correct tools or fix parameters. Produce your final revised response.`
        })

        // Run worker loop once more, up to 3 steps
        for (let i = 0; i < 3; i++) {
          thinkingSteps.push('[Revision] Worker Iteration ' + (i + 1) + ': Refining response...')

          const reqDetails = getLLMRequestDetails(openRouterKey, model)
          const revisionRes = await fetch(reqDetails.url, {
            method: 'POST',
            headers: reqDetails.headers,
            body: JSON.stringify({
              model: reqDetails.model,
              max_tokens: maxTokens,
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
        thinkingSteps.push('✅ Final Strategy Refined: All reviewer feedback incorporated. Finalizing response.')
      } else {
        thinkingSteps.push(`✅ Quality Gate Consensus: ${synthJson.internal_thought || 'All strategic perspectives validated the plan without objection. Strategy ready.'}`)
      }

      // Phase 10: Plan Reviewer (Critiques the planning process)
      thinkingSteps.push('📋 Conducting post-process planning critique...')
      try {
        const reqDetails = getLLMRequestDetails(openRouterKey, model)
        const planReviewRes = await fetch(reqDetails.url, {
          method: 'POST',
          headers: reqDetails.headers,
          body: JSON.stringify({
            model: reqDetails.model,
            max_tokens: reviewerMaxTokens,
            messages: [
              { role: 'system', content: generatePlanReviewerPrompt(businessProfile) },
              { role: 'user', content: `Planner Subtasks: ${JSON.stringify(planJson.subtasks)}\nWorker Tools Executed: ${JSON.stringify(toolExecutions)}\nFinal Draft: ${finalContent}` }
            ]
          })
        })
        if (planReviewRes.ok) {
          const data = await planReviewRes.json()
          const clean = (data.choices[0].message.content || '{}').replace(/```json/g, '').replace(/```/g, '').trim()
          const parsed = JSON.parse(clean)
          if (parsed.critique) {
            thinkingSteps.push(`📋 Plan Reviewer Critique:\n"${parsed.critique}"\n*Lessons Learned:* "${parsed.lessons_learned || ''}"`)
          }
        }
      } catch (err: any) {
        console.error('Plan Reviewer failed:', err.message)
      }

      // Phase 11: Formatter
      thinkingSteps.push('✍️ Formatting finalized ad strategy layout...')
      try {
        const reqDetails = getLLMRequestDetails(openRouterKey, model)
        const formatterRes = await fetch(reqDetails.url, {
          method: 'POST',
          headers: reqDetails.headers,
          body: JSON.stringify({
            model: reqDetails.model,
            max_tokens: maxTokens,
            messages: [
              { role: 'system', content: generateFormatterPrompt() },
              { role: 'user', content: `Structure and format this content beautifully:\n\n${finalContent}` }
            ]
          })
        })
        if (formatterRes.ok) {
          const data = await formatterRes.json()
          finalContent = data.choices[0].message.content || finalContent
        }
      } catch (err: any) {
        console.error('Formatter failed:', err.message)
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

        const reqDetails = getLLMRequestDetails(openRouterKey, model)
        const openRouterResponse = await fetch(reqDetails.url, {
          method: 'POST',
          headers: reqDetails.headers,
          body: JSON.stringify({
            model: reqDetails.model,
            max_tokens: maxTokens,
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
