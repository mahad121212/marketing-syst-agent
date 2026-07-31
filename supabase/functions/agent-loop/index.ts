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

// Intent classification keyword groups
const INTENT_KEYWORDS: Record<string, string[]> = {
  'BRAND_BUILDING': ['experience', 'brand', 'awareness', 'trust', 'organic', 'engage', 'story', 'feel', 'community', 'presence', 'recognition', 'loyalty', 'not just sell', 'not sell'],
  'DIRECT_RESPONSE': ['sales', 'conversions', 'roas', 'profit', 'revenue', 'orders', 'buy', 'purchase', 'checkout', 'sell', 'selling', 'profitable'],
  'SCALING': ['scale', 'increase', 'grow', 'expand', 'double', 'triple', 'maximize', 'boost', 'amplify'],
  'TESTING': ['test', 'try', 'experiment', 'new', 'launch', 'first', 'start', 'begin', 'pilot', 'different perspective']
}

function classifyUserIntent(prompt: string, businessProfile: any, campaignCount: number) {
  const promptLower = prompt.toLowerCase()

  // 1. Budget Tier Classification
  // Extract budget amount from prompt using regex
  const budgetPatterns = [
    /(?:pkr|inr|usd|aed|sar|gbp|eur|rs\.?|₹|\$|£|€)\s*([\d,]+(?:\.\d+)?)\s*(?:k|thousand|lac|lakh)?/i,
    /([\d,]+(?:\.\d+)?)\s*(?:k|thousand|lac|lakh)?\s*(?:pkr|inr|usd|aed|sar|gbp|eur|rupees?|dollars?|dirhams?|rs)/i,
    /(?:budget|have|got|spend)\s*(?:is|of|us)?\s*(?:pkr|inr|usd|aed|rs\.?|₹|\$|£|€)?\s*([\d,]+(?:\.\d+)?)\s*(?:k|thousand|lac|lakh)?/i
  ]

  let extractedBudget: any = null
  let budgetTier = 'GROWTH' // default

  for (const pattern of budgetPatterns) {
    const match = promptLower.match(pattern)
    if (match) {
      let amount = parseFloat(match[1].replace(/,/g, ''))
      // Handle multipliers
      if (/k|thousand/i.test(match[0])) amount *= 1000
      if (/lac|lakh/i.test(match[0])) amount *= 100000

      const currency = businessProfile?.currency || 'PKR'
      const rate = CURRENCY_TO_USD[currency] || 0.01
      const usdEquivalent = amount * rate

      extractedBudget = { amount, currency, usd_equivalent: Math.round(usdEquivalent) }

      if (usdEquivalent < 100) budgetTier = 'MICRO'
      else if (usdEquivalent < 1000) budgetTier = 'GROWTH'
      else budgetTier = 'SCALE'
      break
    }
  }

  // Fallback to business profile budget if not found in prompt
  if (!extractedBudget && businessProfile?.monthly_ad_budget) {
    const currency = businessProfile.currency || 'PKR'
    const rate = CURRENCY_TO_USD[currency] || 0.01
    const usdEquivalent = businessProfile.monthly_ad_budget * rate
    extractedBudget = { amount: businessProfile.monthly_ad_budget, currency, usd_equivalent: Math.round(usdEquivalent) }
    if (usdEquivalent < 100) budgetTier = 'MICRO'
    else if (usdEquivalent < 1000) budgetTier = 'GROWTH'
    else budgetTier = 'SCALE'
  }

  // 2. Market Trust Classification
  let countryRaw = (businessProfile?.country || 'Pakistan').trim()
  let countryCode = countryRaw.length <= 3
    ? countryRaw.toUpperCase().substring(0, 2)
    : (COUNTRY_NAME_TO_CODE[countryRaw.toLowerCase()] || 'PK')
  const marketType = MARKET_TRUST_MAP[countryCode] || 'EMERGING'

  // 3. Intent Classification (keyword matching)
  const intentTypes: string[] = []
  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (keywords.some(kw => promptLower.includes(kw))) {
      intentTypes.push(intent)
    }
  }
  if (intentTypes.length === 0) intentTypes.push('DIRECT_RESPONSE')

  // 4. Industry from business profile
  const industry = (businessProfile?.industry || 'general').toLowerCase()

  // 5. Campaign Stage
  let campaignStage = 'COLD_START'
  if (campaignCount > 0) campaignStage = 'ESTABLISHED'

  return {
    budget_tier: budgetTier,
    market_type: marketType,
    intent_types: intentTypes,
    industry,
    campaign_stage: campaignStage,
    extracted_budget: extractedBudget
  }
}

async function retrieveKnowledge(supabaseClient: any, dimensions: any): Promise<string> {
  try {
    const { data: allKnowledge, error } = await supabaseClient
      .from('marketing_knowledge')
      .select('title, content, dimensions, priority')
      .eq('is_active', true)

    if (error || !allKnowledge || allKnowledge.length === 0) {
      console.error('Knowledge retrieval failed:', error?.message || 'No documents found')
      return ''
    }

    // Score each document by dimension overlap
    const scored = allKnowledge.map((doc: any) => {
      let score = 0
      const dims = doc.dimensions || {}

      // Budget tier match (weight: 2)
      if (dims.budget_tiers?.includes(dimensions.budget_tier) || dims.budget_tiers?.includes('ALL')) score += 2

      // Market type match (weight: 2)
      if (dims.market_types?.includes(dimensions.market_type) || dims.market_types?.includes('ALL')) score += 2

      // Intent match (weight: 3 — strongest signal)
      for (const intent of dimensions.intent_types) {
        if (dims.intent_types?.includes(intent) || dims.intent_types?.includes('ALL')) { score += 3; break }
      }

      // Campaign stage match (weight: 1)
      if (dims.campaign_stages?.includes(dimensions.campaign_stage) || dims.campaign_stages?.includes('ALL')) score += 1

      // Industry match (weight: 1)
      if (dims.industries?.includes(dimensions.industry) || dims.industries?.includes('ALL')) score += 1

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
function generateIntentRouterPrompt(businessProfile: any, historical_context?: string) {
  let profileContext = 'No business profile found. Ask the user to fill out their Business Profile in the dashboard.';
  
  if (businessProfile) {
    profileContext = `
HOLISTIC BUSINESS & MARKET CONTEXT:
- Business Name: ${businessProfile.business_name}
- Target Market & Currency: ${businessProfile.country} (${businessProfile.currency || 'USD'})
- Monthly Ad Budget Cap: ${businessProfile.monthly_ad_budget ? businessProfile.monthly_ad_budget + ' ' + (businessProfile.currency || 'USD') + '/mo' : 'Not provided'}
`;
  }

  return `You are the Intent Router & Blackboard Initiator.
Your task is to analyze the user's latest request and route it correctly.

${profileContext}

## Conversation History & Previous Decisions:
${historical_context || 'No conversation history.'}

## Intent Classification Rules:
1. NEW_CAMPAIGN_REQUEST: The user is asking for a brand new campaign strategy, a full account audit, or a major strategic overhaul.
2. CHALLENGE_DECISION: The user is asking "why" you recommended a specific thing in a previous message, or disagreeing with a specific tactic (e.g. "Why 1 campaign?", "I don't like UGC").
3. GENERAL_QUESTION: The user is asking a basic definition, saying hello, or asking something unrelated to a campaign build.

You MUST respond ONLY with a JSON object:
{
  "intent": "NEW_CAMPAIGN_REQUEST" | "CHALLENGE_DECISION" | "GENERAL_QUESTION",
  "internal_monologue": "First-person narrative thought on what the user wants.",
  "conversational_response": "(ONLY if intent is GENERAL_QUESTION) Direct answer.",
  "challenged_decision_explanation": "(ONLY if intent is CHALLENGE_DECISION) Explain the rationale based on conversation history without regenerating a full plan.",
  "strategic_blueprint": "(ONLY if intent is NEW_CAMPAIGN_REQUEST) Detailed masterclass strategy blueprint.",
  "subtasks": ["(ONLY if intent is NEW_CAMPAIGN_REQUEST) Subtask 1", "Subtask 2"],
  "currency": "${businessProfile?.currency || 'PKR'}"
}`;
}

function generatePreExecutionPlanReviewerPrompt(businessProfile: any) {
  let profileContext = businessProfile ? `Business: ${businessProfile.business_name} (${businessProfile.country})` : '';
  return `You are the Pre-Execution Planning Reviewer.
Your job is to audit the Intent Router's blueprint BEFORE any research or execution starts:
- Validate if the plan's overall logic, budget pacing, and subtask roadmap are sound.
- If the plan is flawed or missed a critical dimension, mark "FAIL" and provide a corrected blueprint.
${profileContext}

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "internal_thought": "Write 1 paragraph evaluating the blueprint quality",
  "corrected_blueprint": "Detailed corrected blueprint if verdict is FAIL, or empty string if PASS"
}`;
}

function generateResearchAgentPrompt(businessProfile: any) {
  return `You are the Research & Evidence Gathering Agent (Blackboard Contributor).
Your sole job is to evaluate assigned subtasks and use your available tools to gather empirical data and evidence.
Do NOT write final user recommendations. Simply query tools to collect metrics and active campaign structures.`;
}

function generateCentralThinkingLoopPrompt(businessProfile: any) {
  return `You are the Central Strategy Reasoning Engine.
Your sole job is REASONING-FIRST problem solving. Analyze the user's situation, gathered evidence, and expert inputs to solve their exact query.

REASONING RULES:
1. Reason before deciding: Explicitly record assumptions, unknowns, and trade-offs.
2. Evaluate alternatives: Compare 2-3 approaches and document why alternatives were set aside.
3. Problem-solving focus: Do NOT generate a generic 10-page marketing audit report. Focus purely on finding the optimal, practical solution for the user.

Respond ONLY with a JSON object:
{
  "beliefs": [
    { "claim": "State a core strategic belief", "confidence": 95, "rationale": "Reasoning based on evidence" }
  ],
  "assumptions": ["Key assumption 1", "Key assumption 2"],
  "unknowns": ["Critical unknown 1"],
  "decision_history": [
    { "decision": "Chosen tactic", "reason": "Why chosen", "confidence": 90, "alternatives_considered": ["Alternative 1", "Alternative 2"], "why_rejected": "Why alternatives were set aside" }
  ],
  "core_strategy": "Concise, actionable strategic solution tailored specifically to the user's prompt."
}`;
}

function generateResponseGeneratorPrompt(businessProfile: any) {
  let profileContext = businessProfile ? `Business: ${businessProfile.business_name} (${businessProfile.country})` : '';
  return `You are MetaAgent AI, a senior growth strategist and media buyer pair-programming directly with the user.

${profileContext}

CONVERSATIONAL DIRECTION:
1. Speak as ONE continuous, fluid conversational assistant (like chatting directly with a senior colleague).
2. DO NOT format your output as a formal audit report, website article, or multi-section marketing document.
3. Answer the user's specific question or address their exact objection directly, naturally, and warmly.
4. Seamlessly incorporate your internal beliefs, assumptions, and decision rationale into your natural dialogue.
5. If creating campaigns, ad sets, or ads is required, use your tools (create_campaign, create_ad_set, create_ad) to execute them.
6. Keep the response concise, engaging, and conversational.`;
}

function generateStrategyReviewerPrompt(businessProfile: any) {
  let profileContext = businessProfile ? `Business: ${businessProfile.business_name} (${businessProfile.country})` : '';
  return `You are the Chief Strategy Officer Reviewer.
Your job is to audit the response for holistic strategy depth and actionable intelligence:
- FAIL if the response is generic, relies on rigid templates, or lacks a clear campaign architecture.
- PASS ONLY if the response provides a masterclass strategic breakdown.
- CONSTRUCTIVE ALTERNATIVE: You MUST provide a concrete alternative strategic direction or improvement that would make this campaign 10x better.
${profileContext}

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "internal_thought": "Write 1-2 paragraphs of natural, first-person narrative thought evaluating this strategy",
  "feedback": "Detailed explanation of strategic improvements needed if verdict is FAIL",
  "alternative_recommendation": "Constructive alternative strategy or specific improvement idea"
}`;
}

function generateCopyReviewerPrompt(businessProfile: any) {
  return `You are the Lead Copywriting Reviewer.
Your job is to audit copywriting suggestions, ad copy hooks, and primary texts:
- FAIL if the copy is dry or standard AI-sounding.
- CONSTRUCTIVE ALTERNATIVE: You MUST provide a concrete alternative copy hook framework or angle.

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "internal_thought": "Write 1-2 paragraphs of natural, first-person narrative thought evaluating the copy quality",
  "feedback": "Detailed explanation of copy improvements needed if verdict is FAIL",
  "alternative_recommendation": "Constructive copy hook or angle recommendation"
}`;
}

function generateCreativeReviewerPrompt(businessProfile: any) {
  return `You are the Creative Director Reviewer.
Your job is to audit visual layout proposals, image/video suggestions, and creative hooks:
- CONSTRUCTIVE ALTERNATIVE: You MUST provide a concrete alternative visual layout, pacing, or format recommendation.

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "internal_thought": "Write 1-2 paragraphs of natural, first-person narrative thought evaluating the creative proposals",
  "feedback": "Detailed explanation of creative improvements needed if verdict is FAIL",
  "alternative_recommendation": "Constructive visual layout or format recommendation"
}`;
}

function generateDiversityReviewerPrompt(businessProfile: any) {
  let budgetCap = businessProfile?.monthly_ad_budget ? `${businessProfile.monthly_ad_budget} ${businessProfile.currency || 'USD'}` : 'Not provided';
  return `You are the Creative Diversity Auditor.
Your job is to contextually audit the diversity of ad angles, hooks, and formats based on budget scale (Cap: ${budgetCap}).
- CONSTRUCTIVE ALTERNATIVE: Offer a constructive recommendation for creative format balance.

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "internal_thought": "Write 1-2 paragraphs of natural, first-person narrative thought evaluating the creative diversity contextually",
  "feedback": "Detailed explanation of creative diversity improvements needed if verdict is FAIL",
  "alternative_recommendation": "Constructive creative diversity recommendation"
}`;
}

function generateComplianceReviewerPrompt(businessProfile: any) {
  return `You are the Technical Operations & Compliance Auditor.
Audit tool execution, compliance with Meta policies, and operational safety.
- CONSTRUCTIVE ALTERNATIVE: Offer a constructive policy/safety safeguard recommendation.

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "internal_thought": "Write 1-2 paragraphs of natural, first-person narrative thought evaluating execution safety and policy compliance",
  "feedback": "Detailed explanation of compliance or tool safety failures if verdict is FAIL",
  "alternative_recommendation": "Constructive policy/safety safeguard recommendation"
}`;
}

function generatePerformanceReviewerPrompt(businessProfile: any) {
  let currency = businessProfile?.currency || 'PKR';
  return `You are the VP of Finance & Growth Reviewer.
Audit budget pacing, currency integrity (${currency}), and expected ROAS economics.
- CONSTRUCTIVE ALTERNATIVE: Offer a constructive financial pacing or allocation recommendation.

Respond ONLY with a JSON object:
{
  "verdict": "PASS" | "FAIL",
  "internal_thought": "Write 1-2 paragraphs of natural, first-person narrative thought evaluating the budget and performance expectations",
  "feedback": "Detailed explanation of financial pacing improvements needed if verdict is FAIL",
  "alternative_recommendation": "Constructive budget pacing or financial recommendation"
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
  return `You are NOT the conversational assistant. You are an INTERNAL formatting service.
Your sole job is to clean up, structure, and format the strategy text provided in the prompt into a beautiful, high-converting markdown layout.

STRICT RULES:
- Do NOT speak to the user, greet the user, or explain your role.
- Do NOT ask questions or request additional content (NEVER say "Please provide...", "Paste the details...", etc.).
- Do NOT output conversational filler.
- If the provided input is incomplete or missing, return the provided input text VERBATIM without modification.
- Return ONLY the formatted markdown representation of the provided strategy.`;
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

      // ===== PHASE 0: Marketing Knowledge Engine =====
      thinkingSteps.push('📚 Phase 0: Classifying intent & retrieving marketing intelligence...')

      // Count existing campaigns for stage classification
      const { count: campaignCount } = await supabaseClient
        .from('campaigns')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)

      const dimensions = classifyUserIntent(prompt, businessProfile, campaignCount || 0)
      thinkingSteps.push(`📊 Classified: Budget=${dimensions.budget_tier} (${dimensions.extracted_budget ? '$' + dimensions.extracted_budget.usd_equivalent + ' USD equiv.' : 'unknown'}), Market=${dimensions.market_type}, Intent=${dimensions.intent_types.join('+')}, Stage=${dimensions.campaign_stage}`)

      const knowledgeContext = await retrieveKnowledge(supabaseClient, dimensions)
      if (knowledgeContext) {
        thinkingSteps.push(`📚 Retrieved ${knowledgeContext.split('###').length - 1} marketing knowledge frameworks as context.`)
      } else {
        thinkingSteps.push('📚 No knowledge frameworks matched (proceeding with LLM general knowledge).')
      }

      // Build the enriched Planner input with knowledge context
      const plannerUserMessage = knowledgeContext
        ? `## MARKETING INTELLIGENCE CONTEXT (Retrieved Frameworks)\nThe following are universal marketing frameworks retrieved based on the user's context. Use these as reference material to inform your strategic blueprint — they are principles, not commands.\n\n${knowledgeContext}\n\n## CLASSIFIED DIMENSIONS\n- Budget Tier: ${dimensions.budget_tier}${dimensions.extracted_budget ? ` (${dimensions.extracted_budget.amount} ${dimensions.extracted_budget.currency} ≈ $${dimensions.extracted_budget.usd_equivalent} USD)` : ''}\n- Market Type: ${dimensions.market_type}\n- User Intent: ${dimensions.intent_types.join(', ')}\n- Campaign Stage: ${dimensions.campaign_stage}\n- Industry: ${dimensions.industry}\n\n## USER REQUEST\n${prompt}`
        : prompt

      // ===== PHASE 1: Intent Router & Blackboard Initiator =====
      thinkingSteps.push('🧭 Intent Router classifying user request & retrieving past decisions...')
      
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
              { role: 'system', content: generateIntentRouterPrompt(businessProfile, historical_context) },
              { role: 'user', content: plannerUserMessage }
            ]
          })
        })
        if (!plannerRes.ok) throw new Error(await plannerRes.text())
        const plannerData = await plannerRes.json()
        const rawContent = plannerData.choices[0].message.content || '{}'
        
        const cleanContent = rawContent.replace(/```json/g, '').replace(/```/g, '').trim()
        planJson = JSON.parse(cleanContent)
        
        if (planJson.internal_monologue) {
          thinkingSteps.push(`💭 Intent Router Thought:\n"${planJson.internal_monologue}"`)
        }
      } catch (err: any) {
        console.error('Intent Router phase failed, using fallback:', err.message)
        thinkingSteps.push('🧭 Intent Router encountered an error. Proceeding with fallback NEW_CAMPAIGN_REQUEST.')
        planJson = {
          intent: 'NEW_CAMPAIGN_REQUEST',
          currency: businessProfile?.currency || 'PKR',
          strategic_blueprint: "Standard growth strategy setup.",
          subtasks: ["Understand budget constraints", "Analyze competitors", "Design standard growth campaign"]
        }
      }

      // ===== CONVERSATIONAL BYPASS & DECISION LOOKUP =====
      if (planJson.intent === 'GENERAL_QUESTION') {
        thinkingSteps.push('💬 General conversational intent detected. Bypassing strategic deep dive.')
        finalContent = planJson.conversational_response || "I'm here to help. Could you clarify what you mean?"
      } else if (planJson.intent === 'CHALLENGE_DECISION') {
        thinkingSteps.push('🔍 User challenging a previous decision. Looking up decision history & answering instantly...')
        finalContent = planJson.challenged_decision_explanation || "Based on our previous reasoning, this was the optimal path. Let me know if you want to adjust the constraints."
      } else {
        // Shared Working Memory (The Living Mental Model)
        const conversationBrain: any = {
          goal: prompt,
          classified_dimensions: dimensions,
          currency: planJson.currency || businessProfile?.currency || 'PKR',
          planner_blueprint: planJson.strategic_blueprint,
          subtasks: planJson.subtasks || [],
          evidence: [],
          expert_contributions: [],
          beliefs: [],
          assumptions: [],
          unknowns: [],
          decision_history: [],
          core_strategy: ''
        }

        // ===== PHASE 1.5: Pre-Execution Plan Reviewer =====
        thinkingSteps.push('🛡️ Pre-Execution: Planning Reviewer auditing strategic blueprint before research...')
        try {
          const reqDetails = getLLMRequestDetails(openRouterKey, model)
          const planReviewRes = await fetch(reqDetails.url, {
            method: 'POST',
            headers: reqDetails.headers,
            body: JSON.stringify({
              model: reqDetails.model,
              max_tokens: reviewerMaxTokens,
              messages: [
                { role: 'system', content: generatePreExecutionPlanReviewerPrompt(businessProfile) },
                { role: 'user', content: `Blueprint to audit: ${planJson.strategic_blueprint}\nSubtasks: ${JSON.stringify(planJson.subtasks)}` }
              ]
            })
          })
          if (planReviewRes.ok) {
            const data = await planReviewRes.json()
            const clean = (data.choices[0].message.content || '{}').replace(/```json/g, '').replace(/```/g, '').trim()
            const parsed = JSON.parse(clean)
            if (parsed.verdict === 'FAIL' && parsed.corrected_blueprint) {
              conversationBrain.planner_blueprint = parsed.corrected_blueprint
              thinkingSteps.push('🛡️ Pre-Execution Plan Reviewer: Flaws detected. Upgraded blueprint before research.')
            } else {
              thinkingSteps.push('🛡️ Pre-Execution Plan Reviewer: Blueprint validated (PASS).')
            }
          }
        } catch (err: any) {
          console.error('Pre-execution plan reviewer error:', err.message)
        }

        // ===== PHASE 2: Research Agent (Evidence Gathering) =====
        thinkingSteps.push('🔬 Phase 2: Research Agent gathering evidence and live ad account metrics...')
        const researchMessages: any[] = [
          { role: 'system', content: generateResearchAgentPrompt(businessProfile) + `\n\nSUBTASKS TO RESEARCH:\n${JSON.stringify(conversationBrain.subtasks)}` },
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
              tools: AGENT_TOOLS,
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

              thinkingSteps.push('🛠️ Research Tool Executed: ' + toolName)
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
              conversationBrain.evidence.push({ tool: toolName, args: toolArgs, result: toolResult.substring(0, 500) })
              researchMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: toolResult })
            }
          } else {
            break
          }
        }
        thinkingSteps.push(`🔬 Research Agent compiled ${conversationBrain.evidence.length} evidence data points into Shared Memory.`)

        // ===== PHASE 3: Board of Constructive Expert Debaters =====
        thinkingSteps.push('📋 Phase 3: Board of Experts contributing alternative angles to the Blackboard...')
        const reviewerConfigs = [
          { id: 'strategy', label: '🎯 CSO Strategy Expert', promptFn: generateStrategyReviewerPrompt },
          { id: 'copy', label: '✍️ Lead Copywriting Expert', promptFn: generateCopyReviewerPrompt },
          { id: 'creative', label: '🎨 Creative Director Expert', promptFn: generateCreativeReviewerPrompt },
          { id: 'diversity', label: '🎭 Creative Diversity Auditor', promptFn: generateDiversityReviewerPrompt },
          { id: 'compliance', label: '🛡️ Operations & Policy Auditor', promptFn: generateComplianceReviewerPrompt },
          { id: 'performance', label: '📊 Finance & Performance Expert', promptFn: generatePerformanceReviewerPrompt }
        ]

        const reviewerPromises = reviewerConfigs.map(async (config) => {
          try {
            const reqDetails = getLLMRequestDetails(openRouterKey, model)
            const reviewerRes = await fetch(reqDetails.url, {
              method: 'POST',
              headers: reqDetails.headers,
              body: JSON.stringify({
                model: reqDetails.model,
                max_tokens: reviewerMaxTokens,
                messages: [
                  { role: 'system', content: config.promptFn(businessProfile) },
                  { role: 'user', content: `Original Blueprint: ${conversationBrain.planner_blueprint}\nResearch Evidence: ${JSON.stringify(conversationBrain.evidence)}` }
                ]
              })
            })
            if (!reviewerRes.ok) throw new Error(await reviewerRes.text())
            const data = await reviewerRes.json()
            const clean = (data.choices[0].message.content || '{}').replace(/```json/g, '').replace(/```/g, '').trim()
            const parsed = JSON.parse(clean)
            return { role: config.id, label: config.label, ...parsed }
          } catch (err: any) {
            return { role: config.id, label: config.label, verdict: 'PASS', internal_thought: 'No objection.', alternative_recommendation: '' }
          }
        })

        const reviews = await Promise.all(reviewerPromises)
        for (const r of reviews) {
          if (r.alternative_recommendation) {
            conversationBrain.expert_contributions.push({ expert: r.label, verdict: r.verdict, thought: r.internal_thought, recommendation: r.alternative_recommendation })
            thinkingSteps.push(`${r.label} added to Blackboard: "${r.alternative_recommendation}"`)
          }
        }

        // ===== PHASE 4: Central Thinking Loop (The Living Belief Engine) =====
        thinkingSteps.push('🧠 Phase 4: Central Thinking Engine synthesizing all inputs into stable Beliefs...')
        try {
          const reqDetails = getLLMRequestDetails(openRouterKey, model)
          const strategyRes = await fetch(reqDetails.url, {
            method: 'POST',
            headers: reqDetails.headers,
            body: JSON.stringify({
              model: reqDetails.model,
              max_tokens: maxTokens,
              messages: [
                { role: 'system', content: generateCentralThinkingLoopPrompt(businessProfile) },
                { role: 'user', content: `## BLACKBOARD STATE:\n- User Goal: ${prompt}\n- Validated Blueprint: ${conversationBrain.planner_blueprint}\n- Classified Dimensions: ${JSON.stringify(conversationBrain.classified_dimensions)}\n- Gathered Research Evidence:\n${JSON.stringify(conversationBrain.evidence, null, 2)}\n- Expert Contributions:\n${JSON.stringify(conversationBrain.expert_contributions, null, 2)}\n\nFormulate the system's core Beliefs, Assumptions, and final Core Strategy.` }
              ]
            })
          })
          if (strategyRes.ok) {
            const data = await strategyRes.json()
            const clean = (data.choices[0].message.content || '{}').replace(/```json/g, '').replace(/```/g, '').trim()
            const parsed = JSON.parse(clean)
            
            conversationBrain.beliefs = parsed.beliefs || []
            conversationBrain.assumptions = parsed.assumptions || []
            conversationBrain.unknowns = parsed.unknowns || []
            conversationBrain.decision_history = parsed.decision_history || []
            conversationBrain.core_strategy = parsed.core_strategy || conversationBrain.planner_blueprint
            
            thinkingSteps.push(`🧠 Central Thinking Engine stabilized ${conversationBrain.beliefs.length} core beliefs with high confidence.`)
            
            // Log decision history to UI
            for (const dec of conversationBrain.decision_history) {
              thinkingSteps.push(`⚖️ Decision: ${dec.decision} (Confidence: ${dec.confidence}%)\n   Rationale: ${dec.reason}\n   Rejected: ${dec.alternatives_considered.join(', ')} (${dec.why_rejected})`)
            }
          }
        } catch (err: any) {
          console.error('Central Thinking Engine failed:', err.message)
          conversationBrain.core_strategy = conversationBrain.planner_blueprint
        }

        // ===== PHASE 5: Response Generator & Execution Worker =====
        thinkingSteps.push('⚡ Phase 5: Response Agent generating output from finalized Beliefs...')
        const responseWorkerPrompt = generateResponseGeneratorPrompt(businessProfile) +
          `\n\n## STABILIZED MENTAL MODEL (BELIEFS):\n` +
          `- Goal: ${prompt}\n` +
          `- Core Beliefs:\n${JSON.stringify(conversationBrain.beliefs, null, 2)}\n\n` +
          `- Decision History:\n${JSON.stringify(conversationBrain.decision_history, null, 2)}\n\n` +
          `- Final Core Strategy Execution Plan:\n${conversationBrain.core_strategy}\n\n` +
          `INSTRUCTIONS: Communicate these beliefs naturally to the user. Execute any required Meta tools now.`;

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
            tools: AGENT_TOOLS,
            tool_choice: 'auto'
          })
        })

        if (workerRes.ok) {
          const aiData = await workerRes.json()
          const assistantMsg = aiData.choices[0].message
          finalContent = assistantMsg.content || conversationBrain.core_strategy || conversationBrain.planner_blueprint
          
          if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
            for (const toolCall of assistantMsg.tool_calls) {
              const toolName = toolCall.function.name
              let toolArgs = {}
              try { toolArgs = JSON.parse(toolCall.function.arguments || '{}') } catch {}
              thinkingSteps.push('🛠️ Execution Tool Executed: ' + toolName)
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
              toolExecutions.push({ name: toolName, args: toolArgs, result: toolResult.substring(0, 500), status: 'success' })
            }
          }
        } else {
          finalContent = conversationBrain.core_strategy || conversationBrain.planner_blueprint
        }

        // Ensure finalContent is populated from the central mental model if empty
        if (!finalContent || finalContent.trim().length === 0) {
          finalContent = conversationBrain.core_strategy || conversationBrain.planner_blueprint || "Strategy successfully calculated."
        }
        thinkingSteps.push('💬 Response Generator finalized conversational answer.')
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
