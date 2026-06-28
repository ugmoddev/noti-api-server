// ============================================
// CONFIGURATION
// ============================================
const API_BASE = window.location.origin;
const WS_BASE = window.location.origin.replace('http', 'ws');

let currentUser = null;
let ws = null;
let currentTab = 'apis';
let chatConnected = false;

// ============================================
// DOM ELEMENTS
// ============================================
const elements = {
    // User
    userInfo: document.getElementById('userInfo'),
    userAvatar: document.getElementById('userAvatar'),
    userName: document.getElementById('userName'),
    userRole: document.getElementById('userRole'),
    authBtn: document.getElementById('authBtn'),
    
    // Stats
    totalApis: document.getElementById('totalApis'),
    totalJobs: document.getElementById('totalJobs'),
    totalUsers: document.getElementById('totalUsers'),
    runningBots: document.getElementById('runningBots'),
    
    // Lists
    apiList: document.getElementById('apiList'),
    botList: document.getElementById('botList'),
    monitorList: document.getElementById('monitorList'),
    
    // Chat
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    chatSendBtn: document.getElementById('chatSendBtn'),
    onlineCount: document.getElementById('onlineCount'),
    
    // Modal
    modal: document.getElementById('modal'),
    modalTitle: document.getElementById('modalTitle'),
    modalBody: document.getElementById('modalBody'),
    modalClose: document.querySelector('.modal-close'),
    
    // Buttons
    createApiBtn: document.getElementById('createApiBtn'),
    createBotBtn: document.getElementById('createBotBtn'),
    createMonitorBtn: document.getElementById('createMonitorBtn'),
    
    // Badges
    apiCount: document.getElementById('apiCount'),
    botCount: document.getElementById('botCount'),
    monitorCount: document.getElementById('monitorCount'),
    chatCount: document.getElementById('chatCount'),
};

// ============================================
// UTILITY FUNCTIONS
// ============================================
function getToken() {
    return localStorage.getItem('token');
}

function setToken(token) {
    if (token) {
        localStorage.setItem('token', token);
    } else {
        localStorage.removeItem('token');
    }
}

function getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) {
        headers['Authorization'] = token;
    }
    return headers;
}

async function apiFetch(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers: {
                ...getHeaders(),
                ...options.headers,
            },
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString('vi-VN');
}

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString('vi-VN');
}

function formatRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days} ngày trước`;
    if (hours > 0) return `${hours} giờ trước`;
    if (minutes > 0) return `${minutes} phút trước`;
    return `${seconds} giây trước`;
}

function getStatusColor(status) {
    const colors = {
        'online': 'status-online',
        'offline': 'status-offline',
        'running': 'status-running',
        'stopped': 'status-stopped',
        'waiting': 'status-stopped',
        'restarting': 'status-running',
        'error': 'status-offline'
    };
    return colors[status] || 'status-stopped';
}

function getStatusIcon(status) {
    const icons = {
        'online': 'fa-circle',
        'offline': 'fa-circle',
        'running': 'fa-play',
        'stopped': 'fa-stop',
        'waiting': 'fa-hourglass-half',
        'restarting': 'fa-sync fa-spin',
        'error': 'fa-exclamation-triangle'
    };
    return icons[status] || 'fa-circle';
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fas ${icons[type] || icons.info}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ============================================
// AUTH FUNCTIONS
// ============================================
async function checkAuth() {
    const token = getToken();
    if (token) {
        try {
            const data = await apiFetch('/me');
            if (data.user) {
                currentUser = data;
                updateUI();
                return true;
            }
        } catch (e) {
            // Token invalid
        }
    }
    setToken(null);
    currentUser = null;
    updateUI();
    return false;
}

function updateUI() {
    if (currentUser) {
        elements.userAvatar.src = currentUser.avatar || '/assets/images/default-avatar.png';
        elements.userName.textContent = currentUser.user;
        elements.userRole.textContent = currentUser.role || 'member';
        elements.authBtn.innerHTML = `
            <i class="fas fa-sign-out-alt"></i>
            <span>Đăng xuất</span>
        `;
        elements.authBtn.className = 'btn btn-danger';
    } else {
        elements.userAvatar.src = '/assets/images/default-avatar.png';
        elements.userName.textContent = 'Guest';
        elements.userRole.textContent = 'visitor';
        elements.authBtn.innerHTML = `
            <i class="fas fa-sign-in-alt"></i>
            <span>Đăng nhập</span>
        `;
        elements.authBtn.className = 'btn btn-primary';
    }
}

// ============================================
// TAB NAVIGATION
// ============================================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const tab = btn.dataset.tab;
        currentTab = tab;
        
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.getElementById(`tab-${tab}`).classList.add('active');
        
        // Load data based on tab
        switch(tab) {
            case 'apis': loadApis(); break;
            case 'bots': loadBots(); break;
            case 'monitors': loadMonitors(); break;
            case 'chat': connectChat(); break;
        }
    });
});

// ============================================
// AUTH HANDLER
// ============================================
elements.authBtn.addEventListener('click', async () => {
    if (currentUser) {
        // Logout
        try {
            await apiFetch('/logout', { method: 'POST' });
            setToken(null);
            currentUser = null;
            updateUI();
            loadStats();
            loadApis();
            showToast('Đã đăng xuất', 'info');
            if (ws) {
                ws.close();
                ws = null;
            }
        } catch (error) {
            showToast('Lỗi đăng xuất', 'error');
        }
    } else {
        showLoginModal();
    }
});

// ============================================
// MODAL FUNCTIONS
// ============================================
function openModal(title, html) {
    elements.modalTitle.innerHTML = title;
    elements.modalBody.innerHTML = html;
    elements.modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    elements.modal.style.display = 'none';
    document.body.style.overflow = '';
}

elements.modalClose.addEventListener('click', closeModal);
window.addEventListener('click', (e) => {
    if (e.target === elements.modal) closeModal();
});

// ============================================
// LOGIN / REGISTER
// ============================================
function showLoginModal() {
    openModal('🔐 Đăng nhập', `
        <div class="form-group">
            <label>Tên đăng nhập</label>
            <input type="text" id="loginUser" placeholder="Nhập tên đăng nhập">
        </div>
        <div class="form-group">
            <label>Mật khẩu</label>
            <input type="password" id="loginPass" placeholder="Nhập mật khẩu">
        </div>
        <div class="form-actions">
            <button onclick="closeModal()" class="btn btn-danger">Hủy</button>
            <button onclick="login()" class="btn btn-success">
                <i class="fas fa-sign-in-alt"></i> Đăng nhập
            </button>
        </div>
        <div style="margin-top: 16px; text-align: center;">
            <button onclick="showRegisterModal()" class="btn btn-primary btn-sm">
                <i class="fas fa-user-plus"></i> Đăng ký tài khoản mới
            </button>
        </div>
    `);
}

function showRegisterModal() {
    openModal('📝 Đăng ký', `
        <div class="form-group">
            <label>Tên đăng nhập</label>
            <input type="text" id="registerUser" placeholder="Chọn tên đăng nhập">
        </div>
        <div class="form-group">
            <label>Mật khẩu (ít nhất 8 ký tự)</label>
            <input type="password" id="registerPass" placeholder="Nhập mật khẩu">
        </div>
        <div class="form-group">
            <label>Nhập lại mật khẩu</label>
            <input type="password" id="registerPass2" placeholder="Nhập lại mật khẩu">
        </div>
        <div class="form-actions">
            <button onclick="closeModal()" class="btn btn-danger">Hủy</button>
            <button onclick="register()" class="btn btn-success">
                <i class="fas fa-user-plus"></i> Đăng ký
            </button>
        </div>
        <div style="margin-top: 16px; text-align: center;">
            <button onclick="showLoginModal()" class="btn btn-primary btn-sm">
                <i class="fas fa-sign-in-alt"></i> Đã có tài khoản? Đăng nhập
            </button>
        </div>
    `);
}

async function login() {
    const user = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value.trim();
    
    if (!user || !pass) {
        showToast('Vui lòng nhập đầy đủ thông tin', 'error');
        return;
    }
    
    try {
        const data = await apiFetch('/login', {
            method: 'POST',
            body: JSON.stringify({ user, pass }),
        });
        
        if (data.err) {
            showToast(data.err, 'error');
            return;
        }
        
        setToken(data.token);
        closeModal();
        await checkAuth();
        loadAllData();
        connectChat();
        showToast('Đăng nhập thành công!', 'success');
    } catch (error) {
        showToast('Lỗi đăng nhập', 'error');
    }
}

async function register() {
    const user = document.getElementById('registerUser').value.trim();
    const pass = document.getElementById('registerPass').value;
    const pass2 = document.getElementById('registerPass2').value;
    
    if (!user || !pass || !pass2) {
        showToast('Vui lòng nhập đầy đủ thông tin', 'error');
        return;
    }
    if (pass !== pass2) {
        showToast('Mật khẩu nhập lại không khớp', 'error');
        return;
    }
    if (pass.length < 8) {
        showToast('Mật khẩu phải có ít nhất 8 ký tự', 'error');
        return;
    }
    if (/\s/.test(user)) {
        showToast('Tên đăng nhập không chứa khoảng trắng', 'error');
        return;
    }
    
    try {
        const data = await apiFetch('/register', {
            method: 'POST',
            body: JSON.stringify({ user, pass }),
        });
        
        if (data.err) {
            showToast(data.err, 'error');
            return;
        }
        
        showToast('Đăng ký thành công! Vui lòng đăng nhập.', 'success');
        closeModal();
        showLoginModal();
    } catch (error) {
        showToast('Lỗi đăng ký', 'error');
    }
}

// ============================================
// LOAD DATA FUNCTIONS
// ============================================
async function loadStats() {
    try {
        const data = await apiFetch('/owner/stats');
        if (!data.err) {
            elements.totalApis.textContent = data.totalApis || 0;
            elements.totalJobs.textContent = data.totalJobs || 0;
            elements.totalUsers.textContent = data.totalUsers || 0;
            elements.runningBots.textContent = data.runningBots || 0;
            
            // Update badges
            elements.apiCount.textContent = data.totalApis || 0;
            elements.botCount.textContent = data.totalBots || 0;
            elements.monitorCount.textContent = data.totalMonitors || 0;
        }
    } catch (e) {
        console.error('Failed to load stats:', e);
    }
}

async function loadApis() {
    try {
        const apis = await apiFetch('/my');
        if (Array.isArray(apis)) {
            renderApis(apis);
        }
    } catch (e) {
        console.error('Failed to load APIs:', e);
        showToast('Lỗi tải danh sách API', 'error');
    }
}

function renderApis(apis) {
    if (!apis || apis.length === 0) {
        elements.apiList.innerHTML = `
            <div class="empty-state">
                <img src="/assets/images/empty-state.svg" alt="Empty">
                <h3>Chưa có API nào</h3>
                <p>Hãy tạo API mới để bắt đầu nhận jobs</p>
            </div>
        `;
        return;
    }
    
    elements.apiList.innerHTML = apis.map(api => `
        <div class="api-card">
            <div class="card-header">
                <div class="card-title">
                    <i class="fas fa-code"></i>
                    ${api.displayName || api.name}
                </div>
                <span class="status-badge ${api.enabled ? 'status-online' : 'status-offline'}">
                    ${api.enabled ? 'Online' : 'Offline'}
                </span>
            </div>
            <div class="card-owner">
                <i class="fas fa-user"></i> ${api.owner}
            </div>
            <div class="card-stats">
                <span class="stat-item">
                    <i class="fas fa-tasks"></i> ${api.totalJobs} jobs
                </span>
                <span class="stat-item">
                    <i class="fas fa-users"></i> ${Object.keys(api.bosses || {}).length} bosses
                </span>
                ${api.privateMode ? `<span class="stat-item"><i class="fas fa-lock"></i> Private</span>` : ''}
            </div>
            <div class="card-actions">
                <button onclick="viewApi('${api.id}')" class="btn btn-info btn-sm">
                    <i class="fas fa-eye"></i> Xem
                </button>
                <button onclick="editApi('${api.id}')" class="btn btn-warning btn-sm">
                    <i class="fas fa-edit"></i> Sửa
                </button>
                <button onclick="copyApiKey('${api.apiKey}')" class="btn btn-primary btn-sm">
                    <i class="fas fa-key"></i> Key
                </button>
                <button onclick="deleteApi('${api.id}')" class="btn btn-danger btn-sm">
                    <i class="fas fa-trash"></i> Xóa
                </button>
            </div>
        </div>
    `).join('');
}

async function loadBots() {
    try {
        const bots = await apiFetch('/bot/my');
        if (Array.isArray(bots)) {
            renderBots(bots);
        }
    } catch (e) {
        console.error('Failed to load bots:', e);
    }
}

function renderBots(bots) {
    if (!bots || bots.length === 0) {
        elements.botList.innerHTML = `
            <div class="empty-state">
                <img src="/assets/images/empty-state.svg" alt="Empty">
                <h3>Chưa có bot nào</h3>
                <p>Tạo bot Discord và host ngay hôm nay</p>
            </div>
        `;
        return;
    }
    
    elements.botList.innerHTML = bots.map(bot => `
        <div class="bot-card">
            <div class="card-header">
                <div class="card-title">
                    <i class="fas fa-robot"></i>
                    ${bot.name}
                </div>
                <span class="status-badge ${getStatusColor(bot.status)}">
                    <i class="fas ${getStatusIcon(bot.status)}"></i>
                    ${bot.status}
                </span>
            </div>
            <div class="card-stats">
                <span class="stat-item">
                    <i class="fas fa-sync"></i> Restart: ${bot.restartCount || 0}
                </span>
                <span class="stat-item">
                    <i class="fas ${bot.autoRestart ? 'fa-toggle-on' : 'fa-toggle-off'}"></i>
                    ${bot.autoRestart ? 'Auto' : 'Manual'}
                </span>
                <span class="stat-item">
                    <i class="fas fa-clock"></i> ${formatRelativeTime(bot.updated_at)}
                </span>
            </div>
            <div class="card-actions">
                ${bot.status === 'running' || bot.status === 'restarting' ? 
                    `<button onclick="stopBot('${bot.id}')" class="btn btn-danger btn-sm">
                        <i class="fas fa-stop"></i> Dừng
                    </button>` :
                    `<button onclick="startBot('${bot.id}')" class="btn btn-success btn-sm">
                        <i class="fas fa-play"></i> Chạy
                    </button>`
                }
                <button onclick="viewBotLogs('${bot.id}')" class="btn btn-info btn-sm">
                    <i class="fas fa-file-alt"></i> Logs
                </button>
                <button onclick="deleteBot('${bot.id}')" class="btn btn-danger btn-sm">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

async function loadMonitors() {
    try {
        const monitors = await apiFetch('/monitor/my');
        if (Array.isArray(monitors)) {
            renderMonitors(monitors);
        }
    } catch (e) {
        console.error('Failed to load monitors:', e);
    }
}

function renderMonitors(monitors) {
    if (!monitors || monitors.length === 0) {
        elements.monitorList.innerHTML = `
            <div class="empty-state">
                <img src="/assets/images/empty-state.svg" alt="Empty">
                <h3>Chưa có monitor nào</h3>
                <p>Theo dõi uptime website của bạn</p>
            </div>
        `;
        return;
    }
    
    elements.monitorList.innerHTML = monitors.map(m => `
        <div class="monitor-card">
            <div class="card-header">
                <div class="card-title">
                    <i class="fas fa-heartbeat"></i>
                    ${m.name}
                </div>
                <span class="status-badge ${getStatusColor(m.lastStatus)}">
                    <i class="fas ${getStatusIcon(m.lastStatus)}"></i>
                    ${m.lastStatus}
                </span>
            </div>
            <div class="card-owner">
                <i class="fas fa-link"></i> ${m.url}
            </div>
            <div class="card-stats">
                <span class="stat-item">
                    <i class="fas fa-chart-line"></i> ${m.uptime || 0}%
                </span>
                <span class="stat-item">
                    <i class="fas fa-clock"></i> ${m.lastPing || 0}ms
                </span>
                <span class="stat-item">
                    <i class="fas fa-check"></i> ${m.goodChecks || 0}/${m.totalChecks || 0}
                </span>
            </div>
            <div class="card-actions">
                <button onclick="viewMonitor('${m.id}')" class="btn btn-info btn-sm">
                    <i class="fas fa-eye"></i> Xem
                </button>
                <button onclick="deleteMonitor('${m.id}')" class="btn btn-danger btn-sm">
                    <i class="fas fa-trash"></i> Xóa
                </button>
            </div>
        </div>
    `).join('');
}

// ============================================
// API ACTIONS
// ============================================
window.viewApi = async function(apiId) {
    try {
        const data = await apiFetch(`/api/${apiId}/stats`);
        if (data.err) {
            showToast(data.err, 'error');
            return;
        }
        
        const bossList = Object.entries(data.bosses || {})
            .map(([name, count]) => `<li>${name}: ${count} jobs</li>`)
            .join('');
        
        openModal(`📊 ${data.displayName || data.id}`, `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div><strong>ID:</strong> ${data.id}</div>
                <div><strong>Tổng jobs:</strong> ${data.totalJobs || 0}</div>
                <div><strong>TTL:</strong> ${data.ttl / 1000}s</div>
                <div><strong>Trạng thái:</strong> ${data.enabled ? '✅ Online' : '❌ Offline'}</div>
                <div><strong>Max jobs/boss:</strong> ${data.maxJobsPerBoss || 'Không giới hạn'}</div>
                <div><strong>Private:</strong> ${data.privateMode ? '🔒 Có' : '🔓 Không'}</div>
            </div>
            ${bossList ? `
                <div style="margin-top: 16px;">
                    <strong>Bosses:</strong>
                    <ul style="margin-top: 8px; padding-left: 20px;">${bossList}</ul>
                </div>
            ` : ''}
            <div class="form-actions">
                <button onclick="closeModal()" class="btn btn-primary">Đóng</button>
            </div>
        `);
    } catch (e) {
        showToast('Lỗi khi tải dữ liệu', 'error');
    }
};

window.editApi = async function(apiId) {
    try {
        const apis = await apiFetch('/my');
        const api = apis.find(a => a.id === apiId);
        if (!api) {
            showToast('Không tìm thấy API', 'error');
            return;
        }
        
        openModal(`✏️ Sửa API: ${api.displayName || api.name}`, `
            <div class="form-group">
                <label>Tên hiển thị</label>
                <input type="text" id="editDisplayName" value="${api.displayName || ''}">
            </div>
            <div class="form-group">
                <label>TTL (ms)</label>
                <input type="number" id="editTtl" value="${api.ttl || 60000}">
            </div>
            <div class="form-group">
                <label>Webhook URL</label>
                <input type="url" id="editWebhook" value="${api.webhook || ''}">
            </div>
            <div class="form-group">
                <label>Prefix</label>
                <input type="text" id="editPrefix" value="${api.prefix || ''}">
            </div>
            <div class="form-group">
                <label>Suffix</label>
                <input type="text" id="editSuffix" value="${api.suffix || ''}">
            </div>
            <div class="form-group">
                <div class="checkbox-group">
                    <input type="checkbox" id="editEnabled" ${api.enabled ? 'checked' : ''}>
                    <label>Kích hoạt</label>
                </div>
            </div>
            <div class="form-group">
                <div class="checkbox-group">
                    <input type="checkbox" id="editPrivate" ${api.privateMode ? 'checked' : ''}>
                    <label>Chế độ riêng tư</label>
                </div>
            </div>
            <div class="form-actions">
                <button onclick="closeModal()" class="btn btn-danger">Hủy</button>
                <button onclick="saveApiSettings('${apiId}')" class="btn btn-success">
                    <i class="fas fa-save"></i> Lưu
                </button>
            </div>
        `);
    } catch (e) {
        showToast('Lỗi khi tải dữ liệu', 'error');
    }
};

window.saveApiSettings = async function(apiId) {
    const settings = {
        id: apiId,
        displayName: document.getElementById('editDisplayName').value,
        ttl: parseInt(document.getElementById('editTtl').value) || 60000,
        webhook: document.getElementById('editWebhook').value,
        prefix: document.getElementById('editPrefix').value,
        suffix: document.getElementById('editSuffix').value,
        enabled: document.getElementById('editEnabled').checked,
        privateMode: document.getElementById('editPrivate').checked,
    };
    
    try {
        const result = await apiFetch('/settings', {
            method: 'POST',
            body: JSON.stringify(settings),
        });
        
        if (result.err) {
            showToast(result.err, 'error');
        } else {
            showToast('Cập nhật thành công!', 'success');
            closeModal();
            loadApis();
            loadStats();
        }
    } catch (e) {
        showToast('Lỗi khi lưu', 'error');
    }
};

window.copyApiKey = function(apiKey) {
    navigator.clipboard.writeText(apiKey).then(() => {
        showToast('Đã sao chép API Key', 'success');
    }).catch(() => {
        showToast('Không thể sao chép', 'error');
    });
};

window.deleteApi = async function(apiId) {
    if (!confirm('Bạn có chắc muốn xóa API này?')) return;
    
    try {
        const result = await apiFetch(`/api/${apiId}`, { method: 'DELETE' });
        if (result.err) {
            showToast(result.err, 'error');
        } else {
            showToast('Đã xóa API', 'success');
            loadApis();
            loadStats();
        }
    } catch (e) {
        showToast('Lỗi khi xóa', 'error');
    }
};

// ============================================
// BOT ACTIONS
// ============================================
window.startBot = async function(botId) {
    try {
        const result = await apiFetch(`/bot/${botId}/start`, {
            method: 'POST',
            body: JSON.stringify({ autoRestart: true })
        });
        
        if (result.err) {
            showToast(result.err, 'error');
        } else {
            showToast('Bot đã được khởi động', 'success');
            loadBots();
            loadStats();
        }
    } catch (e) {
        showToast('Lỗi khi khởi động bot', 'error');
    }
};

window.stopBot = async function(botId) {
    try {
        const result = await apiFetch(`/bot/${botId}/stop`, { method: 'POST' });
        if (result.err) {
            showToast(result.err, 'error');
        } else {
            showToast('Bot đã dừng', 'success');
            loadBots();
            loadStats();
        }
    } catch (e) {
        showToast('Lỗi khi dừng bot', 'error');
    }
};

window.viewBotLogs = async function(botId) {
    try {
        const data = await apiFetch(`/bot/${botId}/logs`);
        if (data.err) {
            showToast(data.err, 'error');
            return;
        }
        
        const logsHtml = data.logs.length > 0 
            ? data.logs.map(log => `<div>${log}</div>`).join('')
            : '<div style="color: var(--text-muted);">Không có logs</div>';
        
        openModal(`📋 Logs: ${botId}`, `
            <div style="background: #1a1a2e; color: #00ff00; padding: 16px; border-radius: 8px; max-height: 400px; overflow-y: auto; font-family: 'Courier New', monospace; font-size: 0.85rem; white-space: pre-wrap; line-height: 1.5;">
                ${logsHtml}
            </div>
            <div class="form-actions">
                <button onclick="closeModal()" class="btn btn-primary">Đóng</button>
            </div>
        `);
    } catch (e) {
        showToast('Lỗi khi tải logs', 'error');
    }
};

window.deleteBot = async function(botId) {
    if (!confirm('Bạn có chắc muốn xóa bot này?')) return;
    
    try {
        const result = await apiFetch(`/bot/${botId}`, { method: 'DELETE' });
        if (result.err) {
            showToast(result.err, 'error');
        } else {
            showToast('Đã xóa bot', 'success');
            loadBots();
            loadStats();
        }
    } catch (e) {
        showToast('Lỗi khi xóa bot', 'error');
    }
};

// ============================================
// MONITOR ACTIONS
// ============================================
window.viewMonitor = async function(monitorId) {
    try {
        const data = await apiFetch(`/monitor/${monitorId}`);
        if (data.err) {
            showToast(data.err, 'error');
            return;
        }
        
        const historyHtml = (data.history || []).slice(-10).map(h => `
            <div style="display: flex; justify-content: space-between; padding: 4px 8px; border-bottom: 1px solid var(--border-color);">
                <span>${h.s === 'on' ? '🟢' : '🔴'} ${h.s}</span>
                <span>${h.p || 0}ms</span>
                <span style="font-size: 0.8rem; color: var(--text-muted);">${formatTime(h.t)}</span>
            </div>
        `).join('');
        
        openModal(`📡 ${data.name}`, `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div><strong>URL:</strong> ${data.url}</div>
                <div><strong>Trạng thái:</strong> ${data.lastStatus}</div>
                <div><strong>Uptime:</strong> ${data.uptime || 0}%</div>
                <div><strong>Ping:</strong> ${data.lastPing || 0}ms</div>
                <div><strong>Kiểm tra:</strong> ${data.totalChecks || 0} lần</div>
                <div><strong>Last check:</strong> ${data.lastCheck ? formatDate(data.lastCheck) : 'Chưa kiểm tra'}</div>
            </div>
            ${historyHtml ? `
                <div style="margin-top: 16px;">
                    <strong>Lịch sử gần đây:</strong>
                    <div style="margin-top: 8px; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;">
                        ${historyHtml}
                    </div>
                </div>
            ` : ''}
            <div class="form-actions">
                <button onclick="closeModal()" class="btn btn-primary">Đóng</button>
            </div>
        `);
    } catch (e) {
        showToast('Lỗi khi tải dữ liệu', 'error');
    }
};

window.deleteMonitor = async function(monitorId) {
    if (!confirm('Bạn có chắc muốn xóa monitor này?')) return;
    
    try {
        const result = await apiFetch(`/monitor/${monitorId}`, { method: 'DELETE' });
        if (result.err) {
            showToast(result.err, 'error');
        } else {
            showToast('Đã xóa monitor', 'success');
            loadMonitors();
            loadStats();
        }
    } catch (e) {
        showToast('Lỗi khi xóa monitor', 'error');
    }
};

// ============================================
// CREATE FUNCTIONS
// ============================================
// Create API
elements.createApiBtn.addEventListener('click', () => {
    if (!currentUser) {
        showToast('Vui lòng đăng nhập để tạo API', 'error');
        return;
    }
    
    openModal('📦 Tạo API mới', `
        <div class="form-group">
            <label>Tên API <span style="color: var(--danger);">*</span></label>
            <input type="text" id="createApiName" placeholder="my_api (chỉ chữ, số, _)">
            <small style="color: var(--text-muted);">Chỉ chứa chữ, số và dấu gạch dưới</small>
        </div>
        <div class="form-group">
            <label>Tên hiển thị</label>
            <input type="text" id="createApiDisplay" placeholder="My API">
        </div>
        <div class="form-group">
            <label>Webhook URL (tùy chọn)</label>
            <input type="url" id="createApiWebhook" placeholder="https://discord.com/api/webhooks/...">
        </div>
        <div class="form-group">
            <div class="checkbox-group">
                <input type="checkbox" id="createApiPrivate">
                <label>Chế độ riêng tư (chỉ IP được phép truy cập)</label>
            </div>
        </div>
        <div class="form-actions">
            <button onclick="closeModal()" class="btn btn-danger">Hủy</button>
            <button onclick="createApi()" class="btn btn-success">
                <i class="fas fa-plus"></i> Tạo
            </button>
        </div>
    `);
});

async function createApi() {
    const name = document.getElementById('createApiName').value.trim();
    const displayName = document.getElementById('createApiDisplay').value.trim() || name;
    const webhook = document.getElementById('createApiWebhook').value.trim();
    const privateMode = document.getElementById('createApiPrivate').checked;
    
    if (!name) {
        showToast('Vui lòng nhập tên API', 'error');
        return;
    }
    if (!/^[\w]+$/.test(name)) {
        showToast('Tên API chỉ được chứa chữ, số và _', 'error');
        return;
    }
    
    try {
        const data = await apiFetch('/create', {
            method: 'POST',
            body: JSON.stringify({ name, displayName, webhook, privateMode }),
        });
        
        if (data.err) {
            showToast(data.err, 'error');
            return;
        }
        
        showToast(`Tạo API thành công! API Key: ${data.apiKey}`, 'success');
        closeModal();
        loadApis();
        loadStats();
    } catch (e) {
        showToast('Lỗi khi tạo API', 'error');
    }
}

// Create Bot
elements.createBotBtn.addEventListener('click', () => {
    if (!currentUser) {
        showToast('Vui lòng đăng nhập để tạo bot', 'error');
        return;
    }
    
    openModal('🤖 Tạo Bot mới', `
        <div class="form-group">
            <label>Tên bot <span style="color: var(--danger);">*</span></label>
            <input type="text" id="createBotName" placeholder="My Bot">
        </div>
        <div class="form-group">
            <label>Mã nguồn Python <span style="color: var(--danger);">*</span></label>
            <textarea id="createBotCode" placeholder="import discord&#10;from discord.ext import commands&#10;&#10;bot = commands.Bot(command_prefix='!')&#10;&#10;@bot.event&#10;async def on_ready():&#10;    print('Bot is ready!')&#10;&#10;bot.run('YOUR_TOKEN')"></textarea>
            <small style="color: var(--text-muted);">Paste mã nguồn Discord bot của bạn</small>
        </div>
        <div class="form-group">
            <label>Environment Variables (JSON)</label>
            <input type="text" id="createBotEnv" placeholder='{"DISCORD_TOKEN": "your_token"}'>
        </div>
        <div class="form-group">
            <div class="checkbox-group">
                <input type="checkbox" id="createBotAutoRestart" checked>
                <label>Tự động restart khi crash</label>
            </div>
        </div>
        <div class="form-actions">
            <button onclick="closeModal()" class="btn btn-danger">Hủy</button>
            <button onclick="createBot()" class="btn btn-success">
                <i class="fas fa-plus"></i> Tạo
            </button>
        </div>
    `);
});

async function createBot() {
    const name = document.getElementById('createBotName').value.trim();
    const code = document.getElementById('createBotCode').value.trim();
    const env = document.getElementById('createBotEnv').value.trim();
    const autoRestart = document.getElementById('createBotAutoRestart').checked;
    
    if (!name) {
        showToast('Vui lòng nhập tên bot', 'error');
        return;
    }
    if (!code) {
        showToast('Vui lòng nhập mã nguồn bot', 'error');
        return;
    }
    
    try {
        const data = await apiFetch('/bot/create', {
            method: 'POST',
            body: JSON.stringify({ name, code, env, autoRestart }),
        });
        
        if (data.err) {
            showToast(data.err, 'error');
            return;
        }
        
        showToast('Tạo bot thành công!', 'success');
        closeModal();
        loadBots();
        loadStats();
    } catch (e) {
        showToast('Lỗi khi tạo bot', 'error');
    }
}

// Create Monitor
elements.createMonitorBtn.addEventListener('click', () => {
    if (!currentUser) {
        showToast('Vui lòng đăng nhập để tạo monitor', 'error');
        return;
    }
    
    openModal('📡 Tạo Monitor mới', `
        <div class="form-group">
            <label>Tên monitor <span style="color: var(--danger);">*</span></label>
            <input type="text" id="createMonitorName" placeholder="My Service">
        </div>
        <div class="form-group">
            <label>URL <span style="color: var(--danger);">*</span></label>
            <input type="url" id="createMonitorUrl" placeholder="https://example.com">
        </div>
        <div class="form-group">
            <label>Interval (ms)</label>
            <input type="number" id="createMonitorInterval" value="60000" min="30000">
            <small style="color: var(--text-muted);">Tối thiểu 30000ms (30s)</small>
        </div>
        <div class="form-group">
            <label>Webhook URL (tùy chọn)</label>
            <input type="url" id="createMonitorWebhook" placeholder="https://discord.com/api/webhooks/...">
        </div>
        <div class="form-actions">
            <button onclick="closeModal()" class="btn btn-danger">Hủy</button>
            <button onclick="createMonitor()" class="btn btn-success">
                <i class="fas fa-plus"></i> Tạo
            </button>
        </div>
    `);
});

async function createMonitor() {
    const name = document.getElementById('createMonitorName').value.trim();
    const url = document.getElementById('createMonitorUrl').value.trim();
    const interval = parseInt(document.getElementById('createMonitorInterval').value);
    const webhook = document.getElementById('createMonitorWebhook').value.trim();
    
    if (!name || !url) {
        showToast('Vui lòng điền đầy đủ thông tin', 'error');
        return;
    }
    if (!url.startsWith('http')) {
        showToast('URL phải bắt đầu bằng http/https', 'error');
        return;
    }
    if (interval < 30000) {
        showToast('Interval tối thiểu là 30000ms', 'error');
        return;
    }
    
    try {
        const data = await apiFetch('/monitor/create', {
            method: 'POST',
            body: JSON.stringify({ name, url, interval, webhook }),
        });
        
        if (data.err) {
            showToast(data.err, 'error');
            return;
        }
        
        showToast('Tạo monitor thành công!', 'success');
        closeModal();
        loadMonitors();
        loadStats();
    } catch (e) {
        showToast('Lỗi khi tạo monitor', 'error');
    }
}

// ============================================
// CHAT
// ============================================
function connectChat() {
    const token = getToken();
    if (!token) {
        elements.chatMessages.innerHTML = `
            <div class="empty-state">
                <h3>💬 Đăng nhập để chat</h3>
                <p>Vui lòng đăng nhập để tham gia chat room</p>
            </div>
        `;
        return;
    }
    
    if (ws && ws.readyState === WebSocket.OPEN) {
        return;
    }
    
    const wsUrl = `${WS_BASE}/ws?token=${token}`;
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        chatConnected = true;
        elements.chatMessages.innerHTML = '';
        elements.onlineCount.textContent = '?';
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'history') {
                elements.chatMessages.innerHTML = '';
                data.messages.forEach(msg => addChatMessage(msg));
            } else if (data.type === 'msg') {
                addChatMessage(data);
            } else if (data.type === 'online') {
                elements.onlineCount.textContent = data.count || 0;
            }
        } catch (e) {
            console.error('WebSocket message error:', e);
        }
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        chatConnected = false;
        elements.onlineCount.textContent = '0';
        setTimeout(() => {
            if (currentUser) connectChat();
        }, 3000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

function addChatMessage(msg) {
    const isSelf = currentUser && msg.user === currentUser.user;
    const div = document.createElement('div');
    div.className = `chat-message ${isSelf ? 'self' : 'other'}`;
    div.innerHTML = `
        <div class="msg-user">${msg.user}</div>
        <div class="msg-content">${escapeHtml(msg.content)}</div>
        <div class="msg-time">${formatTime(msg.timestamp)}</div>
    `;
    elements.chatMessages.appendChild(div);
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Chat send
elements.chatSendBtn.addEventListener('click', sendChatMessage);
elements.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
    const content = elements.chatInput.value.trim();
    if (!content) return;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        showToast('Không kết nối được chat server', 'error');
        return;
    }
    
    ws.send(JSON.stringify({ type: 'msg', content }));
    elements.chatInput.value = '';
}

// ============================================
// INITIALIZATION
// ============================================
async function loadAllData() {
    await loadStats();
    await loadApis();
    if (currentUser) {
        await loadBots();
        await loadMonitors();
    }
}

async function init() {
    await checkAuth();
    await loadAllData();
    
    if (currentUser) {
        connectChat();
    }
    
    // Auto refresh stats every 30 seconds
    setInterval(loadStats, 30000);
}

// Start the app
init();

// ============================================
// GLOBAL ERROR HANDLING
// ============================================
window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    showToast('Đã xảy ra lỗi, vui lòng thử lại', 'error');
});

console.log('🚀 Job Queue System loaded successfully!');
