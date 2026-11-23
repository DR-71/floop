const fs = require('fs');
const path = require('path');

const BUNDLED_DATA_DIR = path.join(__dirname, '..', 'data');
const WRITABLE_DATA_DIR = process.env.VERCEL ? '/tmp/floop-data' : BUNDLED_DATA_DIR;
const RAW_ARCTIC_FILE = path.join(BUNDLED_DATA_DIR, 'raw_arctic.json');
const BUNDLED_PROCESSED_FILE = path.join(BUNDLED_DATA_DIR, 'subreddits.json');
const WRITABLE_PROCESSED_FILE = path.join(WRITABLE_DATA_DIR, 'subreddits.json');

const CATEGORIES = [
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
];

// Negation strip regex so "Strictly SFW, no NSFW, no porn" does not trigger NSFW classification
const NEGATED_NSFW_REGEX = /\b(no|not|never|without|zero|non|strictly\s+sfw)\s+[-/]*\s*(nsfw|porn|nudes|nude|adult|18\+|explicit|sexual|lewds)\b/gi;

const NSFW_REGEX = /\b(nsfw|porn|pornstar|pornstars|sex|nude|nudes|nudism|tits|boob|boobs|boobiverse|dick|cock|cuck|pussy|pussys|cum|slut|slutty|whore|milf|hentai|r34|rule34|onlyfans|fansly|gooner|gooners|gonners|gooning|fetish|bdsm|erotic|erotica|boudoir|busty|jerkbud|jav|xxx|18\+|18plus|stripper|camgirl|femboy|lewds|ecchi|uncensored|playboy|gonewild|fap|booty|lingerie|kink|hookup|afterdark|hotwife|hotwives|bbw|femdom|intimate|fwb|sexdoll)\b|gonewild|rule34|r34|nsfw|onlyfans|tits|cock|milf|hentai|goon|18plus|poornhub/i;

const BLOCKLIST_REGEX = /coprophil|scat|incest|ensest|behen|teen|minor|underage|escort|rape|gore|gangbang|cunny/i;

// Weighted domain keyword rules for accurate multi-signal classification of real Reddit communities
const CATEGORY_MATCHERS = [
  {
    category: 'Technology & AI',
    tokens: [
      'ai', 'ml', 'llm', 'llms', 'gpt', 'claude', 'openai', 'anthropic', 'github', 'repo', 'repos',
      'code', 'coding', 'programmer', 'programming', 'developer', 'developers', 'software', 'hardware',
      'iphone', 'apple', 'android', 'linux', 'tech', 'technology', 'cyber', 'cybersecurity', 'cloud',
      'saas', 'robotics', 'electronic', 'electronics', 'foldable', 'computing', 'automation', 'agent',
      'agents', 'agentic', 'mcp', 'rust', 'python', 'javascript', 'typescript', 'homelab',
      'selfhosted', 'opensource', 'server', 'servers', 'gpu', 'vram', 'nixos', 'sistemi', 'operativi',
      'compiler', 'firmware', 'embedded', 'microcontroller', 'webdev', 'app', 'apps', 'api', 'mac'
    ]
  },
  {
    category: 'Gaming',
    tokens: [
      'game', 'games', 'gaming', 'gamer', 'gamers', 'wow', 'wowforever', 'warcraft', 'pokemon', 'tcg', 'rpg',
      'mmorpg', 'playstation', 'ps5', 'xbox', 'nintendo', 'switch', '3ds', 'steam', 'esports',
      'minecraft', 'roblox', 'valorant', 'fortnite', 'indiegame', 'modding', 'warhammer',
      'khazalite', 'mushoku', 'valko', 'deepspace', 'sims', 'gta', 'zelda', 'elden', 'handheld',
      'retrogaming', 'speedrun', 'tabletop', 'roguelike', 'deckbuilder', 'simracing', 'arknights',
      'wardogs', 'marvelsuperwar', 'playout', 'runescape', 'mod', 'mods', 'console', 'multiplayer'
    ]
  },
  {
    category: 'Science & Engineering',
    tokens: [
      'science', 'scientific', 'engineering', 'engineer', 'engineers', 'physics', 'chemistry',
      'biology', 'orbit', 'orbinauts', 'satellite', 'astronomy', 'telescope', 'nasa', 'orbital', 'rocket', 'math',
      'mathematics', 'medical', 'plague', 'outbreak', 'medicine', 'neuro', 'neuroscience',
      'climate', 'energy', 'fusion', 'battery', 'quantum', 'mechanics', 'aerospace', 'geology',
      'materials', 'biotech', 'microscopy', 'tokamak', 'telemetry', 'cad', 'parametric', 'research'
    ]
  },
  {
    category: 'Finance & Business',
    tokens: [
      'finance', 'financial', 'invest', 'investing', 'investor', 'investors', 'stock', 'stocks',
      'options', 'crypto', 'bitcoin', 'ethereum', 'defi', 'entrepreneur', 'entrepreneurs',
      'startup', 'startups', 'founder', 'founders', 'business', 'economy', 'economics', 'macro',
      'trading', 'trader', 'traders', 'daytrading', 'market', 'markets', 'wealth', 'money', 'b2b',
      'ecommerce', 'realestate', 'deals', 'restock', 'luxury', 'ridiculux', 'venture', 'tax',
      'dividend', 'bonds', 'treasury', 'mrr', 'pricing', 'freight', 'supplychain', 'nasdaq', 'etf'
    ]
  },
  {
    category: 'Art & Design',
    tokens: [
      'art', 'arts', 'artwork', 'artworks', 'artist', 'artists', 'design', 'designer', 'designers',
      'drawing', 'draw', 'doodle', 'doodled', 'paint', 'painting', 'illustration', 'illustrator',
      'photography', 'photographer', 'camera', 'architecture', 'craft', 'satisfyingart', 'ui',
      'ux', 'graphic', 'sculpture', 'typography', 'font', 'fonts', 'sketch', 'sketchbook',
      'isometric', 'voxel', 'ceramic', 'printmaking', 'frontierart', 'vector', 'vectorcraft',
      'blender', 'motion', 'creative'
    ]
  },
  {
    category: 'Sports & Fitness',
    tokens: [
      'sport', 'sports', 'soccer', 'football', 'basketball', 'nba', 'nfl', 'baseball', 'f1',
      'motorsport', 'racing', 'gym', 'fitness', 'fit', 'running', 'marathon', 'trail', 'lifting',
      'powerlifting', 'bodybuilding', 'workout', 'workouts', 'martial', 'mma', 'ufc', 'bjj',
      'tennis', 'golf', 'cricket', 'athletic', 'cycling', 'triathlon', 'climbing', 'endurance',
      'physique', 'aerobic', 'lactate', 'pickup', 'league', 'athlete'
    ]
  },
  {
    category: 'Lifestyle & Food',
    tokens: [
      'food', 'cooking', 'cook', 'kitchen', 'recipe', 'recipes', 'baking', 'bread', 'sourdough',
      'chef', 'coffee', 'espresso', 'tea', 'wok', 'grill', 'travel', 'travelers', 'backpacking',
      'fashion', 'streetwear', 'outfits', 'makeup', 'interior', 'garden', 'gardening', 'plants',
      'pet', 'pets', 'cat', 'cats', 'dog', 'dogs', 'dating', 'parenting', 'minimalism', 'beauty',
      'skincare', 'vegan', 'culinary', 'pantry', 'grocery', 'cars', 'automotive', 'lifestyle', 'home'
    ]
  },
  {
    category: 'Music & Audio',
    tokens: [
      'music', 'musician', 'musicians', 'song', 'songs', 'album', 'albums', 'band', 'bands',
      'rap', 'hiphop', 'rock', 'metal', 'indiepop', 'jazz', 'synth', 'synthesizer', 'eurorack',
      'modular', 'guitar', 'guitarists', 'bassists', 'piano', 'drums', 'recordists', 'daw',
      'soundtrack', 'soundtracks', 'audio', 'audiophile', 'headphones', 'iem', 'vinyl', 'concert',
      'spotify', 'singer', 'vocal', 'cassette', 'soundstage', 'beat', 'beats', 'mix'
    ]
  },
  {
    category: 'Career & Education',
    tokens: [
      'career', 'careers', 'job', 'jobs', 'hiring', 'recruit', 'recruiting', 'recruitment',
      'interview', 'interviews', 'resume', 'remotework', 'workplace', 'study', 'studying',
      'university', 'college', 'student', 'students', 'abroad', 'studyabroad', 'academy',
      'education', 'teaching', 'teacher', 'tutors', 'tutored', 'linguistics', 'exam', 'gmat',
      'phd', 'doctoral', 'academia', 'internship', 'mentorship', 'residency', 'scholars', 'campus'
    ]
  },
  {
    category: 'Memes & Humor',
    tokens: [
      'meme', 'memes', 'memez', 'humor', 'funny', 'circlejerk', 'okbuddy', 'okaybuddy',
      'shitpost', 'shitposting', 'satire', 'joke', 'jokes', 'comedy', 'comedian', 'snark',
      'gossip', 'roast', 'parody', 'dank', 'wholesome', 'plagiarism', 'copypaste', 'cringe', 'memes'
    ]
  },
  {
    category: 'Entertainment & Media',
    tokens: [
      'movie', 'movies', 'film', 'films', 'cinema', 'cinetopia', 'tv', 'television', 'series',
      'fx', 'netflix', 'hbo', 'streaming', 'anime', 'manga', 'manhwa', 'comic', 'comics', 'book',
      'books', 'novel', 'novels', 'scifi', 'fantasy', 'podcast', 'celebrity', 'actor', 'actress',
      'streamer', 'youtube', 'director', 'screenwriting', 'fandom', 'drama', 'theater', 'imax', 'fans'
    ]
  }
];

function expandText(str) {
  return String(str || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-/]+/g, ' ')
    .toLowerCase();
}

function isSubredditNsfw(item) {
  const rawCombined = `${item.display_name || ''} ${item.title || ''} ${item.public_description || ''}`;
  const cleanedForNsfw = rawCombined.replace(NEGATED_NSFW_REGEX, ' ');
  if (NSFW_REGEX.test(cleanedForNsfw)) return true;
  if (Boolean(item.over18) && !/\b(strictly\s+sfw|no\s+porn|no\s+nsfw)\b/i.test(rawCombined)) {
    return true;
  }
  return false;
}

function classifyCategory(item) {
  if (isSubredditNsfw(item)) {
    return 'NSFW & Adult';
  }

  const nameTokens = expandText(`${item.display_name || ''} ${item.title || ''}`).split(/[^a-z0-9+]+/).filter(Boolean);
  const descTokens = expandText(item.public_description || '').split(/[^a-z0-9+]+/).filter(Boolean);

  let bestCategory = null;
  let bestScore = 0;

  for (const matcher of CATEGORY_MATCHERS) {
    let score = 0;
    const tokenSet = new Set(matcher.tokens);

    for (const t of nameTokens) {
      if (tokenSet.has(t)) score += 4;
    }
    for (const t of descTokens) {
      if (tokenSet.has(t)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCategory = matcher.category;
    }
  }

  return bestScore >= 2 ? bestCategory : null;
}

function extractTags(item, category) {
  const tags = new Set();
  const catShort = category.split('&')[0].trim().toLowerCase();
  tags.add(catShort);
  if (item.over18 || category === 'NSFW & Adult') {
    tags.add('18+');
    tags.add('nsfw');
  }

  const text = `${item.display_name || ''} ${item.title || ''} ${item.public_description || ''}`.toLowerCase();
  const tagCandidates = [
    'ai', 'github', 'opensource', 'apple', 'coding', 'gaming', 'rpg', 'indie',
    'art', 'doodle', 'design', 'cooking', 'recipes', 'startups', 'investing',
    'deals', 'cinema', 'tv', 'anime', 'memes', 'satire', 'engineering',
    'hardware', 'careers', 'study', 'soccer', 'f1', 'cats', 'music', 'science',
    'fitness', 'coffee', 'synth', 'space', 'finance', 'adult'
  ];
  for (const t of tagCandidates) {
    if (text.includes(t) && tags.size < 4) {
      tags.add(t);
    }
  }
  if (item.allow_images || item.allow_videos) {
    tags.add('media');
  } else {
    tags.add('discussion');
  }
  return Array.from(tags);
}

function computeMetrics(item, nowSec) {
  const ageSec = Math.max(1800, nowSec - item.created_utc);
  const ageDays = Math.max(0.25, ageSec / 86400);
  const subscribers = Math.max(0, Number(item.subscribers) || 0);
  // Preserve real post/comment counts from Reddit/Arctic Shift without fabricating fake numbers
  const numPosts = item.num_posts !== null && item.num_posts !== undefined ? Number(item.num_posts) : null;
  const numComments = item.num_comments !== null && item.num_comments !== undefined ? Number(item.num_comments) : null;
  const subsPerDay = Math.max(0, Math.round(subscribers / ageDays));

  // Heat Score (0-100): computed strictly from real subscribers, daily velocity, and real post/comment counts
  const velocityFactor = Math.min(45, Math.log10(subsPerDay + 1) * 14.5);
  const sizeFactor = Math.min(35, Math.log10(subscribers + 1) * 7.2);
  const activitySum = (numPosts || 0) + (numComments || 0);
  const engagementFactor = activitySum > 0 ? Math.min(20, Math.log10(activitySum + 1) * 4.2) : 0;
  const heatScore = Math.min(99, Math.max(10, Math.round(velocityFactor + sizeFactor + engagementFactor)));

  return {
    subscribers,
    num_posts: numPosts,
    num_comments: numComments,
    subs_per_day: subsPerDay,
    age_days: Number(ageDays.toFixed(1)),
    heat_score: heatScore
  };
}

function normalizeRawSubreddit(r, sourceLabel, nowSec) {
  if (!r || !r.display_name || r.display_name.startsWith('u_')) return null;
  const text = `${r.display_name} ${r.title || ''} ${r.public_description || ''}`;
  if (BLOCKLIST_REGEX.test(text)) return null;
  const desc = (r.public_description || '').trim();
  if (desc.length < 12) return null;

  const category = classifyCategory(r);
  if (!category) return null;

  const isNsfw = category === 'NSFW & Adult';
  const createdUtc = Number(r.created_utc);
  if (!createdUtc || Number.isNaN(createdUtc)) return null;

  const base = {
    id: r.id || r.display_name.toLowerCase(),
    display_name: r.display_name,
    title: r.title || r.display_name,
    public_description: desc,
    created_utc: createdUtc, // Strict unmodified Reddit creation timestamp
    over18: Boolean(r.over18) || isNsfw,
    category,
    allow_images: r.allow_images !== false,
    allow_videos: r.allow_videos !== false,
    community_icon: (r.community_icon || r.icon_img || '').split('?')[0],
    primary_color: r.primary_color || (isNsfw ? '#e11d48' : '#ff4500'),
    subscribers: Number(r.subscribers) || 0,
    num_posts: r._meta?.num_posts !== undefined && r._meta?.num_posts !== null ? Number(r._meta.num_posts) : null,
    num_comments: r._meta?.num_comments !== undefined && r._meta?.num_comments !== null ? Number(r._meta.num_comments) : null,
    source: sourceLabel
  };

  const metrics = computeMetrics(base, nowSec);
  return {
    ...base,
    ...metrics,
    tags: extractTags(base, category)
  };
}

function buildDataset() {
  const nowSec = Math.floor(Date.now() / 1000);
  let rawList = [];
  if (fs.existsSync(RAW_ARCTIC_FILE)) {
    try {
      rawList = JSON.parse(fs.readFileSync(RAW_ARCTIC_FILE, 'utf8'));
    } catch (e) {
      rawList = [];
    }
  }

  const map = new Map();
  for (const r of rawList) {
    const normalized = normalizeRawSubreddit(r, 'reddit-arctic-live', nowSec);
    if (normalized) {
      map.set(normalized.display_name.toLowerCase(), normalized);
    }
  }

  const finalList = Array.from(map.values());
  try {
    fs.mkdirSync(WRITABLE_DATA_DIR, { recursive: true });
    fs.writeFileSync(WRITABLE_PROCESSED_FILE, JSON.stringify(finalList, null, 2));
  } catch (e) {}
  return finalList;
}

function loadSubreddits() {
  const targetFile = fs.existsSync(WRITABLE_PROCESSED_FILE)
    ? WRITABLE_PROCESSED_FILE
    : BUNDLED_PROCESSED_FILE;
  if (!fs.existsSync(targetFile)) {
    return buildDataset();
  }
  try {
    const data = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
    if (!Array.isArray(data) || data.length === 0) {
      return buildDataset();
    }
    return data;
  } catch (e) {
    return buildDataset();
  }
}

async function fetchRedditOAuthNew() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return [];

  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const tokenRes = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'web:floop.radar:v1.0 (by /u/floop_app)'
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(6000)
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return [];

    const subRes = await fetch('https://oauth.reddit.com/subreddits/new.json?limit=100&raw_json=1', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'User-Agent': 'web:floop.radar:v1.0 (by /u/floop_app)'
      },
      signal: AbortSignal.timeout(7000)
    });
    const subJson = await subRes.json();
    const children = subJson?.data?.children || [];
    return children.map(c => c.data).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function fetchDirectRedditNew() {
  try {
    const res = await fetch('https://www.reddit.com/subreddits/new.json?limit=100&raw_json=1', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FloopSubredditRadar/1.0)',
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const json = await res.json();
    const children = json?.data?.children || [];
    return children.map(c => c.data).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function syncFromArcticShift() {
  const nowSec = Math.floor(Date.now() / 1000);
  const existing = loadSubreddits();
  const map = new Map(existing.map(s => [s.display_name.toLowerCase(), s]));
  let addedOrUpdated = 0;
  const sourcesUsed = [];

  // 1) Try Reddit Official OAuth API if configured
  const oauthItems = await fetchRedditOAuthNew();
  if (oauthItems.length > 0) {
    sourcesUsed.push('reddit-oauth-live');
    for (const r of oauthItems) {
      const normalized = normalizeRawSubreddit(r, 'reddit-oauth-live', nowSec);
      if (normalized) {
        map.set(normalized.display_name.toLowerCase(), normalized);
        addedOrUpdated++;
      }
    }
  }

  // 2) Try direct Reddit JSON endpoint (works if server IP is permitted by Reddit)
  const directItems = await fetchDirectRedditNew();
  if (directItems.length > 0) {
    sourcesUsed.push('reddit-direct-json');
    for (const r of directItems) {
      const normalized = normalizeRawSubreddit(r, 'reddit-direct-json', nowSec);
      if (normalized) {
        map.set(normalized.display_name.toLowerCase(), normalized);
        addedOrUpdated++;
      }
    }
  }

  // 3) Sync from Arctic Shift Live Reddit Index (newest + hottest 90d)
  const arcticUrls = [
    'https://arctic-shift.photon-reddit.com/api/subreddits/search?after=90d&min_subscribers=5&sort_type=created_utc&sort=desc&limit=100',
    'https://arctic-shift.photon-reddit.com/api/subreddits/search?after=90d&min_subscribers=200&sort_type=subscribers&sort=desc&limit=100'
  ];

  for (const url of arcticUrls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
      const json = await res.json();
      if (json && Array.isArray(json.data) && json.data.length > 0) {
        if (!sourcesUsed.includes('arctic-shift-live')) sourcesUsed.push('arctic-shift-live');
        for (const r of json.data) {
          const normalized = normalizeRawSubreddit(r, 'arctic-shift-live', nowSec);
          if (normalized) {
            map.set(normalized.display_name.toLowerCase(), normalized);
            addedOrUpdated++;
          }
        }
      }
    } catch (err) {}
  }

  if (addedOrUpdated > 0) {
    const updatedList = Array.from(map.values());
    try {
      fs.mkdirSync(WRITABLE_DATA_DIR, { recursive: true });
      fs.writeFileSync(WRITABLE_PROCESSED_FILE, JSON.stringify(updatedList, null, 2));
    } catch (e) {}
  }

  return {
    total: map.size,
    synced: addedOrUpdated,
    sourcesUsed,
    timestamp: new Date().toISOString()
  };
}

function querySubreddits(options = {}) {
  const {
    mode = 'all',           // 'new' | 'hot90d' | 'all'
    category = 'All',
    timeframe = '90d',      // '24h' | '7d' | '30d' | '90d'
    minSubscribers = 0,
    maxSubscribers = 0,
    minActivity = 0,
    minVelocity = 0,
    sfwOnly = false,
    mediaOnly = false,
    search = '',
    sortBy = 'default',
    limit = 100
  } = options;

  const nowSec = Math.floor(Date.now() / 1000);
  const all = loadSubreddits().map(item => {
    const metrics = computeMetrics(item, nowSec);
    return { ...item, ...metrics };
  });

  const timeframeSecMap = {
    '24h': 86400 * 1.5,
    '7d': 86400 * 7,
    '30d': 86400 * 30,
    '90d': 86400 * 90
  };
  const maxAgeSec = mode === 'hot90d'
    ? 86400 * 90
    : (timeframeSecMap[timeframe] || 86400 * 90);

  const searchLower = String(search || '').trim().toLowerCase();
  const isExplicitAdultCategory = String(category || '').toLowerCase().includes('nsfw') ||
    String(category || '').toLowerCase().includes('adult');

  function matchesNonCategoryFilters(item, enforceSfw) {
    if (enforceSfw && item.over18) return false;
    if (mediaOnly && !item.allow_images && !item.allow_videos) return false;

    const ageSec = nowSec - item.created_utc;
    if (ageSec > maxAgeSec) return false;

    if (minSubscribers > 0 && item.subscribers < minSubscribers) return false;
    if (maxSubscribers > 0 && item.subscribers > maxSubscribers) return false;
    if (minVelocity > 0 && item.subs_per_day < minVelocity) return false;
    if (minActivity > 0 && ((item.num_posts || 0) + (item.num_comments || 0)) < minActivity) return false;

    if (searchLower) {
      const hay = `${item.display_name} ${item.title} ${item.public_description} ${item.category} ${(item.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }
    return true;
  }

  let filtered = all.filter(item => {
    const enforceSfw = sfwOnly && !isExplicitAdultCategory;
    if (!matchesNonCategoryFilters(item, enforceSfw)) return false;

    if (category && category !== 'All' && category !== 'All Categories') {
      const allowedCats = category.split(',').map(c => c.trim().toLowerCase());
      if (!allowedCats.includes(item.category.toLowerCase())) return false;
    }

    return true;
  });

  const effectiveSort = sortBy === 'default'
    ? (mode === 'new' ? 'created_desc' : mode === 'hot90d' ? 'heat_desc' : 'created_desc')
    : sortBy;

  filtered.sort((a, b) => {
    if (effectiveSort === 'created_desc') return b.created_utc - a.created_utc;
    if (effectiveSort === 'created_asc') return a.created_utc - b.created_utc;
    if (effectiveSort === 'heat_desc') return (b.heat_score - a.heat_score) || (b.subscribers - a.subscribers);
    if (effectiveSort === 'subscribers_desc') return b.subscribers - a.subscribers;
    if (effectiveSort === 'velocity_desc') return b.subs_per_day - a.subs_per_day;
    if (effectiveSort === 'activity_desc') return ((b.num_comments || 0) + (b.num_posts || 0)) - ((a.num_comments || 0) + (a.num_posts || 0));
    return b.created_utc - a.created_utc;
  });

  const categoryCounts = { All: 0 };
  for (const cat of CATEGORIES) categoryCounts[cat] = 0;
  for (const item of all) {
    const isItemAdultCat = item.category === 'NSFW & Adult';
    if (matchesNonCategoryFilters(item, isItemAdultCat ? false : sfwOnly)) {
      if (categoryCounts[item.category] !== undefined) {
        categoryCounts[item.category]++;
      }
    }
    if (matchesNonCategoryFilters(item, sfwOnly)) {
      categoryCounts.All++;
    }
  }

  const allTimestamps = all.map(i => i.created_utc).filter(Boolean);
  const newestIndexedUtc = allTimestamps.length > 0 ? Math.max(...allTimestamps) : null;

  return {
    items: filtered.slice(0, Number(limit) || 100),
    totalMatched: filtered.length,
    categoryCounts,
    categories: CATEGORIES,
    newestIndexedUtc
  };
}

module.exports = {
  CATEGORIES,
  buildDataset,
  loadSubreddits,
  syncFromArcticShift,
  querySubreddits
};
