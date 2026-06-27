const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============ MIDDLEWARE ============

// Security
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: {
    success: false,
    error: 'Too many requests',
    message: 'Vui lòng thử lại sau 15 phút'
  }
});
app.use('/api', limiter);

// Logging
app.use(morgan('combined'));

// Compression
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ============ DATA STORAGE ============

const notifications = {
  all: [],
  stats: {
    total: 0,
    byBoss: {},
    bySea: { 1: 0, 2: 0, 3: 0 },
    byServer: {},
    lastUpdate: null,
    activeServers: new Set()
  }
};

// ============ CONFIGURATION ============

const VALID_API_KEYS = {
  '87ebc4e597aab91a0aae0900ee6c6753bdb6527cf02d8aa18bf617bf57a57005': 'main'
};

const APIS = {};

// ============ HELPER FUNCTIONS ============

const generateId = () => {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
};

const generateApiKey = () => {
  return 'api_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const validateApiKey = (key) => {
  return VALID_API_KEYS[key] !== undefined;
};

const getApiKey = (req) => {
  return req.body.apiKey || req.query.apiKey || req.headers['x-api-key'];
};

// ============ AUTHENTICATION MIDDLEWARE ============

const authenticate = (req, res, next) => {
  const apiKey = getApiKey(req);
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: 'API key required',
      message: 'Vui lòng cung cấp API key'
    });
  }

  if (!validateApiKey(apiKey)) {
    return res.status(403).json({
      success: false,
      error: 'Invalid API key',
      message: 'API key không hợp lệ'
    });
  }

  next();
};

// ============ ROUTES ============

// Home
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/dashboard.html'));
});

// Create API page
app.get('/create-api', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/create-api.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    totalNotifications: notifications.all.length,
    activeServers: notifications.stats.activeServers.size
  });
});

// ============ API ENDPOINTS ============

// 1. Create API
app.post('/api/create', authenticate, (req, res) => {
  try {
    const { name, displayName, webhook, privateMode, whitelistIPs } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Missing name',
        message: 'Vui lòng nhập tên API'
      });
    }

    const id = generateId();
    const apiKey = generateApiKey();

    APIS[id] = {
      id,
      name,
      displayName: displayName || name,
      apiKey,
      webhook: webhook || '',
      privateMode: privateMode || false,
      whitelistIPs: whitelistIPs || [],
      jobs: {},
      enabled: true,
      createdAt: new Date().toISOString(),
      stats: {
        totalJobs: 0,
        bossCount: 0
      }
    };

    console.log(`✅ API created: ${name} (${id})`);

    res.status(201).json({
      success: true,
      message: 'API created successfully',
      data: {
        id,
        apiKey,
        name,
        displayName: displayName || name,
        link: `/api/${id}/all`
      }
    });
  } catch (error) {
    console.error('Create API error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// 2. Get all APIs
app.get('/api/my', authenticate, (req, res) => {
  const apiList = Object.values(APIS).map(api => ({
    id: api.id,
    name: api.name,
    displayName: api.displayName,
    enabled: api.enabled,
    privateMode: api.privateMode,
    totalJobs: api.stats.totalJobs || 0,
    bossCount: api.stats.bossCount || 0,
    createdAt: api.createdAt
  }));

  res.json({
    success: true,
    data: apiList,
    total: apiList.length
  });
});

// 3. Get API details
app.get('/api/:id', authenticate, (req, res) => {
  const api = APIS[req.params.id];
  if (!api) {
    return res.status(404).json({
      success: false,
      error: 'API not found',
      message: 'Không tìm thấy API'
    });
  }

  res.json({
    success: true,
    data: {
      id: api.id,
      name: api.name,
      displayName: api.displayName,
      apiKey: api.apiKey,
      webhook: api.webhook,
      privateMode: api.privateMode,
      whitelistIPs: api.whitelistIPs,
      enabled: api.enabled,
      stats: api.stats,
      createdAt: api.createdAt
    }
  });
});

// 4. Push notification (main endpoint)
app.post('/api/push', authenticate, (req, res) => {
  try {
    const { id, job, players, sea, boss } = req.body;
    const apiKey = getApiKey(req);
    
    // Find API by apiKey
    let api = null;
    let apiId = null;
    for (const [key, value] of Object.entries(APIS)) {
      if (value.apiKey === apiKey) {
        api = value;
        apiId = key;
        break;
      }
    }

    if (!api) {
      return res.status(404).json({
        success: false,
        error: 'API not found',
        message: 'Không tìm thấy API với key này'
      });
    }

    if (!api.enabled) {
      return res.status(403).json({
        success: false,
        error: 'API disabled',
        message: 'API đã bị tắt'
      });
    }

    // Validate required fields
    if (!job || !boss || !sea) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        message: 'Thiếu các trường bắt buộc: job, boss, sea',
        required: ['job', 'boss', 'sea'],
        received: Object.keys(req.body)
      });
    }

    // Create notification
    const notification = {
      id: id || generateId(),
      job: job,
      players: parseInt(players) || 0,
      sea: parseInt(sea),
      boss: boss.toLowerCase().trim(),
      timestamp: new Date().toISOString(),
      receivedAt: Date.now()
    };

    // Add to API jobs
    if (!api.jobs[notification.boss]) {
      api.jobs[notification.boss] = [];
    }
    api.jobs[notification.boss].push(notification);

    // Update API stats
    api.stats.totalJobs = (api.stats.totalJobs || 0) + 1;
    api.stats.bossCount = Object.keys(api.jobs).length;

    // Update global stats
    notifications.all.push(notification);
    notifications.stats.total++;

    // Update boss stats
    if (notifications.stats.byBoss[notification.boss]) {
      notifications.stats.byBoss[notification.boss]++;
    } else {
      notifications.stats.byBoss[notification.boss] = 1;
    }

    // Update sea stats
    if (notification.sea >= 1 && notification.sea <= 3) {
      notifications.stats.bySea[notification.sea]++;
    }

    // Update server stats
    if (notifications.stats.byServer[notification.job]) {
      notifications.stats.byServer[notification.job]++;
    } else {
      notifications.stats.byServer[notification.job] = 1;
    }

    notifications.stats.activeServers.add(notification.job);
    notifications.stats.lastUpdate = new Date().toISOString();

    // Keep only last 1000 notifications
    if (notifications.all.length > 1000) {
      notifications.all = notifications.all.slice(-1000);
    }

    console.log(`📥 [${new Date().toISOString()}] ${notification.boss} | Sea ${notification.sea} | ${notification.players} players`);

    res.status(200).json({
      success: true,
      message: 'Notification received',
      data: notification,
      stats: {
        total: notifications.stats.total,
        activeServers: notifications.stats.activeServers.size
      }
    });

  } catch (error) {
    console.error('Push error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// 5. Get notifications
app.get('/api/notifications', (req, res) => {
  const { sea, boss, limit = 50, offset = 0 } = req.query;

  let filtered = [...notifications.all];

  if (sea) {
    filtered = filtered.filter(n => n.sea === parseInt(sea));
  }

  if (boss) {
    filtered = filtered.filter(n => 
      n.boss.toLowerCase().includes(boss.toLowerCase())
    );
  }

  filtered.sort((a, b) => b.receivedAt - a.receivedAt);

  const start = parseInt(offset);
  const end = start + parseInt(limit);
  const paginated = filtered.slice(start, end);

  res.json({
    success: true,
    data: paginated,
    pagination: {
      total: filtered.length,
      limit: parseInt(limit),
      offset: start
    },
    stats: {
      totalNotifications: notifications.stats.total,
      activeServers: notifications.stats.activeServers.size
    }
  });
});

// 6. Get stats
app.get('/api/stats', (req, res) => {
  const bossCount = Object.keys(notifications.stats.byBoss).length;
  const topBosses = Object.entries(notifications.stats.byBoss)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .reduce((obj, [key, value]) => ({ ...obj, [key]: value }), {});

  res.json({
    success: true,
    data: {
      server: {
        uptime: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      },
      stats: {
        totalNotifications: notifications.stats.total,
        uniqueBosses: bossCount,
        activeServers: notifications.stats.activeServers.size,
        seaDistribution: notifications.stats.bySea,
        topBosses: topBosses,
        lastUpdate: notifications.stats.lastUpdate
      }
    }
  });
});

// 7. Get dashboard data
app.get('/api/dashboard', (req, res) => {
  const recent = notifications.all
    .slice(-20)
    .reverse()
    .map(n => ({
      ...n,
      timeAgo: Math.floor((Date.now() - n.receivedAt) / 60000) + 'm ago'
    }));

  const bySea = {
    'Sea 1': notifications.all.filter(n => n.sea === 1).length,
    'Sea 2': notifications.all.filter(n => n.sea === 2).length,
    'Sea 3': notifications.all.filter(n => n.sea === 3).length
  };

  const topBosses = Object.entries(notifications.stats.byBoss)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  res.json({
    success: true,
    data: {
      overview: {
        total: notifications.stats.total,
        activeServers: notifications.stats.activeServers.size,
        uniqueBosses: Object.keys(notifications.stats.byBoss).length,
        lastUpdate: notifications.stats.lastUpdate
      },
      distribution: {
        bySea,
        topBosses
      },
      recent
    }
  });
});

// 8. Delete API
app.delete('/api/:id', authenticate, (req, res) => {
  const api = APIS[req.params.id];
  if (!api) {
    return res.status(404).json({
      success: false,
      error: 'API not found'
    });
  }

  delete APIS[req.params.id];
  console.log(`🗑️ API deleted: ${api.name} (${req.params.id})`);

  res.json({
    success: true,
    message: 'API deleted successfully'
  });
});

// 9. Toggle API status
app.post('/api/:id/toggle', authenticate, (req, res) => {
  const api = APIS[req.params.id];
  if (!api) {
    return res.status(404).json({
      success: false,
      error: 'API not found'
    });
  }

  api.enabled = !api.enabled;
  console.log(`🔄 API ${api.name} ${api.enabled ? 'enabled' : 'disabled'}`);

  res.json({
    success: true,
    message: `API ${api.enabled ? 'enabled' : 'disabled'}`,
    data: { enabled: api.enabled }
  });
});

// 10. Clear all data
app.delete('/api/clear', authenticate, (req, res) => {
  const count = notifications.all.length;
  notifications.all = [];
  notifications.stats = {
    total: 0,
    byBoss: {},
    bySea: { 1: 0, 2: 0, 3: 0 },
    byServer: {},
    lastUpdate: null,
    activeServers: new Set()
  };

  // Clear API jobs
  for (const key in APIS) {
    APIS[key].jobs = {};
    APIS[key].stats = {
      totalJobs: 0,
      bossCount: 0
    };
  }

  console.log(`🗑️ Cleared ${count} notifications`);

  res.json({
    success: true,
    message: `Cleared ${count} notifications`,
    cleared: count
  });
});

// ============ 404 HANDLER ============

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    message: 'Đường dẫn không tồn tại',
    path: req.path,
    method: req.method
  });
});

// ============ ERROR HANDLER ============

app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message
  });
});

// ============ START SERVER ============

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════╗
║   🚀 NOTI API Server Started                     ║
╠═══════════════════════════════════════════════════╣
║  Port:        ${String(PORT).padEnd(38)}║
║  URL:         http://localhost:${PORT}${' '.repeat(38 - `http://localhost:${PORT}`.length)}║
║  Environment: ${(process.env.NODE_ENV || 'development').padEnd(38)}║
╠═══════════════════════════════════════════════════╣
║  📊 Dashboard: http://localhost:${PORT}/dashboard${' '.repeat(38 - `http://localhost:${PORT}/dashboard`.length)}║
║  📡 API:       http://localhost:${PORT}/api${' '.repeat(38 - `http://localhost:${PORT}/api`.length)}║
║  ❤️  Health:    http://localhost:${PORT}/health${' '.repeat(38 - `http://localhost:${PORT}/health`.length)}║
╚═══════════════════════════════════════════════════╝
  `);
  
  console.log('✅ Server is ready to receive notifications!\n');
});

// ============ GRACEFUL SHUTDOWN ============

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing server...');
  process.exit(0);
});