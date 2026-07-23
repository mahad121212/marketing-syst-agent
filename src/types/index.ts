export interface Campaign {
  id: string;
  name: string;
  objective: 'CONVERSIONS' | 'LEAD_GEN' | 'REACH' | 'TRAFFIC';
  status: 'ACTIVE' | 'PAUSED' | 'LEARNING' | 'OPTIMIZING';
  budget: number;
  spent: number;
  roas: number;
  cpa: number;
  clicks: number;
  conversions: number;
  targetAudience: string;
  createdAt: string;
}

export interface AgentMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  content: string;
  timestamp: string;
  thinkingSteps?: string[];
  toolCalls?: {
    name: string;
    args: Record<string, any>;
    status: 'pending' | 'success' | 'failed';
    result?: string;
  }[];
  proposal?: {
    campaignName: string;
    budget: number;
    objective: string;
    suggestedCopy: string;
    targetAudience: string;
  };
}

export interface MetricSummary {
  totalSpend: number;
  totalROAS: number;
  averageCPA: number;
  activeCampaignsCount: number;
  optimumEfficiencyScore: number;
}
