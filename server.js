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

// ============ USER MANAGEMENT ============

const users = {};
const sessions = {};
const APIS = {};

// ============ CONFIGURATION ============

const VALID_API_KEYS = {
  '87ebc4e597aab91a0aae0900ee6c6753bdb6527cf02d8aa18bf617bf57a57005': 'main'
};

const MAX_API_PER_USER = 1;

// ============ HELPER FUNCTIONS ============

const generateId = () => {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
};

const generateApiKey = () => {
  return 'api_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

const generateToken = () => {
  return 'token_' + Math.random().toString(36).substring(2, 20) + Date.now().toString(36);
};

const validateApiKey = (key) => {
  return VALID_API_KEYS[key] !== undefined;
};

const getApiKey = (req) => {
  return req.body.apiKey || req.query.apiKey || req.headers['x-api-key'];
};

const getSession = (req) => {
  const token = req.headers.authorization;
  if (!token) return null;
  return sessions[token] || null;
};

const getUser = (req) => {
  const session = getSession(req);
  return session ? session.user : null;
};

const isAuthenticated = (req) => {
  return getUser(req) !== null;
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

const authenticateUser = (req, res, next) => {
  const session = getSession(req);
  
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized',
      message: 'Vui lòng đăng nhập'
    });
  }

  req.user = session.user;
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

// Login page
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/login.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    totalNotifications: notifications.all.length,
    activeServers: notifications.stats.activeServers.size,
    totalUsers: Object.keys(users).length,
    totalApis: Object.keys(APIS).length
  });
});

// ============ AUTH ENDPOINTS ============

// 1. Register
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing fields',
        message: 'Vui lòng nhập đầy đủ username và password'
      });
    }
    
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password too short',
        message: 'Mật khẩu phải có ít nhất 8 ký tự'
      });
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid username',
        message: 'Username chỉ chứa chữ cái, số và dấu gạch dưới'
      });
    }
    
    if (users[username]) {
      return res.status(400).json({
        success: false,
        error: 'Username exists',
        message: 'Tên đăng nhập đã tồn tại'
      });
    }
    
    // Create user
    users[username] = {
      username,
      password, // In production, hash this!
      createdAt: new Date().toISOString(),
      apiCount: 0
    };
    
    console.log(`✅ User registered: ${username}`);
    
    res.status(201).json({
      success: true,
      message: 'Đăng ký thành công! Vui lòng đăng nhập.',
      data: { username }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// 2. Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing fields',
        message: 'Vui lòng nhập đầy đủ username và password'
      });
    }
    
    const user = users[username];
    if (!user || user.password !== password) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
        message: 'Sai tên đăng nhập hoặc mật khẩu'
      });
    }
    
    // Create session
    const token = generateToken();
    sessions[token] = {
      user: username,
      createdAt: Date.now()
    };
    
    console.log(`✅ User logged in: ${username}`);
    
    res.json({
      success: true,
      message: 'Đăng nhập thành công!',
      data: {
        token,
        username,
        apiCount: user.apiCount || 0,
        canCreate: (user.apiCount || 0) < MAX_API_PER_USER
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// 3. Logout
app.post('/api/logout', authenticateUser, async (req, res) => {
  try {
    const token = req.headers.authorization;
    if (token && sessions[token]) {
      delete sessions[token];
    }
    
    res.json({
      success: true,
      message: 'Đăng xuất thành công'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// 4. Get current user
app.get('/api/me', authenticateUser, async (req, res) => {
  try {
    const user = users[req.user];
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        username: user.username,
        createdAt: user.createdAt,
        apiCount: user.apiCount || 0,
        canCreate: (user.apiCount || 0) < MAX_API_PER_USER
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ============ API ENDPOINTS ============

// 1. Create API (requires authentication)
app.post('/api/create', authenticateUser, async (req, res) => {
  try {
    const { name, displayName, webhook, privateMode, whitelistIPs, 
            prefix, suffix, encode, maxJobsPerBoss, maxTotalJobs, 
            jobSort, customFields, webhookCustom, ttl, removeDuplicate, viewIP } = req.body;
    
    const username = req.user;
    const user = users[username];
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    // Check API limit
    if ((user.apiCount || 0) >= MAX_API_PER_USER) {
      return res.status(403).json({
        success: false,
        error: 'API limit reached',
        message: `Mỗi user chỉ được tạo tối đa ${MAX_API_PER_USER} API. Vui lòng xóa API cũ để tạo mới.`
      });
    }
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Missing name',
        message: 'Vui lòng nhập tên API'
      });
    }
    
    // Check name uniqueness
    for (const key in APIS) {
      if (APIS[key].name === name) {
        return res.status(400).json({
          success: false,
          error: 'Name exists',
          message: 'Tên API đã tồn tại. Vui lòng chọn tên khác.'
        });
      }
    }

    const id = generateId();
    const apiKey = generateApiKey();

    APIS[id] = {
      id,
      name,
      displayName: displayName || name,
      owner: username,
      apiKey,
      webhook: webhook || '',
      webhookCustom: webhookCustom || null,
      privateMode: privateMode || false,
      whitelistIPs: whitelistIPs || [],
      viewIP: viewIP || '',
      prefix: prefix || '',
      suffix: suffix || '',
      encode: encode || null,
      maxJobsPerBoss: parseInt(maxJobsPerBoss) || 0,
      maxTotalJobs: parseInt(maxTotalJobs) || 0,
      jobSort: jobSort || 'desc',
      customFields: customFields || null,
      ttl: parseInt(ttl) || 60000,
      removeDuplicate: removeDuplicate || false,
      jobs: {},
      enabled: true,
      createdAt: new Date().toISOString(),
      stats: {
        totalJobs: 0,
        bossCount: 0
      }
    };

    // Update user API count
    user.apiCount = (user.apiCount || 0) + 1;

    console.log(`✅ API created: ${name} by ${username} (${id})`);

    res.status(201).json({
      success: true,
      message: 'API created successfully',
      data: {
        id,
        apiKey,
        name,
        displayName: displayName || name,
        link: `/api/${id}/all`,
        remaining: MAX_API_PER_USER - user.apiCount
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

// 2. Get user's APIs
app.get('/api/my', authenticateUser, async (req, res) => {
  try {
    const username = req.user;
    const userApis = Object.values(APIS).filter(api => api.owner === username);
    
    const apiList = userApis.map(api => ({
      id: api.id,
      name: api.name,
      displayName: api.displayName,
      enabled: api.enabled,
      privateMode: api.privateMode,
      totalJobs: api.stats.totalJobs || 0,
      bossCount: api.stats.bossCount || 0,
      ttl: api.ttl || 60000,
      prefix: api.prefix || '',
      suffix: api.suffix || '',
      encode: api.encode || null,
      maxJobsPerBoss: api.maxJobsPerBoss || 0,
      maxTotalJobs: api.maxTotalJobs || 0,
      jobSort: api.jobSort || 'desc',
      customFields: api.customFields || null,
      webhook: api.webhook || '',
      webhookCustom: api.webhookCustom || null,
      removeDuplicate: api.removeDuplicate || false,
      viewIP: api.viewIP || '',
      whitelistIPs: api.whitelistIPs || [],
      apiKey: api.apiKey,
      createdAt: api.createdAt
    }));

    res.json({
      success: true,
      data: apiList,
      total: apiList.length,
      maxAllowed: MAX_API_PER_USER,
      remaining: MAX_API_PER_USER - apiList.length
    });
  } catch (error) {
    console.error('Get APIs error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// 3. Get single API
app.get('/api/:id', authenticateUser, async (req, res) => {
  try {
    const api = APIS[req.params.id];
    if (!api) {
      return res.status(404).json({
        success: false,
        error: 'API not found',
        message: 'Không tìm thấy API'
      });
    }

    if (api.owner !== req.user) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Bạn không có quyền truy cập API này'
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
        webhookCustom: api.webhookCustom,
        privateMode: api.privateMode,
        whitelistIPs: api.whitelistIPs,
        viewIP: api.viewIP,
        prefix: api.prefix,
        suffix: api.suffix,
        encode: api.encode,
        maxJobsPerBoss: api.maxJobsPerBoss,
        maxTotalJobs: api.maxTotalJobs,
        jobSort: api.jobSort,
        customFields: api.customFields,
        ttl: api.ttl,
        removeDuplicate: api.removeDuplicate,
        enabled: api.enabled,
        stats: api.stats,
        createdAt: api.createdAt
      }
    });
  } catch (error) {
    console.error('Get API error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// 4. Update API
app.post('/api/update', authenticateUser, async (req, res) => {
  try {
    const { id, ...updates } = req.body;
    
    const api = APIS[id];
    if (!api) {
      return res.status(404).json({
        success: false,
        error: 'API not found',
        message: 'Không tìm thấy API'
      });
    }

    if (api.owner !== req.user) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Bạn không có quyền chỉnh sửa API này'
      });
    }

    // Update fields
    const allowedFields = ['displayName', 'webhook', 'webhookCustom', 'privateMode', 
                          'whitelistIPs', 'viewIP', 'prefix', 'suffix', 'encode',
                          'maxJobsPerBoss', 'maxTotalJobs', 'jobSort', 'customFields',
                          'ttl', 'removeDuplicate', 'enabled'];
    
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        api[field] = updates[field];
      }
    });

    // Update API count if needed
    if (updates.enabled !== undefined && updates.enabled === false) {
      // User wants to disable API
    }

    console.log(`✅ API updated: ${api.name} by ${req.user}`);

    res.json({
      success: true,
      message: 'API updated successfully',
      data: {
        id: api.id,
        name: api.name,
        displayName: api.displayName,
        enabled: api.enabled
      }
    });
  } catch (error) {
    console.error('Update API error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// 5. Delete API
app.delete('/api/:id', authenticateUser, async (req, res) => {
  try {
    const api = APIS[req.params.id];
    if (!api) {
      return res.status(404).json({
        success: false,
        error: 'API not found'
      });
    }

    if (api.owner !== req.user) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Bạn không có quyền xóa API này'
      });
    }

    // Update user API count
    const user = users[req.user];
    if (user) {
      user.apiCount = Math.max(0, (user.apiCount || 0) - 1);
    }

    // Remove API
    delete APIS[req.params.id];
    console.log(`🗑️ API deleted: ${api.name} by ${req.user}`);

    res.json({
      success: true,
      message: 'API deleted successfully',
      data: {
        remaining: MAX_API_PER_USER - (user?.apiCount || 0)
      }
    });
  } catch (error) {
    console.error('Delete API error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// 6. Toggle API status
app.post('/api/:id/toggle', authenticateUser, async (req, res) => {
  try {
    const api = APIS[req.params.id];
    if (!api) {
      return res.status(404).json({
        success: false,
        error: 'API not found'
      });
    }

    if (api.owner !== req.user) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        message: 'Bạn không có quyền thay đổi API này'
      });
    }

    api.enabled = !api.enabled;
    console.log(`🔄 API ${api.name} ${api.enabled ? 'enabled' : 'disabled'} by ${req.user}`);

    res.json({
      success: true,
      message: `API ${api.enabled ? 'enabled' : 'disabled'}`,
      data: { 
        id: api.id,
        enabled: api.enabled 
      }
    });
  } catch (error) {
    console.error('Toggle API error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// 7. Push notification (main endpoint)
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

// 8. Get notifications
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

// 9. Get stats
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
      },
      users: {
        total: Object.keys(users).length,
        totalApis: Object.keys(APIS).length
      }
    }
  });
});

// 10. Get dashboard data
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

// 11. Clear all data
app.delete('/api/clear', authenticateUser, async (req, res) => {
  try {
    // Only allow if user has admin role or specific permission
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

    console.log(`🗑️ Cleared ${count} notifications by ${req.user}`);

    res.json({
      success: true,
      message: `Cleared ${count} notifications`,
      cleared: count
    });
  } catch (error) {
    console.error('Clear data error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
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
║  🔐 Login:     http://localhost:${PORT}/login${' '.repeat(38 - `http://localhost:${PORT}/login`.length)}║
║  📡 API:       http://localhost:${PORT}/api${' '.repeat(38 - `http://localhost:${PORT}/api`.length)}║
║  ❤️  Health:    http://localhost:${PORT}/health${' '.repeat(38 - `http://localhost:${PORT}/health`.length)}║
╚═══════════════════════════════════════════════════╝
  `);
  
  console.log('✅ Server is ready to receive notifications!\n');
  console.log(`👥 Users: ${Object.keys(users).length}`);
  console.log(`📦 APIs: ${Object.keys(APIS).length}`);
  console.log(`📊 Notifications: ${notifications.all.length}`);
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
