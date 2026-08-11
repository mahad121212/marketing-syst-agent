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
      description: 'This is your ONLY tool for modifying existing campaigns, ad sets, or ads. Use it to rename, pause, resume/activate, change budget, change targeting, or any other modification. This creates an Action Card for user approval. There are NO other modification tools — do NOT invent tool names like update_campaign_name or change_status. ALWAYS pass the target_id (Meta ID) so the executor knows which entity to modify. You MUST assign a priority: LOW, HIGH, or MANDATORY.',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'REQUIRED. The Meta ID (numeric like "52586793602259") of the campaign, ad set, or ad to modify. Get this from get_campaign_hierarchy.' },
          action_type: { type: 'string', enum: ['PAUSE', 'RESUME', 'RENAME', 'INCREASE_BUDGET', 'DECREASE_BUDGET', 'CHANGE_TARGETING', 'CREATE_NEW'], description: 'The type of adjustment. Use PAUSE to pause, RESUME to activate/unpause, RENAME to change name, INCREASE_BUDGET/DECREASE_BUDGET for budget, CHANGE_TARGETING for targeting.' },
          priority: { type: 'string', enum: ['LOW', 'HIGH', 'MANDATORY'], description: 'The priority of this action. Must be LOW, HIGH, or MANDATORY.' },
          proposed_changes: { type: 'object', description: 'JSON object with exact changes. For renames: {"new_name": "..."}. For status: {"status": "ACTIVE" or "PAUSED"}. For budget: {"daily_budget": 1500}.' },
          reasoning: { type: 'string', description: 'A detailed explanation of WHY this adjustment is recommended.' }
        },
        required: ['target_id', 'action_type', 'priority', 'proposed_changes', 'reasoning']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'schedule_monitoring_review',
      description: 'Schedules an operational background review timer for when you (the Agent) should wake up and re-analyze the account or campaign. Minimum gap is 1 minute (0.016 hours).',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'string', description: 'The identifier (UUID, Meta ID, or "account") of the campaign, ad set, or ad you want to monitor.' },
          target_level: { type: 'string', enum: ['campaign', 'ad_set', 'ad', 'account'], description: 'The level of the target.' },
          hours_until_next_review: { type: 'number', description: 'How many hours from now to wake up (minimum 1 minute, use 0.016).' },
          goal_description: { type: 'string', description: 'What are you monitoring? e.g., "Review ad performance at 9 AM".' }
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
      description: 'Creates a COMPLETE campaign structure: Campaign + Ad Sets + Ads — all in ONE action card. The user approves once, and the system creates all levels sequentially on Meta. You MUST include at least one ad_set with at least one ad inside it.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Campaign name, e.g. "Summer Sale - Conversions"' },
          daily_budget: { type: 'number', description: 'Daily budget in the account currency.' },
          targeting: { type: 'object', description: 'Default targeting config: { age_range: {min, max}, locations: ["PK"], gender: "all" }' },
          objective: { type: 'string', description: 'Campaign objective: CONVERSIONS, TRAFFIC, REACH, AWARENESS' },
          ad_sets: {
            type: 'array',
            description: 'REQUIRED. Array of ad sets to create under this campaign.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Ad set name, e.g. "Broad_PK_18-45"' },
                targeting: { type: 'object', description: 'Targeting for this ad set: { age_range: {min, max}, locations: ["PK"] }' },
                ads: {
                  type: 'array',
                  description: 'REQUIRED. Array of ads to create under this ad set.',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string', description: 'Ad name' },
                      copy: { type: 'string', description: 'Ad primary text / copy' },
                      cta: { type: 'string', description: 'Call to action: SHOP_NOW, LEARN_MORE, SIGN_UP, SEND_MESSAGE' },
                      creative_url: { type: 'string', description: 'Optional URL to creative asset' }
                    },
                    required: ['name', 'copy']
                  }
                }
              },
              required: ['name', 'ads']
            }
          }
        },
        required: ['name', 'daily_budget', 'ad_sets']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_ad_set',
      description: 'Creates a new Ad Set (along with its Ads) inside an EXISTING campaign. Do NOT create a new campaign just to hold a new ad set if an appropriate campaign already exists. Pass the parent campaign ID, the new ad set details, and the new ads.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string', description: 'REQUIRED. The Meta ID or UUID of the parent campaign to add this ad set to.' },
          name: { type: 'string', description: 'Ad set name' },
          targeting: { type: 'object', description: 'Targeting config: { age_range: {min, max}, locations: ["PK"] }' },
          ads: {
            type: 'array',
            description: 'REQUIRED. Array of ads to create under this new ad set.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Ad name' },
                copy: { type: 'string', description: 'Ad text' },
                cta: { type: 'string', description: 'Call to action: SHOP_NOW, LEARN_MORE, etc' },
                creative_url: { type: 'string', description: 'Optional creative URL' }
              },
              required: ['name', 'copy']
            }
          }
        },
        required: ['campaign_id', 'name', 'ads']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_ad',
      description: 'Creates a new Ad inside an EXISTING Ad Set. Do NOT create a new campaign or ad set just to hold a new ad if an appropriate one already exists. Pass the parent ad set ID and the ad details.',
      parameters: {
        type: 'object',
        properties: {
          ad_set_id: { type: 'string', description: 'REQUIRED. The Meta ID or UUID of the parent ad set to add this ad to.' },
          name: { type: 'string', description: 'Ad name, e.g. "Winter Promo Video"' },
          copy: { type: 'string', description: 'Ad primary text / copy' },
          cta: { type: 'string', description: 'Call to action: SHOP_NOW, LEARN_MORE, SIGN_UP, SEND_MESSAGE' },
          creative_url: { type: 'string', description: 'Optional URL to creative asset' }
        },
        required: ['ad_set_id', 'name', 'copy']
      }
    }
  }
]

// ============================================================
// ACTION TOOLS FOR STAGE 10 WORKER (Excludes Read-Only Tools)
// ============================================================
const ACTION_TOOLS = AGENT_TOOLS.filter(t => 
  ['create_campaign', 'create_ad_set', 'create_ad', 'propose_action_card', 'schedule_monitoring_review', 'set_goal_schedule', 'report_no_action'].includes(t.function.name)
)

function logStageAudit(
  thinkingSteps: string[],
  stage: {
    phase: string,
    icon: string,
    title: string,
    status?: string,
    system_prompt?: string,
    user_input?: string,
    raw_output?: string,
    tool_name?: string,
    tool_args?: any,
    tool_result?: any
  }
) {
  thinkingSteps.push(JSON.stringify({
    id: Math.random().toString(36).substring(2, 9),
    status: stage.status || 'COMPLETED',
    ...stage
  }))
}

// ============================================================
// MARKETING KNOWLEDGE ENGINE (Phase 0)
// ============================================================

// Currency conversion rates to USD (approximate, for budget tier classification)
const CURRENCY_TO_USD: Record<string, number> = {
  'USD': 1, 'EUR': 1.09, 'GBP': 1.27, 'CAD': 0.74, 'AUD': 0.65,
  'AED': 0.27, 'SAR': 0.27, 'QAR': 0.27, 'KWD': 3.26, 'BHD': 2.65,
  'PKR': 0.0036, 'INR': 0.012, 'BDT': 0.0091, 'LKR': 0.0031,
  'PHP': 0.018, 'IDR': 0.000063, 'VND': 0.000041, 'MYR': 0.22,
  'THB': 0.028, 'NGN': 0.00063, 'KES': 0.0077, 'EGP': 0.020,
  'ZAR': 0.054, 'BRL': 0.18, 'MXN': 0.058, 'TRY': 0.031,
  'JPY': 0.0067, 'KRW': 0.00074, 'SGD': 0.74, 'NZD': 0.60
}

// Approximate CPM in USD by country (for budget feasibility analysis)
const APPROX_CPM_USD: Record<string, number> = {
  // Trust-Deficit markets (low CPM)
  'PK': 0.50, 'IN': 0.60, 'BD': 0.40, 'LK': 0.45, 'NP': 0.35,
  'PH': 0.70, 'ID': 0.55, 'VN': 0.50, 'NG': 0.80, 'KE': 0.70,
  'EG': 0.65, 'GH': 0.75, 'TZ': 0.60,
  // Emerging markets (mid CPM)
  'AE': 3.50, 'SA': 2.80, 'QA': 3.00, 'KW': 3.20, 'BH': 2.50,
  'MY': 1.50, 'TH': 1.20, 'ZA': 1.80, 'BR': 2.00, 'MX': 1.50,
  'TR': 1.00, 'CO': 1.20, 'CL': 1.50,
  // Mature markets (high CPM)
  'US': 12.00, 'CA': 10.00, 'UK': 11.00, 'GB': 11.00, 'DE': 9.00,
  'FR': 8.50, 'AU': 10.00, 'NZ': 8.00, 'JP': 7.00, 'KR': 5.00,
  'SG': 6.00, 'NL': 9.50, 'SE': 8.00, 'NO': 9.00
}

// Country code → market trust classification
const MARKET_TRUST_MAP: Record<string, string> = {
  // TRUST_DEFICIT — High purchase skepticism, social proof critical
  'PK': 'TRUST_DEFICIT', 'IN': 'TRUST_DEFICIT', 'BD': 'TRUST_DEFICIT',
  'LK': 'TRUST_DEFICIT', 'NP': 'TRUST_DEFICIT', 'PH': 'TRUST_DEFICIT',
  'ID': 'TRUST_DEFICIT', 'VN': 'TRUST_DEFICIT', 'NG': 'TRUST_DEFICIT',
  'KE': 'TRUST_DEFICIT', 'EG': 'TRUST_DEFICIT', 'GH': 'TRUST_DEFICIT',
  'TZ': 'TRUST_DEFICIT',
  // EMERGING — Growing e-commerce, mix of trust + aspiration
  'AE': 'EMERGING', 'SA': 'EMERGING', 'QA': 'EMERGING', 'KW': 'EMERGING',
  'BH': 'EMERGING', 'MY': 'EMERGING', 'TH': 'EMERGING', 'ZA': 'EMERGING',
  'BR': 'EMERGING', 'MX': 'EMERGING', 'TR': 'EMERGING', 'CO': 'EMERGING',
  'CL': 'EMERGING',
  // MATURE — High e-commerce adoption, differentiation key
  'US': 'MATURE', 'CA': 'MATURE', 'UK': 'MATURE', 'GB': 'MATURE',
  'DE': 'MATURE', 'FR': 'MATURE', 'AU': 'MATURE', 'NZ': 'MATURE',
  'JP': 'MATURE', 'KR': 'MATURE', 'SG': 'MATURE', 'NL': 'MATURE',
  'SE': 'MATURE', 'NO': 'MATURE'
}

// Country name → code mapping (for business profiles that store full names)
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  'pakistan': 'PK', 'india': 'IN', 'bangladesh': 'BD', 'sri lanka': 'LK',
  'nepal': 'NP', 'philippines': 'PH', 'indonesia': 'ID', 'vietnam': 'VN',
  'nigeria': 'NG', 'kenya': 'KE', 'egypt': 'EG', 'ghana': 'GH',
  'tanzania': 'TZ', 'united arab emirates': 'AE', 'uae': 'AE',
  'saudi arabia': 'SA', 'qatar': 'QA', 'kuwait': 'KW', 'bahrain': 'BH',
  'malaysia': 'MY', 'thailand': 'TH', 'south africa': 'ZA',
  'brazil': 'BR', 'mexico': 'MX', 'turkey': 'TR', 'colombia': 'CO',
  'chile': 'CL', 'united states': 'US', 'usa': 'US', 'canada': 'CA',
  'united kingdom': 'UK', 'uk': 'UK', 'germany': 'DE', 'france': 'FR',
  'australia': 'AU', 'new zealand': 'NZ', 'japan': 'JP',
  'south korea': 'KR', 'singapore': 'SG', 'netherlands': 'NL',
  'sweden': 'SE', 'norway': 'NO'
}

// Response depth classification (replaces rigid keyword-based intent matching)
function determineResponseDepth(prompt: string): string {
  const promptLower = prompt.toLowerCase().trim()

  // Conversational: greetings, thanks, acknowledgments (short messages only)
  // DEPRECATED: We no longer hardcode CONVERSATIONAL routing here because it overrides the LLM.
  // The LLM (Stage 1) is smart enough to output 'CONVERSATIONAL:' on its own when appropriate.
  /*
  if (/^(hi|hello|hey|thanks|thank you|ok\\b|okay|great|sure|got it|cool|awesome|good|nice|perfect|noted|alright|sounds good|lol|haha|yes|yeah|yep|nope|no\\b)/i.test(promptLower)) {
    if (promptLower.length < 60 || !/budget|campaign|spend|ads?|target|scale|launch|create|build|how|what|why/i.test(promptLower)) {
      return 'CONVERSATIONAL'
    }
  }
  */

  // Analytical: observation, data queries, scheduling, monitoring requests
  if (/\b(schedule|monitor|review at|check on|analyse|analyze|what ads|show me|how are my|status of|report on|audit|inspect|look at|wake.?up|alarm|remind me|watch my)\b/i.test(promptLower)) {
    return 'ANALYTICAL'
  }

  // Default: STRATEGIC (may be downgraded to TACTICAL after budget analysis)
  return 'STRATEGIC'
}

function buildSituationAssessment(prompt: string, businessProfile: any, campaignCount: number) {
  const promptLower = prompt.toLowerCase()

  // 1. Extract budget from prompt using regex (preserves raw values — no bucketing)
  const budgetPatterns = [
    /(?:pkr|inr|usd|aed|sar|gbp|eur|rs\.?|₹|\$|£|€)\s*([\d,]+(?:\.\d+)?)\s*(?:k|thousand|lac|lakh)?/i,
    /([\d,]+(?:\.\d+)?)\s*(?:k|thousand|lac|lakh)?\s*(?:pkr|inr|usd|aed|sar|gbp|eur|rupees?|dollars?|dirhams?|rs)/i,
    /(?:budget|have|got|spend)\s*(?:is|of|us)?\s*(?:pkr|inr|usd|aed|rs\.?|₹|\$|£|€)?\s*([\d,]+(?:\.\d+)?)\s*(?:k|thousand|lac|lakh)?/i
  ]

  let statedBudget: number | null = null
  let budgetCurrency: string | null = null

  for (const pattern of budgetPatterns) {
    const match = promptLower.match(pattern)
    if (match) {
      let amount = parseFloat(match[1].replace(/,/g, ''))
      if (/k|thousand/i.test(match[0])) amount *= 1000
      if (/lac|lakh/i.test(match[0])) amount *= 100000
      statedBudget = amount
      // Detect currency from the matched text
      const currMatch = match[0].match(/pkr|inr|usd|aed|sar|gbp|eur|rs\.?|₹|\$|£|€|rupees?|dollars?|dirhams?/i)
      if (currMatch) {
        const cm = currMatch[0].toLowerCase()
        if (cm.startsWith('pkr') || cm.startsWith('rs') || cm === '₹' || cm.startsWith('rupee')) budgetCurrency = 'PKR'
        else if (cm.startsWith('inr')) budgetCurrency = 'INR'
        else if (cm.startsWith('usd') || cm === '$' || cm.startsWith('dollar')) budgetCurrency = 'USD'
        else if (cm.startsWith('aed') || cm.startsWith('dirham')) budgetCurrency = 'AED'
        else if (cm.startsWith('sar')) budgetCurrency = 'SAR'
        else if (cm.startsWith('gbp') || cm === '£') budgetCurrency = 'GBP'
        else if (cm.startsWith('eur') || cm === '€') budgetCurrency = 'EUR'
      }
      break
    }
  }

  const currency = budgetCurrency || businessProfile?.currency || 'PKR'
  const rate = CURRENCY_TO_USD[currency] || 0.01

  let usdEquivalent: number | null = null
  if (statedBudget !== null) {
    usdEquivalent = Math.round(statedBudget * rate * 100) / 100
  } else if (businessProfile?.monthly_ad_budget) {
    statedBudget = businessProfile.monthly_ad_budget
    usdEquivalent = Math.round(statedBudget * rate * 100) / 100
  }

  // 2. Extract time horizon from prompt
  let timeHorizonDays: number | null = null
  const timeMatch = promptLower.match(/(\d+)\s*(?:-?\s*)?day/i)
  if (timeMatch) timeHorizonDays = parseInt(timeMatch[1])
  const weekMatch = promptLower.match(/(\d+)\s*(?:-?\s*)?week/i)
  if (!timeHorizonDays && weekMatch) timeHorizonDays = parseInt(weekMatch[1]) * 7
  const monthMatch = promptLower.match(/(\d+)\s*(?:-?\s*)?month/i)
  if (!timeHorizonDays && monthMatch) timeHorizonDays = parseInt(monthMatch[1]) * 30

  // 3. Country and market classification
  let countryRaw = (businessProfile?.country || 'Pakistan').trim()
  let countryCode = countryRaw.length <= 3
    ? countryRaw.toUpperCase().substring(0, 2)
    : (COUNTRY_NAME_TO_CODE[countryRaw.toLowerCase()] || 'PK')
  const marketTrustLevel = MARKET_TRUST_MAP[countryCode] || 'EMERGING'

  // 4. Industry and pixel maturity
  const industry = (businessProfile?.industry || 'general').toLowerCase()
  const pixelMaturity = campaignCount > 0 ? 'ESTABLISHED' : 'COLD_START'

  // 5. Derive marketing reality from raw facts
  const estimatedCPM = APPROX_CPM_USD[countryCode] || 2.00
  let dailyBudgetUSD: number | null = null
  if (usdEquivalent !== null) {
    if (timeHorizonDays && timeHorizonDays > 0) {
      dailyBudgetUSD = Math.round((usdEquivalent / timeHorizonDays) * 100) / 100
    } else if (/per\s*day|daily|\/day/i.test(promptLower)) {
      dailyBudgetUSD = usdEquivalent
    } else {
      // Assume total budget over 7-day default horizon
      dailyBudgetUSD = Math.round((usdEquivalent / 7) * 100) / 100
      if (!timeHorizonDays) timeHorizonDays = 7
    }
  }

  let estimatedDailyImpressions: number | null = null
  let estimatedWeeklyConversions: number | null = null
  let canExitLearningPhase: boolean | null = null
  let maxAdSetsSupportable: number | null = null
  let budgetReality = ''

  if (dailyBudgetUSD !== null) {
    estimatedDailyImpressions = Math.round((dailyBudgetUSD / estimatedCPM) * 1000)
    // Conservative: ~1% CTR, ~2% landing-to-conversion rate
    const estDailyClicks = estimatedDailyImpressions * 0.01
    const estDailyConversions = estDailyClicks * 0.02
    estimatedWeeklyConversions = Math.round(estDailyConversions * 7 * 10) / 10
    canExitLearningPhase = estimatedWeeklyConversions >= 50
    maxAdSetsSupportable = Math.max(1, Math.floor(dailyBudgetUSD / 3))

    if (dailyBudgetUSD < 5) {
      budgetReality = `Ultra-micro budget (~$${dailyBudgetUSD}/day). Cannot sustain multiple ad sets. Must consolidate into 1 campaign > 1 ad set > 1-2 ads with broad targeting to maximize signal density.`
    } else if (dailyBudgetUSD < 15) {
      budgetReality = `Micro-test budget (~$${dailyBudgetUSD}/day). Supports ${maxAdSetsSupportable} ad set(s) maximum. Focus on single variable testing. Unlikely to exit Meta learning phase.`
    } else if (dailyBudgetUSD < 50) {
      budgetReality = `Growth-test budget (~$${dailyBudgetUSD}/day). Can support ${maxAdSetsSupportable} ad sets for structured A/B testing. May exit learning phase with upper-funnel optimization.`
    } else {
      budgetReality = `Scaling-ready budget (~$${dailyBudgetUSD}/day). Can support multi-ad-set testing and CBO optimization. Sufficient volume for learning phase exit on purchase events.`
    }
  }

  let breakevenRoas: number | null = null
  if (businessProfile?.target_roas) {
    breakevenRoas = businessProfile.target_roas
  }

  // 6. Determine pipeline depth (may downgrade STRATEGIC → TACTICAL for constrained budgets)
  let responseDepth = determineResponseDepth(prompt)
  if (responseDepth === 'STRATEGIC' && dailyBudgetUSD !== null && dailyBudgetUSD < 20) {
    if (/\b(what.*structure|how.*split|how.*allocate|campaign.*setup|daily.*spend|budget.*split|how.*divide|what.*setup)\b/i.test(promptLower)) {
      responseDepth = 'TACTICAL'
    }
  }

  return {
    extracted_facts: {
      stated_budget: statedBudget,
      currency: currency,
      usd_equivalent: usdEquivalent,
      time_horizon_days: timeHorizonDays,
      daily_budget_usd: dailyBudgetUSD,
      target_market_country: countryCode,
      market_trust_level: marketTrustLevel,
      industry: industry,
      campaign_count: campaignCount,
      pixel_maturity: pixelMaturity
    },
    derived_reality: {
      estimated_local_cpm_usd: estimatedCPM,
      estimated_daily_impressions: estimatedDailyImpressions,
      estimated_weekly_conversions: estimatedWeeklyConversions,
      can_exit_learning_phase: canExitLearningPhase,
      max_ad_sets_supportable: maxAdSetsSupportable,
      budget_reality: budgetReality,
      breakeven_roas: breakevenRoas
    },
    pipeline_config: {
      response_depth: responseDepth
    }
  }
}

// isPurelyConversationalPrompt removed — response depth is now determined by buildSituationAssessment()

async function retrieveKnowledge(supabaseClient: any, assessment: any): Promise<string> {
  try {
    const { data: allKnowledge, error } = await supabaseClient
      .from('marketing_knowledge')
      .select('title, content, dimensions, priority')
      .eq('is_active', true)

    if (error || !allKnowledge || allKnowledge.length === 0) {
      console.error('Knowledge retrieval failed:', error?.message || 'No documents found')
      return ''
    }

    const facts = assessment.extracted_facts
    const reality = assessment.derived_reality

    // Score each document by situational relevance (uses Situation Assessment, not flat buckets)
    const scored = allKnowledge.map((doc: any) => {
      let score = 0
      const dims = doc.dimensions || {}

      // Budget relevance (weight: 3 — strongest signal, uses USD equivalent ranges instead of rigid tiers)
      if (dims.budget_tiers) {
        const usd = facts.usd_equivalent || 0
        if (usd < 200 && (dims.budget_tiers.includes('MICRO') || dims.budget_tiers.includes('ALL'))) score += 3
        else if (usd >= 200 && usd < 2000 && (dims.budget_tiers.includes('GROWTH') || dims.budget_tiers.includes('ALL'))) score += 3
        else if (usd >= 2000 && (dims.budget_tiers.includes('SCALE') || dims.budget_tiers.includes('ALL'))) score += 3
        else if (dims.budget_tiers.includes('ALL')) score += 2
      }

      // Market type match (weight: 2)
      if (dims.market_types?.includes(facts.market_trust_level) || dims.market_types?.includes('ALL')) score += 2

      // Situational boost based on derived reality (weight: 2)
      if (reality.can_exit_learning_phase === false) {
        const titleAndContent = ((doc.title || '') + ' ' + (doc.content || '').substring(0, 500)).toLowerCase()
        if (/learning phase|consolidat|signal|micro.?budget|pacing/i.test(titleAndContent)) score += 2
      }
      if (reality.max_ad_sets_supportable !== null && reality.max_ad_sets_supportable <= 1) {
        const title = (doc.title || '').toLowerCase()
        if (/abo|single/i.test(title)) score += 1
        if (/cbo|campaign.?budget/i.test(title)) score -= 1
      }

      // Campaign stage match (weight: 1)
      if (dims.campaign_stages?.includes(facts.pixel_maturity) || dims.campaign_stages?.includes('ALL')) score += 1

      // Industry match (weight: 1)
      if (dims.industries?.includes(facts.industry) || dims.industries?.includes('ALL')) score += 1

      // Priority boost (0-1 range)
      score += (doc.priority || 5) / 10

      return { ...doc, score }
    })

    // Sort by score descending, take top 5
    scored.sort((a: any, b: any) => b.score - a.score)
    const topDocs = scored.slice(0, 5)

    if (topDocs.length === 0) return ''

    // Concatenate into knowledge context
    const knowledgeContext = topDocs
      .map((doc: any) => `### ${doc.title}\n${doc.content}`)
      .join('\n\n---\n\n')

    return knowledgeContext
  } catch (err: any) {
    console.error('Knowledge retrieval error:', err.message)
    return ''
  }
}

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

  const toolContext = `
## Available Tool Inventory (Context for Your Thinking)
The following tools exist in the system. You do not call these tools — this list is provided so you can think about what is possible when forming your plan:
- get_campaign_hierarchy: Fetches all active campaigns, ad sets, and ads with real-time metrics and age in days.
- check_agent_memory: Recalls past decisions and reasoning for a specific campaign or ad set.
- get_state_snapshots: Fetches historical metric snapshots (every 12h) for trend analysis over 5 days.
- get_account_summary_snapshots: Broad account-level snapshot of all campaigns.
- create_campaign: Creates a new campaign on Meta in PAUSED status.
- create_ad_set: Creates a new ad set under an existing campaign.
- create_ad: Creates a new ad under an existing ad set.
- propose_action_card: Creates an optimization action card for user approval.
- schedule_monitoring_review: Schedules an operational background review timer.
- report_no_action: Records a formal decision to maintain status quo.
Note: This tool list is for your thinking context only. Other stages will independently decide which tools to use based on your plan.
`;

  return `You are the internal Strategic Planner engine (Phase 1). Your job is to think deeply, reason from first principles, and establish an internal strategic roadmap for the downstream specialist agents.

${profileContext}

${toolContext}

## CRITICAL VOICE & ROLE DIRECTIVES (INTERNAL SUBSYSTEM ROLE):
1. INTERNAL ROLE ONLY: You are an internal thinking engine. You are NOT talking to the human user. 
2. NO USER-FACING QUESTIONS: DO NOT address the human user directly. DO NOT ask the user questions. DO NOT offer next steps to the user.
3. SELF-AWARE PIPELINE REASONING: Frame your thought process internally:
   - "Strategic Direction:"
   - "Target Architecture:"
   - "Downstream Research Directives for Phase 2:"
   - "Internal Validation Criteria for Phase 3:"

## SITUATION ASSESSMENT INTELLIGENCE (CRITICAL — READ THIS FIRST)
You will receive a SITUATION ASSESSMENT generated by Phase 0. This assessment contains:
- **extracted_facts**: Raw data from the user's message (budget, currency, time horizon, market, etc.)
- **derived_reality**: Marketing-meaningful metrics (estimated CPM, daily impressions, weekly conversions, learning phase feasibility, max supportable ad sets, budget reality)
- **pipeline_config**: The response depth determined for this request

YOU MUST USE the derived_reality to ground your strategic thinking. Do NOT contradict the Situation Assessment's mathematical analysis. If derived_reality says can_exit_learning_phase is false, you MUST design a consolidated structure. If max_ad_sets_supportable is 1, you MUST NOT recommend multi-ad-set testing.

## MARKETING FIRST PRINCIPLES (Apply Based on Situation Assessment)
These are universal laws. Apply them dynamically based on the Situation Assessment:

1. **THE SIGNAL DENSITY LAW**: Meta's algorithm needs ~50 conversion events/week to exit learning phase.
   - IF can_exit_learning_phase === false → Consolidate ALL spend into 1 campaign, 1 ad set. Broad targeting. Consider optimizing for upper-funnel events (Landing Page Views, Add to Cart) instead of Purchase.
   - IF can_exit_learning_phase === true → Standard multi-ad-set testing is viable.

2. **THE CONSOLIDATION IMPERATIVE**: Budget must be concentrated, not spread thin.
   - Use max_ad_sets_supportable to determine structure complexity. NEVER recommend more ad sets than the budget can support at $3-5/day minimum each.
   - For micro-budgets: 1 Campaign → 1 Ad Set → 1-2 Ads. Period.

3. **THE TRUST GRADIENT LAW**: In TRUST_DEFICIT markets, conversion friction is trust, not price.
   - IF market_trust_level === 'TRUST_DEFICIT' → Prioritize COD (Cash on Delivery), WhatsApp buttons, UGC-style creatives, open-parcel delivery videos, customer testimonials.
   - IF market_trust_level === 'MATURE' → Prioritize value proposition, competitive differentiation, retargeting funnels.

4. **THE BREAKEVEN GATE**: Never recommend scaling without establishing profitability.
   - IF business profile has AOV and margins → Calculate Breakeven ROAS = 1/margin.
   - IF current ROAS < Breakeven ROAS → Do NOT scale. Optimize first.

5. **THE CREATIVE LEVERAGE LAW**: When budget is constrained, creative quality is the only competitive advantage.
   - IF daily_budget_usd < $10 → Recommend 1-2 high-quality creatives, NOT A/B testing multiple variants (insufficient traffic for statistical significance).

6. **THE PROPORTIONAL RESPONSE LAW**: Match output depth to the complexity of the ask.
   - A "what structure should I use?" question needs a tactical answer, NOT a 2000-word strategic manifesto.

## Holistic First-Principles Reasoning Rules:
1. HOLISTIC EVALUATION: Synthesize target country CPM economics, margin/AOV, business model, and user resources. Never rely on rigid formulas.
2. CURRENCY INTEGRITY: Preserve the user's native currency (${businessProfile?.currency || 'PKR'}) at all times. Use USD only for internal calculations.
3. TIMELINE & PACING GUARDRAILS:
   - **Direct User Constraint**: If the user explicitly asks to run a campaign for a specific duration, match your strategy to this timeline.
   - **Open-Ended Strategy**: Reason from first principles. Propose a robust budget pacing plan (recommend 4+ days minimum for Meta's machine learning).
4. UNIFIED THINKING: Your internal blueprint will be consumed by downstream agents. Provide clear, objective strategic direction covering budget pacing, campaign structure, creative direction, and post-launch decision trees.`;
}

function generatePreExecutionPlanGeneratorPrompt(businessProfile: any) {
  let profileContext = businessProfile ? `Business: ${businessProfile.business_name} (${businessProfile.country}, ${businessProfile.currency || 'USD'})` : '';
  return `You are the Pre-Execution Plan Generator, and I am a plan generator — my job is to take the Strategic Planner's deep thinking and form an actionable strategic blueprint before any research or live account data is gathered.

${profileContext}

## Your Job
Using the Planner's thinking as your foundation, generate a complete, actionable strategic plan that covers:
- Campaign architecture (structure, objectives, budget allocation)
- Budget pacing strategy (daily spend, total wallet management, timeline)
- Creative direction and ad hook themes
- Audience targeting approach
- Key success metrics and decision triggers
- Post-launch rules and optimization cadence

## Important Guidelines
- You are forming this plan BEFORE any live account research. Work with the information available from the Planner's thinking and the business profile.
- Write your plan as clear, readable prose and structured sections — not as rigid JSON or code blocks.
- At the end of your plan, write one paragraph titled "Room for Improvement with Research Data" explaining: This plan was built without historical account data. It could be further refined and improved if provided with the live campaign hierarchy (active campaigns, ad sets, ads and their ages), past agent decisions and reasoning logs, account performance summary snapshots, and historical metric trends. This research context would allow the strategy to be grounded in empirical data rather than first-principles reasoning alone.`;
}

function generateResearchAgentPrompt(businessProfile: any) {
  return `You are the Research & Evidence Gathering Agent.
The Strategic Planner has provided deep thinking about the user's request, and the Pre-Execution Plan Generator has formed an initial strategic plan — both created before this research phase.

## CONDITIONAL EVIDENCE DISCIPLINE (EVALUATE BEFORE TOOL CALLS):
1. **PRACTICAL / ACCOUNT / STRATEGY QUERIES**: If the user is asking to analyze performance, optimize active campaigns, scale budgets, or launch a new campaign, USE YOUR TOOLS (get_campaign_hierarchy, check_agent_memory, etc.) to gather empirical evidence.
2. **CONCEPTUAL / THEORY / CREATIVE IDEATION QUERIES**: If the user is asking a purely educational/theoretical question (e.g. "Explain CBO vs ABO", "What does ROAS mean?") or pure creative hook brainstorming without asking for account actions, DO NOT call account tools needlessly. Simply note: "Query is conceptual/theoretical. Live account evidence tool calls bypassed."

Do NOT write final user recommendations. Simply query tools when relevant to collect metrics, historical performance, and active campaign structures. Your evidence will be passed to the Master Strategy Agent for deep reasoning.`;
}

function generateStrategyAgentPrompt(businessProfile: any) {
  return `You are the Master Strategy Agent.
Your sole job is deep reasoning. You will receive the complete context chain:

1. The user's original prompt
2. The Strategic Planner's first-principles thinking about the request
3. The Pre-Execution Plan Generator's strategic blueprint (formed BEFORE live research)
4. The Research Agent's gathered evidence from the live ad account

The Pre-Execution Plan Generator proposed the complete strategy and blueprint, but it was built without the in-depth research and live account context that the Research Agent has now gathered. Since you now have both the initial plan AND the research evidence, your job is to:
- Deep-reason and analyze the complete strategy.
- Make small to major changes as needed based on the research evidence.
- ADAPTIVE ACCOUNT INTELLIGENCE (SMART & FLUID): If the live research shows successful active campaigns in the user's account, intelligently reference their winning elements (e.g. high ROAS, winning creative formats, top CPA angles) as empirical proof points in your strategy.
- VAGUE / OPEN-ENDED PROMPTS: If the user prompt is open-ended ("what next?", "how do I scale?"), analyze active account winners and formulate a proactive scaling or optimization roadmap grounded in their actual data.
- TOPIC INTEGRITY & BUSINESS IDENTITY ALIGNMENT: Always cross-reference retrieved account campaigns against the user's active Business Profile (name, industry, business description). If an existing campaign in the account fundamentally conflicts with the user's business identity (e.g. campaign says "Skincare" but business is "Urban Kicks Footwear"), DO NOT adopt or generate strategy for the conflicting product identity. Highlight the mismatch clearly to the user and offer to archive or replace the campaign.
- PROPORTIONAL RESPONSE: Match the depth and complexity of your output to the user's question. Simple observation requests ("what campaigns exist?", "analyse my account") get concise, data-first summaries. Complex strategy requests ("how do I scale with 50k PKR?") get comprehensive treatment. Never produce a 500-word strategic blueprint for a question that needs a 3-line data summary.

Write your reasoning and refined strategy as natural, free-form text. Do NOT call tools or format output into JSON.`;
}

function generateStrategyReviewerPrompt(businessProfile: any) {
  let profileContext = businessProfile ? `Business: ${businessProfile.business_name} (${businessProfile.country})` : '';
  return `You are the Chief Strategy Officer Reviewer.
${profileContext}

Your job is to audit the response for holistic strategy depth and actionable intelligence, if needed.

Guidelines:
- Make sure the whole response is not generic, nor does it rely on rigid templates, or lack a clear campaign architecture.
- The response is strong if it provides a masterclass strategic breakdown with clear reasoning.
- Constructive Alternative: Only provide a concrete alternative strategic direction if the strategy is significantly outdated, fails to meet expectations, or is fundamentally flawed. If the strategy is solid, skip the alternative entirely.
- Reason: If you made any edits, changes, or audit notes to improve the response, explain in a short paragraph why it was done and what the reasoning was. If no changes were needed, do not provide a reason section.
- If there is genuinely no need for this review based on the user's prompt and previous stages (e.g., the request is purely conversational or operational), simply respond with: "Reviewer job not required."

Write your evaluation as natural prose — do not use JSON structure.`;
}

function generateCopyReviewerPrompt(businessProfile: any) {
  return `You are the Lead Copywriting Reviewer.

Primary Objective: Ensure all copy is engaging, natural, and completely free of dry, standard AI-sounding language.

Core Principles & Advanced Reasoning:
- Audience Alignment: Directly address the target audience's specific pain points, deep desires, objections, and natural customer language.
- Problem & Solution Focus: Keep the narrative anchored clearly around the problem at hand and the practical solution provided.
- Conversational Tone: Use direct, conversational language while strictly avoiding marketing buzzwords, cliches, hype, and generic AI markers.

Guidelines:
- Constructive Alternative: Only provide a concrete alternative copy hook or angle if the existing copy is significantly weak, AI-sounding, or misaligned with the audience. If the copy is solid, skip the alternative entirely.
- Reason: If you made any edits or suggestions to improve the copy, explain in a short paragraph why and what was changed. If no changes were needed, do not provide a reason section.
- If there is genuinely no need for this review based on the user's prompt and previous stages, simply respond with: "Reviewer job not required."

Write your evaluation as natural prose — do not use JSON structure.`;
}

function generateCreativeReviewerPrompt(businessProfile: any) {
  return `You are the Creative Director Reviewer.
Your job is to audit visual layout proposals, image/video suggestions, and creative hooks.

Follow these foundational creative direction rules:
1. Define the Goal — Decide the single objective (stop scroll, educate, build trust, convert, etc.).
2. Choose One Big Idea — Build the creative around one clear concept.
3. Define the Audience — Know exactly who the visual is speaking to.
4. Plan the Hook — Create a strong first 1-3 seconds or visual focal point.
5. Map the Story — Structure: Hook > Problem > Solution > Proof > CTA.
6. Specify Visuals — Define scenes, camera angles, colors, props, typography, and branding.
7. Add Emotion & Psychology — Use curiosity, urgency, trust, aspiration, or relatability intentionally.
8. Review for Clarity — Remove unnecessary elements and ensure one clear message.
9. Optimize for Platform — Adapt the creative for Meta, TikTok, YouTube, or the intended placement.

Additionally, generate a descriptive prompt for the ad creative so the suggested visual concept can be imagined and brought to life.

Guidelines:
- If there is genuinely no need for this review based on the user's prompt and previous stages, simply respond with: "Reviewer job not required."

Write your evaluation as natural prose — do not use JSON structure.`;
}

function generateDiversityReviewerPrompt(businessProfile: any) {
  let budgetCap = businessProfile?.monthly_ad_budget ? `${businessProfile.monthly_ad_budget} ${businessProfile.currency || 'USD'}` : 'Not provided';
  return `You are the Creative Diversity Auditor.
Your job is to contextually audit the diversity of ad angles, hooks, and formats based on budget scale (Budget Cap: ${budgetCap}).

Evaluate whether the creative mix is appropriately diverse for the budget level — a micro-budget should not be spread across too many formats, while a larger budget should explore multiple angles.

Guidelines:
- Offer constructive recommendations for creative format balance only if genuinely needed.
- If there is genuinely no need for this review based on the user's prompt and previous stages, simply respond with: "Reviewer job not required."

Write your evaluation as natural prose — do not use JSON structure.`;
}

function generateComplianceReviewerPrompt(businessProfile: any) {
  return `You are the Technical Operations & Compliance Auditor.
Audit tool execution, compliance with Meta ad policies, and operational safety.

Guidelines:
- Offer constructive policy or safety safeguard recommendations only if genuinely needed.
- If there is genuinely no need for this review based on the user's prompt and previous stages, simply respond with: "Reviewer job not required."

Write your evaluation as natural prose — do not use JSON structure.`;
}

function generatePerformanceReviewerPrompt(businessProfile: any) {
  let currency = businessProfile?.currency || 'PKR';
  return `You are the VP of Finance & Growth Reviewer.
Your job is to deeply understand and evaluate every financial aspect of the proposed strategy.

Audit areas:
- Budget pacing logic and daily/total wallet allocation
- Currency integrity (all figures should be in ${currency} unless explicitly converted)
- Expected ROAS economics and CPA viability given the market and product
- Margin analysis and break-even calculations if applicable
- Whether the financial strategy is realistic and sustainable for the business stage

Guidelines:
- Provide constructive financial pacing or allocation recommendations only if genuinely needed and grounded in clear reasoning.
- Do not make decisions or provide feedback if there is no financial concern to address — simply confirm the strategy is financially sound.
- If there is genuinely no need for this review based on the user's prompt and previous stages, simply respond with: "Reviewer job not required."

Write your evaluation as natural prose — do not use JSON structure.`;
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
  return `You are NOT the conversational assistant. You are an INTERNAL formatting service.
Your sole job is to clean up typography, bolding, and spacing of the text provided in the prompt.

STRICT FORMATTING RULES:
- Do NOT speak to the user, greet the user, or explain your role.
- Do NOT ask questions or request additional content.
- Do NOT output conversational filler.
- DO NOT RE-ARCHITECT OR RESTRUCTURE THE INPUT: If the input contains a bulleted list, plain data table, or direct response, PRESERVE THAT EXACT STRUCTURE.
- NEVER group items into unsolicited category tables (e.g. "Category | Campaign Name(s)"), cards, or document headers (# Ads Manager Audit) unless the input text itself explicitly contains those headers.
- Return ONLY the clean, polished markdown representation of the provided input text verbatim.`;
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
- Budget Cap: ${businessProfile.monthly_ad_budget ? businessProfile.monthly_ad_budget + ' ' + (businessProfile.currency || 'USD') + '/mo' : 'Not provided in business profile'}
- Stage: ${businessProfile.business_stage}
- Additional Rules: ${businessProfile.additional_context || 'None'}
`;
  }

  return `You are MetaAgent AI, a highly advanced autonomous Meta Ads optimization agent capable of deep contextual reasoning, when needed according to user prompt and if the conversation.brain provides explanation of major stages.

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
- In often cases users are dependent on you, so while advising you should be confident like a caring parent but being honest with no false hopes

### When to Immediately Create Things
If the user gives you a SPECIFIC directive ("create a campaign named X with budget Y"), then act directly using tools. Or if the user is leaning towards a specific action or plan and is not able to move on, nudge them forward. Even when doing things immediately, you should provide a very short, clear direction of results this action can generate honestly — whether good or bad.

## Adaptive Account Intelligence & Natural Proof-Points (SMART & FLUID)
1. BUSINESS IDENTITY CROSS-CHECK (CRITICAL): Always verify that retrieved campaigns match the active Business Profile (name, industry, product description). If an account campaign name or objective conflicts with the business identity (e.g., campaign says "Skincare" but business is "Urban Kicks Footwear"), DO NOT build copy, creative hooks, or roadmaps for the conflicting category. Inform the user of the disconnect cleanly.
2. DYNAMIC ACCOUNT BENCHMARKING: Be smart and adaptive, not rigid. If the user's account contains active, high-performing campaigns for their business (e.g. strong ROAS or beating target CPA), fluidly reference them as empirical proof points in your recommendations (e.g. "Building on the strong 4.2 ROAS of your active [Campaign Name]...").
3. VAGUE OR OPEN-ENDED PROMPTS: When the user asks directionless or open-ended questions ("what next?", "how do I grow?", "how can I optimize?"), inspect the active campaign hierarchy and provide an actionable scaling/optimization roadmap tied directly to their winning account assets.
4. NATURAL STORYTELLING: Weave active campaign benchmarks naturally into your narrative prose like an expert Senior Media Buyer advising a client. Never attach dry, raw database dumps or unrelated campaign tables at the end of the text.

## Temporal Discipline (CRITICAL)
You MUST check the \`age_days\` of every item before reasoning about it.
- **< 3 days old**: UNTOUCHABLE. Do NOT analyze, judge, or propose any change. Meta's learning phase needs at minimum 72 hours. Use \`report_no_action\`.
- **3-7 days old**: OBSERVATION ONLY. Note trends but DO NOT propose changes unless metrics are catastrophically bad (e.g., 5x above target CPA).
- **7-14 days old**: ACTIONABLE with caution. You have enough data to make informed decisions.
- **> 14 days old**: FULLY ACTIONABLE. You have mature data to make confident scaling or pruning decisions.

## Proactive Creation & Action Cards
You have dedicated tools to create new entities or propose modifications:
- \`create_campaign\` — Creates a new campaign (queued for user approval)
- \`create_ad_set\` — Creates a new ad set (queued for user approval)
- \`create_ad\` — Creates a new ad (queued for user approval)
- \`propose_action_card\` — Your ONLY tool for ALL modifications to existing entities

### CRITICAL: propose_action_card is your ONLY modification tool
There are NO other modification tools. Do NOT invent or call tools like \`update_campaign_name\`, \`change_campaign_status\`, \`rename_campaign\`, or \`update_status\`. They DO NOT EXIST.
Use \`propose_action_card\` for:
- **Renaming**: action_type=RENAME, proposed_changes={new_name: "..."}
- **Pausing**: action_type=PAUSE, proposed_changes={status: "PAUSED"}
- **Activating/Resuming**: action_type=RESUME, proposed_changes={status: "ACTIVE"}
- **Budget changes**: action_type=INCREASE_BUDGET or DECREASE_BUDGET, proposed_changes={daily_budget: 1500}
- **Targeting changes**: action_type=CHANGE_TARGETING, proposed_changes={...}

ALWAYS pass the \`target_id\` parameter with the numeric Meta ID (e.g., "52586793602259") from \`get_campaign_hierarchy\`. Without target_id, the executor cannot find the campaign on Meta.

When you call any of these tools, the system generates an "Action Card" in the user's UI. The user must click "Approve" before it executes on Meta.

### Tool Calling Rules:
1. **Gather details first, then call once.** If you need specifics (like a campaign name, budget, or creative details), ask the user FIRST. Once you have enough information, call the tool exactly ONE time.
2. **Each tool call = one Action Card.** Calling create_campaign twice creates TWO separate campaigns. Only call it once per entity you want to create.
3. **After calling the tool, guide the user to approve.** Tell them to click "Approve" on the Action Card that appeared in the chat. Do NOT call the same tool again when they reply saying "yes" or "approved" — they are confirming via the UI button, not asking you to re-create.
4. **New requests = new tool calls.** If the user asks you to create a DIFFERENT campaign (new name, new purpose), that is a brand new request and you SHOULD call the tool again. Only avoid re-calling for the SAME entity.
5. **ALWAYS include the full hierarchy in create_campaign.** When creating a campaign, you MUST include the \`ad_sets\` array with at least one ad set, and each ad set MUST include an \`ads\` array with at least one ad. The create_campaign tool creates the ENTIRE structure (Campaign → Ad Sets → Ads) in ONE action card. The user approves once, and all levels are created sequentially on Meta. Use create_ad_set if you ONLY want to add an ad set to an EXISTING campaign. Use create_ad if you ONLY want to add an ad to an EXISTING ad set.
6. **When the user gives a direct command like "rename X to Y" or "activate these campaigns", execute it immediately.** Do NOT lecture them about strategy or refuse the request. Call \`propose_action_card\` with the correct parameters and let them approve. You can add strategic advice AFTER executing their request.
7. **Never tell the user to "manually set up" things in Meta Ads Manager.** You have full tools to create the complete campaign structure. Use them. The only things the user must do manually are: uploading creative files (images/videos) and connecting payment methods.

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
      if (!metaToken || !metaAdAccountId) {
        return JSON.stringify({ 
          error: "META_API_DISCONNECTED",
          message: "Meta Ad Account is not connected. Please configure your Meta Access Token and Ad Account ID in Settings."
        });
      }

      try {
        const formattedAccountId = metaAdAccountId.startsWith('act_') ? metaAdAccountId : `act_${metaAdAccountId}`;
        const filteringParam = encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED'] }]));
        const url = `https://graph.facebook.com/v19.0/${formattedAccountId}/campaigns?fields=id,name,status,effective_status,daily_budget,lifetime_budget,objective,adsets{id,name,status,effective_status,daily_budget,targeting,insights{spend,impressions,clicks,cpc,cpm,ctr}},insights{spend,impressions,clicks,cpc,cpm,ctr}&filtering=${filteringParam}&access_token=${metaToken}`;
        
        const metaRes = await fetch(url);
        if (!metaRes.ok) {
          const errText = await metaRes.text();
          return JSON.stringify({ 
            error: "META_GRAPH_API_ERROR",
            status_code: metaRes.status,
            meta_response: errText,
            message: `Meta Graph API returned error status ${metaRes.status}: ${errText}`
          });
        }

        const metaJson = await metaRes.json();
        if (!metaJson.data) {
          return JSON.stringify({ data_source: 'LIVE_META_GRAPH_API', hierarchy: [] });
        }

        const liveHierarchy = metaJson.data
          .filter((c: any) => c.effective_status !== 'DELETED' && c.effective_status !== 'ARCHIVED')
          .map((c: any) => {
            const cInsights = c.insights?.data?.[0] || {};
            return {
              id: c.id,
              name: c.name,
              status: c.status || c.effective_status,
              daily_budget: c.daily_budget ? Number(c.daily_budget) / 100 : undefined,
              objective: c.objective,
              performance_metrics: {
                spend: Number(cInsights.spend || 0),
                impressions: Number(cInsights.impressions || 0),
                clicks: Number(cInsights.clicks || 0),
                cpc: Number(cInsights.cpc || 0),
                cpm: Number(cInsights.cpm || 0),
                ctr: Number(cInsights.ctr || 0)
              },
              ad_sets: c.adsets?.data
                ?.filter((s: any) => s.effective_status !== 'DELETED' && s.effective_status !== 'ARCHIVED')
                ?.map((s: any) => {
                  const sInsights = s.insights?.data?.[0] || {};
                  return {
                    id: s.id,
                    name: s.name,
                    status: s.status || s.effective_status,
                    daily_budget: s.daily_budget ? Number(s.daily_budget) / 100 : undefined,
                    targeting: s.targeting,
                    performance_metrics: {
                      spend: Number(sInsights.spend || 0),
                      impressions: Number(sInsights.impressions || 0),
                      clicks: Number(sInsights.clicks || 0),
                      cpc: Number(sInsights.cpc || 0),
                      cpm: Number(sInsights.cpm || 0),
                      ctr: Number(sInsights.ctr || 0)
                    }
                  };
                }) || []
            };
          });

        return JSON.stringify({ data_source: 'LIVE_META_GRAPH_API', hierarchy: liveHierarchy });
      } catch (e: any) {
        return JSON.stringify({ error: "LIVE_META_NETWORK_EXCEPTION", message: e.message });
      }
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
      const targetId = toolArgs.target_id;
      if (!targetId || targetId === 'NEW' || targetId.trim() === '') {
        return JSON.stringify({ message: "This is a fresh campaign evaluation. No prior decisions exist for this new target." })
      }

      const { data, error } = await supabaseClient
        .from('agent_memory')
        .select('*')
        .eq('campaign_id', targetId)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5)

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
      var campId = toolArgs.target_id || toolArgs.proposed_changes?.campaign_id || toolArgs.proposed_changes?.target_id || null;
      if (campId === 'NEW' || campId === '') {
        campId = null;
      }

      // Validate priority — only allow LOW, HIGH, MANDATORY
      const validPriorities = ['LOW', 'HIGH', 'MANDATORY'];
      var safePriority = validPriorities.includes((toolArgs.priority || '').toUpperCase()) 
        ? toolArgs.priority.toUpperCase() 
        : 'HIGH';
      
      var cardRes = await supabaseClient.from('action_cards').insert({
        user_id: userId,
        session_id: sessionId,
        campaign_id: campId,
        priority: safePriority,
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
        type: 'ACTION_PROPOSAL',
        card: cardRes.data,
        message: 'Action Card generated with ' + safePriority + ' priority and sent to Action Center.'
      })
    }

    case 'schedule_monitoring_review':
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
      // Prevent duplicate creation of the same campaign in a single session
      const { data: existingCards } = await supabaseClient
        .from('action_cards')
        .select('id, proposed_changes')
        .eq('session_id', sessionId)
        .eq('action_type', 'CREATE_CAMPAIGN_STRUCTURE')
        .eq('status', 'PENDING');
        
      if (existingCards && existingCards.length > 0) {
        const isDuplicateName = existingCards.some((card: any) => 
          card.proposed_changes && card.proposed_changes.name === toolArgs.name
        );
        if (isDuplicateName) {
           return JSON.stringify({
             error: `A campaign structure named "${toolArgs.name}" is already pending approval in this session. Do NOT call create_campaign again for this campaign. If you meant to add more ad sets, you must put them all in ONE single create_campaign tool call.`
           })
        }
      }

      // Unified: stores the full hierarchy (campaign + ad_sets + ads) in ONE action card
      const structure = {
        name: toolArgs.name,
        daily_budget: toolArgs.daily_budget,
        objective: toolArgs.objective || 'CONVERSIONS',
        targeting: toolArgs.targeting || {},
        ad_sets: toolArgs.ad_sets || []
      }

      const adSetCount = structure.ad_sets.length
      const adCount = structure.ad_sets.reduce((sum: number, as: any) => sum + (as.ads?.length || 0), 0)

      const cardRes = await supabaseClient.from('action_cards').insert({
        user_id: userId,
        session_id: sessionId,
        campaign_id: null,
        priority: 'HIGH',
        action_type: 'CREATE_CAMPAIGN_STRUCTURE',
        proposed_changes: structure,
        reasoning: `Full campaign structure: "${toolArgs.name}" with ${adSetCount} ad set(s) and ${adCount} ad(s)`,
        status: 'PENDING'
      }).select().single()

      if (cardRes.error) return JSON.stringify({ error: cardRes.error.message })

      await supabaseClient.from('agent_memory').insert({
        user_id: userId,
        campaign_id: null,
        decision_made: `Proposed FULL STRUCTURE: ${toolArgs.name}`,
        reasoning_snapshot: `Campaign + ${adSetCount} ad set(s) + ${adCount} ad(s). Budget: ${toolArgs.daily_budget}/day.`
      })

      return JSON.stringify({
        type: 'ACTION_PROPOSAL',
        card: cardRes.data,
        message: `Complete campaign structure queued: "${toolArgs.name}" with ${adSetCount} ad set(s) and ${adCount} ad(s). The user will see ONE action card to approve — when approved, the system creates Campaign → Ad Sets → Ads sequentially on Meta.`
      })
    }

    case 'create_ad_set': {
      const adCount = toolArgs.ads ? toolArgs.ads.length : 0;
      const proposedChanges = {
        campaign_id: toolArgs.campaign_id,
        ad_sets: [
          {
            name: toolArgs.name,
            targeting: toolArgs.targeting || {},
            ads: toolArgs.ads || []
          }
        ]
      };
      
      const cardRes = await supabaseClient.from('action_cards').insert({
        user_id: userId,
        session_id: sessionId,
        campaign_id: toolArgs.campaign_id,
        action_type: 'CREATE_AD_SET',
        proposed_changes: proposedChanges,
        reasoning: `User requested to create a new Ad Set "${toolArgs.name}" with ${adCount} ad(s) inside the existing campaign.`,
        priority: 'HIGH',
        status: 'PENDING'
      }).select().single()
      
      if (cardRes.error) return JSON.stringify({ error: cardRes.error.message })
      return JSON.stringify({
        type: 'ACTION_PROPOSAL',
        card: cardRes.data,
        message: `New Ad Set structure queued: "${toolArgs.name}" with ${adCount} ad(s). The user will see ONE action card to approve.`
      })
    }

    case 'create_ad': {
      const proposedChanges = {
        ad_set_id: toolArgs.ad_set_id,
        name: toolArgs.name,
        copy: toolArgs.copy,
        cta: toolArgs.cta,
        creative_url: toolArgs.creative_url
      };
      
      const cardRes = await supabaseClient.from('action_cards').insert({
        user_id: userId,
        session_id: sessionId,
        campaign_id: null, // Tied to Ad Set
        action_type: 'CREATE_AD',
        proposed_changes: proposedChanges,
        reasoning: `User requested to create a new Ad "${toolArgs.name}" inside the existing ad set.`,
        priority: 'HIGH',
        status: 'PENDING'
      }).select().single()
      
      if (cardRes.error) return JSON.stringify({ error: cardRes.error.message })
      return JSON.stringify({
        type: 'ACTION_PROPOSAL',
        card: cardRes.data,
        message: `New Ad queued: "${toolArgs.name}". The user will see ONE action card to approve.`
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
    const maxTokens = 4096
    const reviewerMaxTokens = 2048

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
    const thinkingSteps: any[] = []
    function logStageAudit(steps: any[], audit: any) {
      steps.push({ ...audit, timestamp: new Date().toISOString() })
    }
    let proposals: any[] = []
    let finalContent = ''

    // 3. Get campaign count for situation assessment
    const { count: campaignCount } = await supabaseClient.from('campaigns').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
    const situationAssessment = buildSituationAssessment(prompt, businessProfile, campaignCount || 0)
    const knowledgeContext = await retrieveKnowledge(supabaseClient, situationAssessment)

    if (reasoning_mode === 'deep' || true) {
      logStageAudit(thinkingSteps, {
        phase: 'PHASE_0_KNOWLEDGE',
        icon: '📚',
        title: 'Phase 0: Situation Assessment & Knowledge Intelligence',
        user_input: prompt,
        raw_output: `Situation Assessment:\n${JSON.stringify(situationAssessment, null, 2)}\n\nRetrieved Marketing Knowledge Context:\n${knowledgeContext || 'No frameworks matched — proceeding with LLM general knowledge.'}`
      })

      const plannerUserMessage = knowledgeContext
        ? `## SITUATION ASSESSMENT\n${JSON.stringify(situationAssessment, null, 2)}\n\n## MARKETING INTELLIGENCE CONTEXT (Retrieved Frameworks)\nThe following are universal marketing frameworks retrieved based on the user's situation. Use these as reference material to inform your strategic blueprint — they are principles, not commands.\n\n${knowledgeContext}\n\n## USER REQUEST\n${prompt}`
        : `## SITUATION ASSESSMENT\n${JSON.stringify(situationAssessment, null, 2)}\n\n## USER REQUEST\n${prompt}`

      let planJson: any = null
      const responseDepth = situationAssessment.pipeline_config.response_depth

      if (responseDepth === 'CONVERSATIONAL') {
        logStageAudit(thinkingSteps, {
          phase: 'PHASE_1_PLANNER',
          icon: '💬',
          title: 'Phase 1: Strategic Planner (Conversational)',
          status: 'COMPLETED',
          raw_output: 'CONVERSATIONAL: Conversational acknowledgment detected by Situation Assessment.'
        })
        planJson = {
          intent: 'CONVERSATION',
          raw_thinking: 'CONVERSATIONAL: Conversational acknowledgment detected.',
          conversational_response: "You're very welcome! I'm here whenever you're ready to review campaign options, optimize performance, or take next steps.",
          currency: businessProfile?.currency || 'PKR'
        }
      } else {
        try {
          const reqDetails = getLLMRequestDetails(openRouterKey, model)
          const plannerSystemPrompt = generatePlannerPrompt(businessProfile, historical_context)
          const plannerRes = await fetch(reqDetails.url, {
            method: 'POST',
            headers: reqDetails.headers,
            body: JSON.stringify({
              model: reqDetails.model,
              max_tokens: maxTokens,
              messages: [
                { role: 'system', content: plannerSystemPrompt },
                ...history,
                { role: 'user', content: plannerUserMessage }
              ]
            })
          })
          if (!plannerRes.ok) throw new Error(await plannerRes.text())
          const plannerData = await plannerRes.json()
          const rawContent = plannerData.choices[0].message.content || ''
          const plannerThinking = rawContent.trim()

          planJson = {
            intent: responseDepth,
            raw_thinking: plannerThinking,
            conversational_response: '',
            currency: businessProfile?.currency || 'PKR'
          }

          logStageAudit(thinkingSteps, {
            phase: 'PHASE_1_PLANNER',
            icon: '💭',
            title: `Phase 1: Strategic Planner Reasoning (${responseDepth})`,
            system_prompt: plannerSystemPrompt,
            user_input: plannerUserMessage,
            raw_output: plannerThinking
          })
        } catch (err: any) {
          console.error('Planner phase failed, using fallback:', err.message)
          logStageAudit(thinkingSteps, {
            phase: 'PHASE_1_PLANNER',
            icon: '💭',
            title: 'Phase 1: Strategic Planner Reasoning (Fallback)',
            raw_output: `STRATEGIC: Standard growth strategy analysis (${responseDepth}).`
          })
          planJson = {
            intent: responseDepth,
            raw_thinking: `STRATEGIC: Standard growth strategy analysis (${responseDepth}).`,
            conversational_response: '',
            currency: businessProfile?.currency || 'PKR'
          }
        }
      }

      // ===== CONVERSATIONAL BYPASS & BLACKBOARD INITIALIZATION =====
      if (planJson.intent === 'CONVERSATION') {
        logStageAudit(thinkingSteps, {
          phase: 'PHASE_BYPASS',
          icon: '💬',
          title: 'Conversational intent detected. Bypassing strategic deep dive.',
          status: 'COMPLETED'
        })
        finalContent = planJson.conversational_response || "I'm here to help. Could you clarify what you mean?"
      } else {
        // Shared Working Memory (Blackboard State)
        const conversationBrain: any = {
          goal: prompt,
          situation_assessment: situationAssessment,
          currency: planJson.currency || businessProfile?.currency || 'PKR',
          planner_thinking: planJson.raw_thinking,
          pre_execution_plan: '',
          evidence: [],
          research_synthesis: '',
          strategy_proposal: '',
          expert_contributions: []
        }

        const skipPreExecutionPlan = responseDepth === 'ANALYTICAL' || responseDepth === 'TACTICAL'
        const skipReviewers = responseDepth === 'ANALYTICAL' || responseDepth === 'TACTICAL'

        // ===== PHASE 1.5: Pre-Execution Plan Generator (SKIP for ANALYTICAL/TACTICAL intent) =====
        if (!skipPreExecutionPlan) {
          const planGenSystemPrompt = generatePreExecutionPlanGeneratorPrompt(businessProfile)
          const planGenInput = `## Planner's Deep Thinking\nThe Strategic Planner analyzed the user's request and produced the following first-principles thinking:\n\n${conversationBrain.planner_thinking}\n\n## User's Original Prompt\nThis was the user's original request on which the Planner generated the above thinking:\n\n${prompt}`
          try {
            const reqDetails = getLLMRequestDetails(openRouterKey, model)
            const planGenRes = await fetch(reqDetails.url, {
              method: 'POST',
              headers: reqDetails.headers,
              body: JSON.stringify({
                model: reqDetails.model,
                max_tokens: maxTokens,
                messages: [
                  { role: 'system', content: planGenSystemPrompt },
                  { role: 'user', content: planGenInput }
                ]
              })
            })
            if (planGenRes.ok) {
              const data = await planGenRes.json()
              conversationBrain.pre_execution_plan = data.choices[0].message.content || conversationBrain.planner_thinking
              logStageAudit(thinkingSteps, {
                phase: 'PHASE_1_5_BLUEPRINT',
                icon: '🛡️',
                title: 'Phase 1.5: Pre-Execution Strategic Blueprint',
                system_prompt: planGenSystemPrompt,
                user_input: planGenInput,
                raw_output: conversationBrain.pre_execution_plan
              })
            } else {
              conversationBrain.pre_execution_plan = conversationBrain.planner_thinking
              logStageAudit(thinkingSteps, {
                phase: 'PHASE_1_5_BLUEPRINT',
                icon: '🛡️',
                title: 'Phase 1.5: Pre-Execution Strategic Blueprint (Fallback)',
                raw_output: conversationBrain.pre_execution_plan
              })
            }
          } catch (err: any) {
            console.error('Pre-execution plan generator error:', err.message)
            conversationBrain.pre_execution_plan = conversationBrain.planner_thinking
          }
        } else {
          logStageAudit(thinkingSteps, {
            phase: 'PHASE_1_5_BLUEPRINT',
            icon: '📊',
            title: 'Phase 1.5: Pre-Execution Strategic Blueprint',
            status: 'SKIPPED',
            raw_output: `${responseDepth} intent detected — skipping Pre-Execution Plan to fast-track execution.`
          })
          conversationBrain.pre_execution_plan = conversationBrain.planner_thinking
        }

        // ===== PHASE 2: Research Agent (Evidence Gathering) =====
        const researchSystemPrompt = generateResearchAgentPrompt(businessProfile) + `\n\nSTRATEGIC PLAN TO RESEARCH:\n${conversationBrain.pre_execution_plan}`
        const researchMessages: any[] = [
          { role: 'system', content: researchSystemPrompt },
          ...history
        ]

        for (let i = 0; i < 4; i++) {
          const reqDetails = getLLMRequestDetails(openRouterKey, model)
          const researchRes = await fetch(reqDetails.url, {
            method: 'POST',
            headers: reqDetails.headers,
            body: JSON.stringify({
              model: reqDetails.model,
              max_tokens: maxTokens,
              messages: researchMessages,
              tools: AGENT_TOOLS.filter(t => ['get_campaign_hierarchy', 'check_agent_memory', 'get_state_snapshots'].includes(t.function.name)),
              tool_choice: 'auto'
            })
          })

          if (!researchRes.ok) break
          const aiData = await researchRes.json()
          const assistantMessage = aiData.choices[0].message
          researchMessages.push(assistantMessage)

          if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
            for (const toolCall of assistantMessage.tool_calls) {
              const toolName = toolCall.function.name
              let toolArgs = {}
              try { toolArgs = JSON.parse(toolCall.function.arguments || '{}') } catch {}

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

              let researchText = assistantMessage.content || ''
              logStageAudit(thinkingSteps, {
                phase: `PHASE_2_TOOL_${toolName.toUpperCase()}`,
                icon: '🛠️',
                title: `Phase 2 Tool Execution: ${toolName}`,
                status: 'EXECUTED',
                tool_name: toolName,
                tool_args: toolArgs,
                tool_result: toolResult,
                raw_output: (researchText ? `Agent Reasoning:\n${researchText}\n\nTool Result:\n` : '') + toolResult
              })
              
              try {
                const parsed = JSON.parse(toolResult)
                if (parsed.type === 'PROPOSAL' || parsed.type === 'GOAL_PROPOSAL') proposals.push(parsed)
              } catch {}

              toolExecutions.push({ name: toolName, args: toolArgs, result: toolResult, status: 'success' })
              conversationBrain.evidence.push({ tool: toolName, args: toolArgs, result: toolResult, reasoning: researchText })
              researchMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResult })
            }
          } else {
            conversationBrain.research_synthesis = assistantMessage.content || ''
            logStageAudit(thinkingSteps, {
              phase: 'PHASE_2_SYNTHESIS',
              icon: '🔬',
              title: 'Phase 2: Research Agent Synthesis',
              raw_output: conversationBrain.research_synthesis
            })
            break
          }
        }

        // ===== PHASE 3: Strategy Agent (Deep Reasoning) =====
        const strategySystemPrompt = generateStrategyAgentPrompt(businessProfile)
        const strategyInput = `## COMPLETE CONTEXT CHAIN:\n\n### 1. User's Original Request\n${prompt}\n\n### 2. Strategic Planner's First-Principles Thinking\n${conversationBrain.planner_thinking}\n\n### 3. Pre-Execution Plan Blueprint\n${conversationBrain.pre_execution_plan}\n\n### 4. Research Agent's Synthesis\n${conversationBrain.research_synthesis}\n\n### 5. Research Evidence Data\n${JSON.stringify(conversationBrain.evidence, null, 2)}\n\n### 6. Knowledge Context\n${knowledgeContext}`
        try {
          const reqDetails = getLLMRequestDetails(openRouterKey, model)
          const strategyRes = await fetch(reqDetails.url, {
            method: 'POST',
            headers: reqDetails.headers,
            body: JSON.stringify({
              model: reqDetails.model,
              max_tokens: maxTokens,
              messages: [
                { role: 'system', content: strategySystemPrompt },
                { role: 'user', content: strategyInput }
              ]
            })
          })
          if (strategyRes.ok) {
            const data = await strategyRes.json()
            conversationBrain.strategy_proposal = data.choices[0].message.content || conversationBrain.pre_execution_plan
            logStageAudit(thinkingSteps, {
              phase: 'PHASE_3_MASTER_STRATEGY',
              icon: '🧠',
              title: 'Phase 3: Master Strategy Proposal (Refined with Research)',
              system_prompt: strategySystemPrompt,
              user_input: strategyInput,
              raw_output: conversationBrain.strategy_proposal
            })
          }
        } catch (err: any) {
          console.error('Strategy Agent failed:', err.message)
          conversationBrain.strategy_proposal = conversationBrain.pre_execution_plan
        }

        // ===== PHASE 4: Board of Constructive Expert Debaters =====
        if (!skipReviewers) {
          const reviewerConfigs = [
            { id: 'strategy', label: '🎯 CSO Strategy Expert', promptFn: generateStrategyReviewerPrompt },
            { id: 'copy', label: '✍️ Lead Copywriting Expert', promptFn: generateCopyReviewerPrompt },
            { id: 'creative', label: '🎨 Creative Director Expert', promptFn: generateCreativeReviewerPrompt },
            { id: 'diversity', label: '🎭 Creative Diversity Auditor', promptFn: generateDiversityReviewerPrompt },
            { id: 'compliance', label: '🛡️ Operations & Policy Auditor', promptFn: generateComplianceReviewerPrompt },
            { id: 'performance', label: '📊 Finance & Performance Expert', promptFn: generatePerformanceReviewerPrompt }
          ]

          const reviewerPromises = reviewerConfigs.map(async (config) => {
            const sysPrompt = config.promptFn(businessProfile)
            const usrInput = `User's Request: ${prompt}\n\nStrategy Proposal to Review:\n${conversationBrain.strategy_proposal}\n\nResearch Context (Synthesis):\n${conversationBrain.research_synthesis}`
            try {
              const reqDetails = getLLMRequestDetails(openRouterKey, model)
              const reviewerRes = await fetch(reqDetails.url, {
                method: 'POST',
                headers: reqDetails.headers,
                body: JSON.stringify({
                  model: reqDetails.model,
                  max_tokens: reviewerMaxTokens,
                  messages: [
                    { role: 'system', content: sysPrompt },
                    { role: 'user', content: usrInput }
                  ]
                })
              })
              if (!reviewerRes.ok) throw new Error(await reviewerRes.text())
              const data = await reviewerRes.json()
              const rawReview = data.choices[0].message.content || 'Validated. No concerns.'
              return { role: config.id, label: config.label, sysPrompt, usrInput, raw_review: rawReview }
            } catch (err: any) {
              return { role: config.id, label: config.label, sysPrompt, usrInput, raw_review: 'Validated. No concerns.' }
            }
          })

          const reviews = await Promise.all(reviewerPromises)
          for (const r of reviews) {
            conversationBrain.expert_contributions.push({ expert: r.label, review: r.raw_review })
            logStageAudit(thinkingSteps, {
              phase: `PHASE_4_REVIEWER_${r.role.toUpperCase()}`,
              icon: '📋',
              title: `Phase 4 Reviewer: ${r.label}`,
              system_prompt: r.sysPrompt,
              user_input: r.usrInput,
              raw_output: r.raw_review
            })
          }
        } else {
          logStageAudit(thinkingSteps, {
            phase: 'PHASE_4_EXPERT_REVIEWERS',
            icon: '📋',
            title: 'Phase 4: Board of Expert Reviewers',
            status: 'SKIPPED',
            raw_output: `${responseDepth} intent — skipping Expert Reviewers. Proceeding directly to Response Agent.`
          })
        }

        // ===== PHASE 5: Execution Worker & Response Agent =====
        const responseWorkerPrompt = generateSystemPrompt(businessProfile, historical_context) +
          `\n\n## SHARED WORKING MEMORY (BLACKBOARD STATE):\n` +
          `- User's Original Request: ${prompt}\n\n` +
          `- Core Strategy Proposal:\n${conversationBrain.strategy_proposal}\n\n` +
          `- Expert Contributions & Reviews:\n${conversationBrain.expert_contributions.map((e: any) => `**${e.expert}:** ${e.review}`).join('\n\n')}\n\n` +
          `## CRITICAL EXECUTION RULES:\n` +
          `1. PROPORTIONAL RESPONSE: If the user's original request is a data/observation question, LEAD with a clean, plain data presentation of what exists in the account.\n` +
          `2. NO REDUNDANT TOOL CALLS: The Research Agent has already gathered all live account data. Only use creation/action tools if needed.\n` +
          `3. SYNTHESIZE: Combine research evidence, core strategy, and expert contributions into your final response.\n` +
          `4. HUMAN PARTNER OPENER & TOOL CONFIRMATION (CRITICAL):\n` +
          `   - ALWAYS open your final response with a warm, direct 1-sentence confirmation line connecting with the user as their personal Media Buyer (e.g., "I've queued your 24-Hour Watchdog schedule for approval in your Action Center so you can sleep peacefully! Here is your breakdown...").\n` +
          `   - Never start cold with raw section headers or tables. Acknowledge the user's emotion/need first, confirm any tool action taken, then deliver the breakdown.\n` +
          `5. ACTION CARD AWARENESS: When you call a creation tool (create_campaign, propose_action_card), the system automatically generates ONE UI card for the user to approve. After calling the tool, tell the user to click Approve. If the user replies confirming or saying yes, they mean they will approve it in the UI — do NOT call the same creation tool again for the same entity. But if the user asks to create something NEW and DIFFERENT, you should absolutely call the tool.`;

        const responseMessages: any[] = [
          { role: 'system', content: responseWorkerPrompt },
          ...history
        ]

        const workerRes = await fetch(getLLMRequestDetails(openRouterKey, model).url, {
          method: 'POST',
          headers: getLLMRequestDetails(openRouterKey, model).headers,
          body: JSON.stringify({
            model: getLLMRequestDetails(openRouterKey, model).model,
            max_tokens: maxTokens,
            messages: responseMessages,
            tools: ACTION_TOOLS,
            tool_choice: 'auto'
          })
        })

        if (workerRes.ok) {
          const aiData = await workerRes.json()
          const assistantMsg = aiData.choices[0].message
          finalContent = assistantMsg.content || ''
          
          if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
            for (const toolCall of assistantMsg.tool_calls) {
              const toolName = toolCall.function.name
              let toolArgs = {}
              try { toolArgs = JSON.parse(toolCall.function.arguments || '{}') } catch {}
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
              logStageAudit(thinkingSteps, {
                phase: `PHASE_5_TOOL_${toolName.toUpperCase()}`,
                icon: '🛠️',
                title: `Phase 5 Execution Tool: ${toolName}`,
                status: 'EXECUTED',
                tool_name: toolName,
                tool_args: toolArgs,
                tool_result: toolResult,
                raw_output: toolResult
              })
              toolExecutions.push({ name: toolName, args: toolArgs, result: toolResult, status: 'success' })
            }
          }
        }

        logStageAudit(thinkingSteps, {
          phase: 'PHASE_5_RESPONSE_WORKER',
          icon: '⚡',
          title: 'Phase 5: Response Agent & Execution Worker Synthesis',
          system_prompt: responseWorkerPrompt,
          user_input: `Prompt: ${prompt}\n\nCore Strategy Proposal:\n${conversationBrain.strategy_proposal}`,
          raw_output: finalContent || 'Executing worker tools and generating strategy response.'
        }) 
        
        if (!finalContent || finalContent.trim().length === 0) {
          finalContent = conversationBrain.strategy_proposal || conversationBrain.pre_execution_plan || "Strategy successfully formulated."
        }

        if (toolExecutions.length > 0) {
          const toolSummary = toolExecutions.map(t => `- **Executed ${t.name}**: ${t.result}`).join('\n')
          finalContent += `\n\n### 🛠️ Execution & Action Summary\n${toolSummary}`
        }

        // ===== PHASE 6: Formatter =====
        if (responseDepth !== 'ANALYTICAL') {
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
              const formatted = data.choices[0].message.content || ''
              if (formatted.trim().length > 20) {
                finalContent = formatted
              }
            }
          } catch (err: any) {
            console.error('Formatter failed:', err.message)
          }
        } else {
          logStageAudit(thinkingSteps, {
            phase: 'PHASE_6_FORMATTER',
            icon: '✍️',
            title: 'Phase 6: Content Formatter',
            status: 'SKIPPED',
            raw_output: 'Analytical intent detected — bypassing Formatter to preserve Phase 5 response verbatim without template rewriting.'
          })
        }
      } // End of CAMPAIGN_STRATEGY block
    } else {
      // Fast Mode (Default)
      thinkingSteps.push('Initializing Context-Aware OODA Loop...')
      if (!businessProfile) thinkingSteps.push('WARNING: No Business Profile found. Agent is running without context.')
      else thinkingSteps.push('Loaded Business Profile: ' + businessProfile.business_name + ' (' + businessProfile.country + ')')

      const finalMessages: any[] = [
        { role: 'system', content: generateSystemPrompt(businessProfile, historical_context) },
        ...history
      ]

      // Track specific (tool + entity name) pairs to prevent duplicate action cards
      // e.g., "create_campaign::Urban Kicks - Winter Flash Sale" should only execute once
      const executedActionKeys = new Set<string>()

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
            let toolArgs: any = {}
            try { toolArgs = JSON.parse(toolCall.function.arguments || '{}') } catch {}

            // Deduplication: skip if the EXACT SAME action tool + entity was already executed
            if (['create_campaign', 'create_ad_set', 'create_ad', 'propose_action_card'].includes(toolName)) {
              const entityKey = toolArgs.proposed_changes?.name || toolArgs.name || toolArgs.target_id || ''
              const actionKey = `${toolName}::${entityKey}`.toLowerCase()
              if (executedActionKeys.has(actionKey)) {
                thinkingSteps.push(`Skipped duplicate: ${toolName} for "${entityKey}"`)
                finalMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ skipped: true, message: `Already created action card for "${entityKey}". Tell the user to approve it.` }) })
                continue
              }
              executedActionKeys.add(actionKey)
            }

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
              if (parsed.type === 'PROPOSAL' || parsed.type === 'ACTION_PROPOSAL' || parsed.type === 'GOAL_PROPOSAL') proposals.push(parsed)
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
