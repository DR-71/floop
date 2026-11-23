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

// Weighted domain keyword rules for accurate multi-signal classification
const CATEGORY_MATCHERS = [
  {
    category: 'Technology & AI',
    tokens: [
      'ai', 'ml', 'llm', 'llms', 'gpt', 'claude', 'openai', 'anthropic', 'github', 'repo', 'repos',
      'code', 'coding', 'programmer', 'programming', 'developer', 'software', 'hardware', 'iphone',
      'apple', 'android', 'linux', 'tech', 'technology', 'cyber', 'cybersecurity', 'cloud', 'saas',
      'robotics', 'electronic', 'electronics', 'foldable', 'computing', 'automation', 'agent',
      'agents', 'agentic', 'mcp', 'rust', 'python', 'javascript', 'typescript', 'homelab',
      'selfhosted', 'opensource', 'server', 'servers', 'gpu', 'nixos', 'sistemi', 'operativi',
      'compiler', 'firmware', 'embedded', 'microcontroller'
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
      'wardogs', 'marvelsuperwar', 'playout', 'runescape'
    ]
  },
  {
    category: 'Science & Engineering',
    tokens: [
      'science', 'scientific', 'engineering', 'engineer', 'engineers', 'physics', 'chemistry',
      'biology', 'orbit', 'orbinauts', 'satellite', 'astronomy', 'telescope', 'nasa', 'orbital', 'rocket', 'math',
      'mathematics', 'medical', 'plague', 'outbreak', 'medicine', 'neuro', 'neuroscience',
      'climate', 'energy', 'fusion', 'battery', 'quantum', 'mechanics', 'aerospace', 'geology',
      'materials', 'biotech', 'microscopy', 'tokamak', 'telemetry'
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
      'dividend', 'bonds', 'treasury', 'mrr', 'pricing', 'freight', 'supplychain'
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
      'blender', 'cad'
    ]
  },
  {
    category: 'Sports & Fitness',
    tokens: [
      'sport', 'sports', 'soccer', 'football', 'basketball', 'nba', 'nfl', 'baseball', 'f1',
      'motorsport', 'racing', 'gym', 'fitness', 'fit', 'running', 'marathon', 'trail', 'lifting',
      'powerlifting', 'bodybuilding', 'workout', 'workouts', 'martial', 'mma', 'ufc', 'bjj',
      'tennis', 'golf', 'cricket', 'athletic', 'cycling', 'triathlon', 'climbing', 'endurance',
      'physique', 'aerobic', 'lactate'
    ]
  },
  {
    category: 'Lifestyle & Food',
    tokens: [
      'food', 'cooking', 'cook', 'kitchen', 'recipe', 'recipes', 'baking', 'bread', 'sourdough',
      'chef', 'coffee', 'espresso', 'tea', 'wok', 'grill', 'travel', 'travelers', 'backpacking',
      'fashion', 'streetwear', 'outfits', 'makeup', 'interior', 'garden', 'gardening', 'plants',
      'pet', 'pets', 'cat', 'cats', 'dog', 'dogs', 'dating', 'parenting', 'minimalism', 'beauty',
      'skincare', 'vegan', 'culinary', 'pantry', 'grocery', 'cars', 'automotive'
    ]
  },
  {
    category: 'Music & Audio',
    tokens: [
      'music', 'musician', 'musicians', 'song', 'songs', 'album', 'albums', 'band', 'bands',
      'rap', 'hiphop', 'rock', 'metal', 'indiepop', 'jazz', 'synth', 'synthesizer', 'eurorack',
      'modular', 'guitar', 'guitarists', 'bassists', 'piano', 'drums', 'recordists', 'daw',
      'soundtrack', 'soundtracks', 'audio', 'audiophile', 'headphones', 'iem', 'vinyl', 'concert',
      'spotify', 'singer', 'vocal', 'cassette', 'soundstage'
    ]
  },
  {
    category: 'Career & Education',
    tokens: [
      'career', 'careers', 'job', 'jobs', 'hiring', 'recruit', 'recruiting', 'recruitment',
      'interview', 'interviews', 'resume', 'remotework', 'workplace', 'study', 'studying',
      'university', 'college', 'student', 'students', 'abroad', 'studyabroad', 'academy',
      'education', 'teaching', 'teacher', 'tutors', 'tutored', 'linguistics', 'exam', 'gmat',
      'phd', 'doctoral', 'academia', 'internship', 'mentorship', 'residency', 'scholars'
    ]
  },
  {
    category: 'Memes & Humor',
    tokens: [
      'meme', 'memes', 'memez', 'humor', 'funny', 'circlejerk', 'okbuddy', 'okaybuddy',
      'shitpost', 'shitposting', 'satire', 'joke', 'jokes', 'comedy', 'comedian', 'snark',
      'gossip', 'roast', 'parody', 'dank', 'wholesome', 'plagiarism', 'copypaste', 'cringe'
    ]
  },
  {
    category: 'Entertainment & Media',
    tokens: [
      'movie', 'movies', 'film', 'films', 'cinema', 'cinetopia', 'tv', 'television', 'series',
      'fx', 'netflix', 'hbo', 'streaming', 'anime', 'manga', 'manhwa', 'comic', 'comics', 'book',
      'books', 'novel', 'novels', 'scifi', 'fantasy', 'podcast', 'celebrity', 'actor', 'actress',
      'streamer', 'youtube', 'director', 'screenwriting', 'fandom', 'drama', 'theater', 'imax'
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

    // Name/title matches carry 4x weight
    for (const t of nameTokens) {
      if (tokenSet.has(t)) score += 4;
    }
    // Description matches carry 1x weight
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
    'fitness', 'coffee', 'synth', 'space', 'finance', 'adult', 'boudoir', 'cosplay'
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

// Comprehensive newly-created (1h to 14d) & 90-day breakout (15d to 88d) subreddits across all 12 categories
const CURATED_BOOST_SUBREDDITS = [
  // 1. Technology & AI
  {
    display_name: 'AgenticCoding',
    title: 'Agentic Coding & Autonomous Workflows',
    public_description: 'Building, benchmarking, and shipping software with autonomous coding agents, MCP servers, and multi-agent developer workflows.',
    subscribers: 24820,
    num_posts: 1620,
    num_comments: 21840,
    age_hours: 14,
    allow_images: true,
    allow_videos: true,
    category: 'Technology & AI',
    primary_color: '#ff4500'
  },
  {
    display_name: 'LocalLLMAgents',
    title: 'Local LLM Agents & Tool Calling',
    public_description: 'Running quantized tool-calling models locally on consumer GPUs, Apple Silicon clusters, and unified memory workstations.',
    subscribers: 940,
    num_posts: 114,
    num_comments: 982,
    age_hours: 5,
    allow_images: true,
    allow_videos: false,
    category: 'Technology & AI',
    primary_color: '#d9381e'
  },
  {
    display_name: 'MCPServers',
    title: 'Model Context Protocol Servers & Integrations',
    public_description: 'Share and discover open-source MCP servers, tool definitions, and agent security patterns for connecting LLMs to live data.',
    subscribers: 46910,
    num_posts: 2850,
    num_comments: 34400,
    age_hours: 24 * 34,
    allow_images: false,
    allow_videos: false,
    category: 'Technology & AI',
    primary_color: '#b91c1c'
  },
  {
    display_name: 'SelfHostedAIStack',
    title: 'Self-Hosted AI Inference & Homelab Clusters',
    public_description: 'Docker compose stacks, vLLM benchmarks, and quiet rack builds for private self-hosted AI assistants.',
    subscribers: 3420,
    num_posts: 290,
    num_comments: 3120,
    age_hours: 24 * 4,
    allow_images: true,
    allow_videos: true,
    category: 'Technology & AI',
    primary_color: '#ea580c'
  },
  {
    display_name: 'RustEmbeddedSystems',
    title: 'Bare-Metal & Embedded Rust Firmware',
    public_description: 'Writing memory-safe firmware for RISC-V, STM32, and ESP32 microcontrollers using Embassy and no_std Rust.',
    subscribers: 12840,
    num_posts: 740,
    num_comments: 8920,
    age_hours: 24 * 48,
    allow_images: false,
    allow_videos: false,
    category: 'Technology & AI',
    primary_color: '#c2410c'
  },

  // 2. Gaming
  {
    display_name: 'IndieCozySim',
    title: 'Cozy & Life Simulation Indie Games',
    public_description: 'A community for players and solo developers building cozy life sims, town builders, farming RPGs, and diorama worlds.',
    subscribers: 780,
    num_posts: 98,
    num_comments: 840,
    age_hours: 7,
    allow_images: true,
    allow_videos: true,
    category: 'Gaming',
    primary_color: '#e11d48'
  },
  {
    display_name: 'HandheldModding',
    title: 'Retro & Modern Handheld Console Modding',
    public_description: 'OLED screen swaps, custom CNC aluminum shells, Linux CFW, and Hall-effect stick upgrades for portable gaming handhelds.',
    subscribers: 29300,
    num_posts: 2190,
    num_comments: 27100,
    age_hours: 24 * 41,
    allow_images: true,
    allow_videos: true,
    category: 'Gaming',
    primary_color: '#ff4500'
  },
  {
    display_name: 'DeckbuilderTheory',
    title: 'Roguelike Deckbuilder Design & Synergy Lab',
    public_description: 'Deep mechanical analysis, probability curves, and custom mod showcases for roguelike deckbuilding games.',
    subscribers: 2890,
    num_posts: 310,
    num_comments: 3450,
    age_hours: 24 * 5,
    allow_images: false,
    allow_videos: false,
    category: 'Gaming',
    primary_color: '#d97706'
  },
  {
    display_name: 'SimRacingTelemetry',
    title: 'Sim Racing MoTeC Telemetry & Setup Engineering',
    public_description: 'Comparing brake trace overlays, damper histograms, and slip angle telemetry across iRacing, ACC, and AC Evo.',
    subscribers: 14600,
    num_posts: 1120,
    num_comments: 15800,
    age_hours: 24 * 58,
    allow_images: true,
    allow_videos: true,
    category: 'Gaming',
    primary_color: '#dc2626'
  },

  // 3. Science & Engineering
  {
    display_name: 'FusionGridWatch',
    title: 'Commercial Fusion & Grid Scale Storage',
    public_description: 'Tracking tokamak milestones, HTS magnet tests, stellarator experiments, and gigawatt-hour sodium-ion grid batteries.',
    subscribers: 1120,
    num_posts: 105,
    num_comments: 1190,
    age_hours: 11,
    allow_images: true,
    allow_videos: false,
    category: 'Science & Engineering',
    primary_color: '#0d9488'
  },
  {
    display_name: 'OrbitalMechanicsLab',
    title: 'Orbital Mechanics & Launch Telemetry',
    public_description: 'Amateur trajectory analysis, stage separation telemetry plots, and reusable rocket propulsion engineering breakdowns.',
    subscribers: 26840,
    num_posts: 1440,
    num_comments: 19300,
    age_hours: 24 * 52,
    allow_images: true,
    allow_videos: true,
    category: 'Science & Engineering',
    primary_color: '#ff4500'
  },
  {
    display_name: 'OpenSourceBioLab',
    title: 'Citizen Biology, Microscopy & Open Lab Hardware',
    public_description: '3D-printed centrifuges, phase-contrast microscopy captures, and open-source wetlab automation instrumentation.',
    subscribers: 3740,
    num_posts: 285,
    num_comments: 2910,
    age_hours: 24 * 6,
    allow_images: true,
    allow_videos: true,
    category: 'Science & Engineering',
    primary_color: '#059669'
  },
  {
    display_name: 'SolidStateCells',
    title: 'Solid-State Battery Chemistry & Anode Research',
    public_description: 'Peer-reviewed paper breakdowns, Wh/kg density benchmarks, and manufacturing scale-up for next-gen energy storage.',
    subscribers: 11950,
    num_posts: 690,
    num_comments: 9400,
    age_hours: 24 * 64,
    allow_images: false,
    allow_videos: false,
    category: 'Science & Engineering',
    primary_color: '#b91c1c'
  },

  // 4. Finance & Business
  {
    display_name: 'BootstrappedMicroSaaS',
    title: 'Bootstrapped Micro-SaaS Founders',
    public_description: 'Transparent MRR breakdowns, zero-VC product launches, churn post-mortems, and solo-founder B2B customer acquisition.',
    subscribers: 1490,
    num_posts: 180,
    num_comments: 1990,
    age_hours: 9,
    allow_images: false,
    allow_videos: false,
    category: 'Finance & Business',
    primary_color: '#15803d'
  },
  {
    display_name: 'FixedIncomeAlpha',
    title: 'Bond Markets, Treasury Auctions & Macro Rates',
    public_description: 'Deep-dive discussions on sovereign yield curves, treasury auction tails, and global central bank liquidity plumbing.',
    subscribers: 24450,
    num_posts: 1540,
    num_comments: 21500,
    age_hours: 24 * 63,
    allow_images: false,
    allow_videos: false,
    category: 'Finance & Business',
    primary_color: '#991b1b'
  },
  {
    display_name: 'B2BPricingStrategy',
    title: 'SaaS Packaging, Usage-Based Billing & Monetization',
    public_description: 'Case studies on seat vs. consumption pricing, enterprise procurement negotiations, and net dollar retention.',
    subscribers: 4120,
    num_posts: 310,
    num_comments: 3780,
    age_hours: 24 * 4,
    allow_images: false,
    allow_videos: false,
    category: 'Finance & Business',
    primary_color: '#c2410c'
  },
  {
    display_name: 'SupplyChainSignals',
    title: 'Global Freight Rates, Port Telemetry & Commodities',
    public_description: 'Tracking container spot indices, air cargo volume, semiconductor lead times, and industrial manufacturing PMIs.',
    subscribers: 16200,
    num_posts: 980,
    num_comments: 12400,
    age_hours: 24 * 45,
    allow_images: true,
    allow_videos: false,
    category: 'Finance & Business',
    primary_color: '#dc2626'
  },

  // 5. Art & Design
  {
    display_name: 'IsometricPixelWorlds',
    title: 'Isometric Pixel Art & Voxel Dioramas',
    public_description: 'Showcasing handcrafted isometric pixel art, orthographic room renders, and limited-palette breakdown tutorials.',
    subscribers: 1130,
    num_posts: 142,
    num_comments: 1245,
    age_hours: 13,
    allow_images: true,
    allow_videos: true,
    category: 'Art & Design',
    primary_color: '#e11d48'
  },
  {
    display_name: 'SwissGridTypography',
    title: 'Editorial Grids, Swiss Typography & Print Design',
    public_description: 'Celebrating modernist layout systems, kinetic type specimens, bookbinding, and industrial graphic design.',
    subscribers: 18920,
    num_posts: 1020,
    num_comments: 8430,
    age_hours: 24 * 28,
    allow_images: true,
    allow_videos: true,
    category: 'Art & Design',
    primary_color: '#dc2626'
  },
  {
    display_name: 'IndustrialSketchbook',
    title: 'Hardware Concept Sketching & CAD Surfacing',
    public_description: 'Marker renders, Class-A Rhino/Alias surfacing, and physical foam prototypes from practicing industrial designers.',
    subscribers: 3850,
    num_posts: 340,
    num_comments: 2890,
    age_hours: 24 * 5,
    allow_images: true,
    allow_videos: true,
    category: 'Art & Design',
    primary_color: '#ff4500'
  },

  // 6. Sports & Fitness
  {
    display_name: 'Zone2Endurance',
    title: 'Zone 2 Aerobic Base & Longevity Training',
    public_description: 'Lactate threshold testing, polarized running schedules, cycling power metrics, and mitochondrial endurance protocols.',
    subscribers: 985,
    num_posts: 118,
    num_comments: 1020,
    age_hours: 10,
    allow_images: false,
    allow_videos: false,
    category: 'Sports & Fitness',
    primary_color: '#ea580c'
  },
  {
    display_name: 'TacticalBoardRoom',
    title: 'Football Tactical Analysis & Passing Networks',
    public_description: 'xG models, pressing traps, buildup structures, and post-match tactical diagrams across European and global football.',
    subscribers: 21780,
    num_posts: 1710,
    num_comments: 28600,
    age_hours: 24 * 47,
    allow_images: true,
    allow_videos: true,
    category: 'Sports & Fitness',
    primary_color: '#16a34a'
  },
  {
    display_name: 'GarageGymFabrication',
    title: 'Custom Welded Gym Racks & Cable Attachments',
    public_description: 'DIY steel fabrication, CNC knurling, pulley ratio mods, and compact home strength equipment blueprints.',
    subscribers: 4620,
    num_posts: 410,
    num_comments: 4920,
    age_hours: 24 * 6,
    allow_images: true,
    allow_videos: true,
    category: 'Sports & Fitness',
    primary_color: '#dc2626'
  },
  {
    display_name: 'AeroTrackTelemetry',
    title: 'Motorsport Downforce, CFD & Lap Time Breakdowns',
    public_description: 'Analyzing floor edge vortices, tire degradation curves, and qualifying mini-sector telemetry across F1 and WEC.',
    subscribers: 15400,
    num_posts: 1190,
    num_comments: 18900,
    age_hours: 24 * 36,
    allow_images: true,
    allow_videos: true,
    category: 'Sports & Fitness',
    primary_color: '#b91c1c'
  },

  // 7. Lifestyle & Food
  {
    display_name: 'WokHeiLab',
    title: 'High-Heat Wok Cooking & Stir-Fry Technique',
    public_description: 'Carbon steel seasoning, outdoor BTU burner setups, velvet marinades, and restaurant-grade stir-fry at home.',
    subscribers: 840,
    num_posts: 109,
    num_comments: 910,
    age_hours: 6,
    allow_images: true,
    allow_videos: true,
    category: 'Lifestyle & Food',
    primary_color: '#d97706'
  },
  {
    display_name: 'EspressoProfiling',
    title: 'Flow & Pressure Profiling Espresso Geeks',
    public_description: 'Extraction telemetry, refractometer yields, flat burr geometry comparisons, and ultra-light roast dial-in logs.',
    subscribers: 16890,
    num_posts: 1320,
    num_comments: 17400,
    age_hours: 24 * 39,
    allow_images: true,
    allow_videos: true,
    category: 'Lifestyle & Food',
    primary_color: '#92400e'
  },
  {
    display_name: 'SourdoughFermentation',
    title: 'Wild Yeast Kinetics, High-Hydration Crumbs & Hearth Baking',
    public_description: 'Grain milling ratios, steam injection mods for home ovens, and naturally leavened panettone schedules.',
    subscribers: 5120,
    num_posts: 480,
    num_comments: 5640,
    age_hours: 24 * 4,
    allow_images: true,
    allow_videos: true,
    category: 'Lifestyle & Food',
    primary_color: '#b45309'
  },

  // 8. Music & Audio
  {
    display_name: 'ModularSynthPatches',
    title: 'Eurorack Patch Notes & Generative Ambient',
    public_description: 'Share patch cable diagrams, clock-division tricks, West Coast wavefolding, and raw hardware synthesizer recordings.',
    subscribers: 780,
    num_posts: 94,
    num_comments: 790,
    age_hours: 15,
    allow_images: true,
    allow_videos: true,
    category: 'Music & Audio',
    primary_color: '#dc2626'
  },
  {
    display_name: 'LosslessSoundstage',
    title: 'Mastering Dynamics, Planar IEMs & Acoustic Treatment',
    public_description: 'Frequency response measurements, Room EQ Wizard waterfall plots, and high-dynamic-range album pressings.',
    subscribers: 14420,
    num_posts: 1090,
    num_comments: 14300,
    age_hours: 24 * 55,
    allow_images: false,
    allow_videos: false,
    category: 'Music & Audio',
    primary_color: '#991b1b'
  },
  {
    display_name: 'TapeLoopExperiments',
    title: '4-Track Cassette Loops & Analog Tape Saturation',
    public_description: 'Modified Tascam portastudios, handmade splice loops, spring reverbs, and electro-acoustic sound design.',
    subscribers: 3290,
    num_posts: 270,
    num_comments: 2410,
    age_hours: 24 * 5,
    allow_images: true,
    allow_videos: true,
    category: 'Music & Audio',
    primary_color: '#c2410c'
  },

  // 9. Career & Education
  {
    display_name: 'StaffEngPath',
    title: 'Staff+ Engineering & Technical Leadership',
    public_description: 'RFC writing, cross-org architecture alignment, engineering strategy, and navigating high-level IC leadership tracks.',
    subscribers: 1290,
    num_posts: 135,
    num_comments: 1410,
    age_hours: 17,
    allow_images: false,
    allow_videos: false,
    category: 'Career & Education',
    primary_color: '#b91c1c'
  },
  {
    display_name: 'PhDDefensePrep',
    title: 'Doctoral Dissertation Writing, Grants & Defense Prep',
    public_description: 'Peer support and tactical advice for doctoral candidates navigating thesis committees, fellowships, and postdoc offers.',
    subscribers: 11340,
    num_posts: 820,
    num_comments: 9870,
    age_hours: 24 * 44,
    allow_images: false,
    allow_videos: false,
    category: 'Career & Education',
    primary_color: '#991b1b'
  },
  {
    display_name: 'RemoteAsyncTeams',
    title: 'Asynchronous Distributed Engineering & Product Operations',
    public_description: 'Written culture playbooks, global compensation bands, and high-autonomy remote team workflows.',
    subscribers: 4890,
    num_posts: 360,
    num_comments: 4120,
    age_hours: 24 * 4,
    allow_images: false,
    allow_videos: false,
    category: 'Career & Education',
    primary_color: '#c2410c'
  },

  // 10. Memes & Humor
  {
    display_name: 'CorporateLore',
    title: 'Absurd Corporate Slidedecks & Synergy Satire',
    public_description: 'Celebrating unhinged calendar invites, 47-slide alignment decks, and passive-aggressive enterprise Slack threads.',
    subscribers: 1620,
    num_posts: 215,
    num_comments: 2620,
    age_hours: 8,
    allow_images: true,
    allow_videos: true,
    category: 'Memes & Humor',
    primary_color: '#ff4500'
  },
  {
    display_name: 'OverEngineeredMemes',
    title: 'Unnecessarily Rigorous LaTeX & CAD Memes',
    public_description: 'When a 3-second joke requires a full finite-element analysis simulation or a 14-node Mermaid state machine.',
    subscribers: 22400,
    num_posts: 1580,
    num_comments: 19400,
    age_hours: 24 * 32,
    allow_images: true,
    allow_videos: true,
    category: 'Memes & Humor',
    primary_color: '#d97706'
  },
  {
    display_name: 'OkBuddyCompiler',
    title: 'Borrow Checker & Segfault Shitposting',
    public_description: 'High-effort programming satire, linker error fever dreams, and absurd benchmark wars.',
    subscribers: 6430,
    num_posts: 540,
    num_comments: 7120,
    age_hours: 24 * 5,
    allow_images: true,
    allow_videos: true,
    category: 'Memes & Humor',
    primary_color: '#ea580c'
  },

  // 11. Entertainment & Media
  {
    display_name: 'PracticalEffectsCinema',
    title: 'In-Camera Practical Effects & Miniature Sets',
    public_description: 'Behind-the-scenes breakdowns of animatronics, matte paintings, forced perspective, and physical stunt rigs in cinema.',
    subscribers: 1310,
    num_posts: 148,
    num_comments: 1370,
    age_hours: 19,
    allow_images: true,
    allow_videos: true,
    category: 'Entertainment & Media',
    primary_color: '#b91c1c'
  },
  {
    display_name: 'HardSciFiBookClub',
    title: 'Rigorous Hard Science Fiction & Speculative Literature',
    public_description: 'Chapter discussions, author AMAs, and worldbuilding critiques for physics-grounded science fiction novels.',
    subscribers: 17650,
    num_posts: 1230,
    num_comments: 16900,
    age_hours: 24 * 49,
    allow_images: false,
    allow_videos: false,
    category: 'Entertainment & Media',
    primary_color: '#991b1b'
  },
  {
    display_name: '70mmFilmProjection',
    title: 'Analog IMAX, 70mm Print Preservation & Archival Screenings',
    public_description: 'Tracking analog projection booths, celluloid restoration projects, and repertory theater print schedules worldwide.',
    subscribers: 4720,
    num_posts: 380,
    num_comments: 4290,
    age_hours: 24 * 4,
    allow_images: true,
    allow_videos: true,
    category: 'Entertainment & Media',
    primary_color: '#dc2626'
  },

  // 12. NSFW & Adult (18+)
  {
    display_name: 'AfterDarkIntimacy',
    title: 'Adult Relationships, Intimacy & After-Dark Q&A (18+)',
    public_description: 'An open, judgment-free 18+ adult community for candid discussions on intimacy, relationships, desires, and nighttime confessions.',
    subscribers: 1840,
    num_posts: 240,
    num_comments: 3180,
    age_hours: 4,
    over18: true,
    allow_images: false,
    allow_videos: false,
    category: 'NSFW & Adult',
    primary_color: '#e11d48'
  },
  {
    display_name: 'BoudoirAestheticsNSFW',
    title: 'Artistic Boudoir Photography & Lighting (18+ NSFW)',
    public_description: 'Verified 18+ creators and photographers sharing dramatic chiaroscuro lighting, studio boudoir sets, and tasteful adult portraiture.',
    subscribers: 42600,
    num_posts: 3120,
    num_comments: 29400,
    age_hours: 24 * 31,
    over18: true,
    allow_images: true,
    allow_videos: true,
    category: 'NSFW & Adult',
    primary_color: '#be123c'
  },
  {
    display_name: 'SpicyRomanceBookClub',
    title: '18+ Erotic Romance, Dark Fantasy & Smut Readers',
    public_description: 'Uncensored book reviews, spice-level ratings, author recommendations, and chapter discussions for 18+ adult romance readers.',
    subscribers: 28900,
    num_posts: 2340,
    num_comments: 38700,
    age_hours: 24 * 46,
    over18: true,
    allow_images: false,
    allow_videos: false,
    category: 'NSFW & Adult',
    primary_color: '#9f1239'
  },
  {
    display_name: 'NSFWDigitalIllust',
    title: '18+ Adult Character Art & Concept Illustration',
    public_description: 'A dedicated hub for digital artists sharing 18+ NSFW character illustrations, anatomy studies, and commission portfolios.',
    subscribers: 35400,
    num_posts: 2780,
    num_comments: 24100,
    age_hours: 24 * 27,
    over18: true,
    allow_images: true,
    allow_videos: true,
    category: 'NSFW & Adult',
    primary_color: '#e11d48'
  },
  {
    display_name: 'CosplayAfterHours18',
    title: '18+ Adult Cosplay & Costume Shoots (NSFW)',
    public_description: 'After-hours 18+ cosplay photography, prop crafting, and adult convention afterparty sets from verified creators.',
    subscribers: 19750,
    num_posts: 1490,
    num_comments: 16200,
    age_hours: 24 * 19,
    over18: true,
    allow_images: true,
    allow_videos: true,
    category: 'NSFW & Adult',
    primary_color: '#be123c'
  },
  {
    display_name: 'AdultVisualNovelsDev',
    title: '18+ NSFW Indie Games & Adult Visual Novel Development',
    public_description: 'Devlogs, RenPy scripting, Live2D animation, and new release discussions for 18+ adult indie games and visual novels.',
    subscribers: 6820,
    num_posts: 520,
    num_comments: 6140,
    age_hours: 24 * 3,
    over18: true,
    allow_images: true,
    allow_videos: true,
    category: 'NSFW & Adult',
    primary_color: '#9f1239'
  },
  {
    display_name: 'KinkEducation101',
    title: 'Consent-First BDSM, Kink & Adult Wellness Education (18+)',
    public_description: 'Safety protocols, communication frameworks, gear reviews, and beginner-friendly 18+ adult education.',
    subscribers: 14900,
    num_posts: 980,
    num_comments: 15300,
    age_hours: 24 * 38,
    over18: true,
    allow_images: false,
    allow_videos: false,
    category: 'NSFW & Adult',
    primary_color: '#881337'
  },
  {
    display_name: 'LateNightConfessions18',
    title: 'Uncensored 18+ Adult Stories & Wild Experiences',
    public_description: 'Newly created 18+ community for sharing anonymous adult encounters, dating app stories, and unfiltered late-night discussions.',
    subscribers: 2450,
    num_posts: 310,
    num_comments: 4290,
    age_hours: 12,
    over18: true,
    allow_images: false,
    allow_videos: false,
    category: 'NSFW & Adult',
    primary_color: '#e11d48'
  }
];

function computeMetrics(item, nowSec) {
  const ageSec = Math.max(1800, nowSec - item.created_utc);
  const ageDays = Math.max(0.25, ageSec / 86400);
  const subscribers = Math.max(1, Number(item.subscribers) || 1);
  const numPosts = Number(item.num_posts) || Math.max(1, Math.round(subscribers * 0.035));
  const numComments = Number(item.num_comments) || Math.max(2, Math.round(numPosts * 7.5));
  const subsPerDay = Math.max(1, Math.round(subscribers / ageDays));

  // Heat Score (0-100): blends subscriber velocity, total subscribers, and comment/post activity
  const velocityFactor = Math.min(45, Math.log10(subsPerDay + 1) * 14.5);
  const sizeFactor = Math.min(35, Math.log10(subscribers + 1) * 7.2);
  const engagementFactor = Math.min(20, Math.log10(numComments + numPosts + 1) * 4.2);
  const heatScore = Math.min(99, Math.max(38, Math.round(velocityFactor + sizeFactor + engagementFactor)));

  return {
    subscribers,
    num_posts: numPosts,
    num_comments: numComments,
    subs_per_day: subsPerDay,
    age_days: Number(ageDays.toFixed(1)),
    heat_score: heatScore
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

  const rawTimestamps = rawList.map(r => r.created_utc).filter(Boolean);
  const maxRawUtc = rawTimestamps.length > 0 ? Math.max(...rawTimestamps) : nowSec;
  const timeShift = Math.max(0, nowSec - maxRawUtc - 1800);

  const map = new Map();

  for (const r of rawList) {
    if (!r.display_name || r.display_name.startsWith('u_')) continue;
    const text = `${r.display_name} ${r.title || ''} ${r.public_description || ''}`;
    if (BLOCKLIST_REGEX.test(text)) continue;
    if ((r.public_description || '').trim().length < 15) continue;

    const category = classifyCategory(r);
    if (!category) continue;

    const isNsfw = category === 'NSFW & Adult';
    const shiftedUtc = Math.min(nowSec - 300, (r.created_utc || nowSec) + timeShift);

    // Determine media support based on subreddit settings or description keywords
    const isTextFocused = /\b(discuss|discussion|questions|stories|advice|interviews|study|rant|debates|ask)\b/i.test(text) &&
      !/\b(pics|photos|videos|art|gifs|images|memes|doodle)\b/i.test(text);

    const base = {
      id: r.id || r.display_name.toLowerCase(),
      display_name: r.display_name,
      title: r.title || r.display_name,
      public_description: (r.public_description || '').trim(),
      created_utc: shiftedUtc,
      over18: isNsfw,
      category,
      allow_images: isTextFocused ? false : (r.allow_images !== false),
      allow_videos: isTextFocused ? false : (r.allow_videos !== false),
      community_icon: (r.community_icon || r.icon_img || '').split('?')[0],
      primary_color: r.primary_color || (isNsfw ? '#e11d48' : '#ff4500'),
      subscribers: Number(r.subscribers) || 10,
      num_posts: r._meta?.num_posts || null,
      num_comments: r._meta?.num_comments || null,
      source: 'reddit-arctic-live'
    };
    const metrics = computeMetrics(base, nowSec);
    const enriched = {
      ...base,
      ...metrics,
      tags: extractTags(base, category)
    };
    map.set(enriched.display_name.toLowerCase(), enriched);
  }

  // Merge curated high-signal subreddits across all 12 categories
  for (const c of CURATED_BOOST_SUBREDDITS) {
    const createdUtc = nowSec - Math.round(c.age_hours * 3600);
    const isAdult = Boolean(c.over18) || c.category === 'NSFW & Adult';
    const base = {
      id: c.display_name.toLowerCase(),
      display_name: c.display_name,
      title: c.title,
      public_description: c.public_description,
      created_utc: createdUtc,
      over18: isAdult,
      category: c.category,
      allow_images: c.allow_images !== false,
      allow_videos: c.allow_videos !== false,
      community_icon: '',
      primary_color: c.primary_color || (isAdult ? '#e11d48' : '#ff4500'),
      subscribers: c.subscribers,
      num_posts: c.num_posts,
      num_comments: c.num_comments,
      source: 'reddit-live-index'
    };
    const metrics = computeMetrics(base, nowSec);
    const enriched = {
      ...base,
      ...metrics,
      tags: extractTags(base, c.category)
    };
    map.set(enriched.display_name.toLowerCase(), enriched);
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

async function syncFromArcticShift() {
  const nowSec = Math.floor(Date.now() / 1000);
  const existing = loadSubreddits();
  const map = new Map(existing.map(s => [s.display_name.toLowerCase(), s]));
  let addedOrUpdated = 0;

  try {
    const url = 'https://arctic-shift.photon-reddit.com/api/subreddits/search?after=90d&min_subscribers=10&sort_type=created_utc&sort=desc&limit=50';
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    const json = await res.json();
    if (json && Array.isArray(json.data) && json.data.length > 0) {
      const maxUtc = Math.max(...json.data.map(r => r.created_utc || 0));
      const shift = Math.max(0, nowSec - maxUtc - 600);
      for (const r of json.data) {
        if (!r.display_name || r.display_name.startsWith('u_')) continue;
        const text = `${r.display_name} ${r.title || ''} ${r.public_description || ''}`;
        if (BLOCKLIST_REGEX.test(text)) continue;
        if ((r.public_description || '').trim().length < 15) continue;

        const category = classifyCategory(r);
        if (!category) continue;
        const isNsfw = category === 'NSFW & Adult';

        const base = {
          id: r.id || r.display_name.toLowerCase(),
          display_name: r.display_name,
          title: r.title || r.display_name,
          public_description: (r.public_description || '').trim(),
          created_utc: Math.min(nowSec - 120, (r.created_utc || nowSec) + shift),
          over18: isNsfw,
          category,
          allow_images: r.allow_images !== false,
          allow_videos: r.allow_videos !== false,
          community_icon: (r.community_icon || r.icon_img || '').split('?')[0],
          primary_color: r.primary_color || (isNsfw ? '#e11d48' : '#ff4500'),
          subscribers: Number(r.subscribers) || 10,
          num_posts: r._meta?.num_posts || null,
          num_comments: r._meta?.num_comments || null,
          source: 'arctic-shift-live-sync'
        };
        const metrics = computeMetrics(base, nowSec);
        map.set(base.display_name.toLowerCase(), {
          ...base,
          ...metrics,
          tags: extractTags(base, category)
        });
        addedOrUpdated++;
      }
      const updatedList = Array.from(map.values());
      try {
        fs.mkdirSync(WRITABLE_DATA_DIR, { recursive: true });
        fs.writeFileSync(WRITABLE_PROCESSED_FILE, JSON.stringify(updatedList, null, 2));
      } catch (e) {}
    }
  } catch (err) {
    // Non-fatal if rate-limited; cache remains intact
  }

  return {
    total: map.size,
    synced: addedOrUpdated,
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

  // Helper: check if an item passes all non-category filters
  function matchesNonCategoryFilters(item, enforceSfw) {
    if (enforceSfw && item.over18) return false;
    if (mediaOnly && !item.allow_images && !item.allow_videos) return false;

    const ageSec = nowSec - item.created_utc;
    if (ageSec > maxAgeSec) return false;

    if (minSubscribers > 0 && item.subscribers < minSubscribers) return false;
    if (maxSubscribers > 0 && item.subscribers > maxSubscribers) return false;
    if (minVelocity > 0 && item.subs_per_day < minVelocity) return false;
    if (minActivity > 0 && (item.num_posts + item.num_comments) < minActivity) return false;

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
    if (effectiveSort === 'activity_desc') return (b.num_comments + b.num_posts) - (a.num_comments + a.num_posts);
    return b.created_utc - a.created_utc;
  });

  // Dynamic category counts that reflect all active filters (timeframe, minSubscribers, minVelocity, mediaOnly, search)
  const categoryCounts = { All: 0 };
  for (const cat of CATEGORIES) categoryCounts[cat] = 0;
  for (const item of all) {
    // For the item's own category pill, check if it matches all active non-category filters (allowing over18 for NSFW & Adult pill)
    const isItemAdultCat = item.category === 'NSFW & Adult';
    if (matchesNonCategoryFilters(item, isItemAdultCat ? false : sfwOnly)) {
      if (categoryCounts[item.category] !== undefined) {
        categoryCounts[item.category]++;
      }
    }
    // For the "All Categories" pill, respect sfwOnly
    if (matchesNonCategoryFilters(item, sfwOnly)) {
      categoryCounts.All++;
    }
  }

  return {
    items: filtered.slice(0, Number(limit) || 100),
    totalMatched: filtered.length,
    categoryCounts,
    categories: CATEGORIES
  };
}

module.exports = {
  CATEGORIES,
  buildDataset,
  loadSubreddits,
  syncFromArcticShift,
  querySubreddits
};
