export const CATEGORIES = [
  'Technology & AI',
  'Gaming',
  'Science & Engineering',
  'Finance & Business',
  'Entertainment & Media',
  'Art & Design',
  'Sports & Fitness',
  'Memes & Humor',
  'Lifestyle & Food',
  'Music & Audio',
  'Career & Education',
  'NSFW & Adult'
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface SubredditRecord {
  id: string;
  display_name: string;
  title: string;
  public_description: string;
  created_utc: number;
  over18: boolean;
  category: Category;
  allow_images: boolean;
  allow_videos: boolean;
  community_icon: string;
  primary_color: string;
  subscribers: number;
  num_posts: number | null;
  num_comments: number | null;
  active_accounts?: number | null;
  subs_per_day: number;
  age_days: number;
  heat_score: number;
  tags: string[];
  source: string;
}

export interface Subscription {
  id: string;
  email: string;
  redditUsername?: string;
  category: string;
  deliveryTime: string;
  minSubscribers: number;
  newTimeframe: '24h' | '7d' | '30d' | '90d';
  newLimit: number;
  hot90dLimit: number;
  sfwOnly: boolean;
  status: 'active' | 'paused';
  createdAt: string;
  lastSentAt: string | null;
  sendCount: number;
}

export interface OutboxEntry {
  id: string;
  subscriptionId: string;
  to: string;
  category: string;
  subject: string;
  providerUsed: string;
  deliveredToRealInbox: boolean;
  reason: string;
  newlyCreatedCount: number;
  hottest90dCount: number;
  sentAt: string;
  html: string;
  error?: string;
}

export interface CronRunRecord {
  id: string;
  ranAt: string;
  trigger: string;
  processedSubscriptions: number;
  deliveredCount: number;
}

export interface RadarResponse {
  totalMatched: number;
  newlyCreatedTotal: number;
  newlyCreated: SubredditRecord[];
  hottest90dTotal: number;
  hottest90d: SubredditRecord[];
  categoryCounts: Record<string, number>;
  newCategoryCounts: Record<string, number>;
  categories: readonly string[];
  lastSyncAt: string | null;
  lastSyncSources: string[];
  stats: {
    totalTracked: number;
    newMatched: number;
    hot90dMatched: number;
    topBreakout: SubredditRecord | null;
  };
}
