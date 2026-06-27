// Create API Script

// DOM Elements
const form = document.getElementById('createApiForm');
const apiList = document.getElementById('apiList');
const privateModeRadios = document.querySelectorAll('input[name="privateMode"]');
const viewIPGroup = document.getElementById('viewIPGroup');
const whitelistGroup = document.getElementById('whitelistGroup');

// Toggle visibility based on private mode
privateModeRadios.forEach(radio => {
    radio.addEventListener('change', function() {
        const isPrivate = this.value === 'true';
        viewIPGroup.style.display = isPrivate ? 'block' : 'none';
        whitelistGroup.style.display = isPrivate ? 'block' : 'none';
    });
});

// Load user's APIs
async function loadUserApis() {
    try {
        const response = await API.getMyApis();
        if (response.success) {
            renderApiList(response.data || []);
            document.getElementById('apiCount').textContent = response.data?.length || 0;
        }
    } catch (error) {
        console.error('Failed to load APIs:', error);
        apiList.innerHTML = `
            <div class="error-message">
                <i class="fas fa-exclamation-circle"></i>
                <p>Không thể tải danh sách API</p>
            </div>
        `;
    }
}

// Render API list
function renderApiList(apis) {
    if (!apis || apis.length === 0) {
        apiList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-plus-circle"></i>
                <p>Bạn chưa tạo API nào</p>
                <small>Tạo API đầu tiên của bạn bằng form bên trên</small>
            </div>
        `;
        return;
    }

    apiList.innerHTML = apis.map(api => `
        <div class="api-card">
            <div class="api-card-header">
                <div class="api-card-title">
                    <h3>${api.displayName || api.name}</h3>
                    <span class="api-status ${api.enabled ? 'enabled' : 'disabled'}">
                        ${api.enabled ? '✅ Đang hoạt động' : '❌ Đã tắt'}
                    </span>
                </div>
                <div class="api-card-actions">
                    <button onclick="deleteApi('${api.id}')" class="btn-icon danger" title="Xóa">
                        <i class="fas fa-trash"></i>
                    </button>
                    <button onclick="toggleApi('${api.id}')" class="btn-icon" title="Bật/Tắt">
                        <i class="fas fa-power-off"></i>
                    </button>
                </div>
            </div>
            <div class="api-card-body">
                <div class="api-info">
                    <div class="info-item">
                        <span class="label">ID:</span>
                        <code>${api.id}</code>
                    </div>
                    <div class="info-item">
                        <span class="label">Tên:</span>
                        <span>${api.name}</span>
                    </div>
                </div>
                <div class="api-stats">
                    <div class="stat-box">
                        <span class="stat-number">${api.totalJobs || 0}</span>
                        <span class="stat-label">Tổng jobs</span>
                    </div>
                    <div class="stat-box">
                        <span class="stat-number">${api.bossCount || 0}</span>
                        <span class="stat-label">Boss</span>
                    </div>
                </div>
                <div class="api-settings">
                    <span class="setting-tag ${api.privateMode ? 'private' : 'public'}">
                        ${api.privateMode ? '🔒 Private' : '🌍 Public'}
                    </span>
                    ${api.prefix ? `<span class="setting-tag">📝 Prefix: ${api.prefix}</span>` : ''}
                    ${api.suffix ? `<span class="setting-tag">📝 Suffix: ${api.suffix}</span>` : ''}
                    ${api.encode ? `<span class="setting-tag">🔐 Encoded</span>` : ''}
                    ${api.removeDuplicate ? `<span class="setting-tag">🔄 No Duplicate</span>` : ''}
                    ${api.customFields ? `<span class="setting-tag">📋 Custom Fields</span>` : ''}
                </div>
            </div>
            <div class="api-card-footer">
                <div class="api-link">
                    <span class="label">API Link:</span>
                    <code>${window.location.origin}/api/${api.id}/all</code>
                </div>
                <div class="api-meta">
                    <span class="setting-tag">
                        📅 ${new Date(api.createdAt).toLocaleDateString('vi-VN')}
                    </span>
                    <span class="setting-tag">
                        ⏱️ ${api.ttl || 60000}ms
                    </span>
                </div>
            </div>
        </div>
    `).join('');
}

// Create new API
form.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const submitBtn = this.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang tạo...';
    submitBtn.disabled = true;

    try {
        const formData = new FormData(this);
        const data = Object.fromEntries(formData.entries());
        
        // Handle private mode
        const privateMode = document.querySelector('input[name="privateMode"]:checked');
        data.privateMode = privateMode ? privateMode.value === 'true' : false;
        
        // Parse whitelist IPs
        if (data.whitelistIPs) {
            data.whitelistIPs = data.whitelistIPs.split('\n').filter(ip => ip.trim());
        } else {
            data.whitelistIPs = [];
        }
        
        // Parse encode JSON
        if (data.encode) {
            try {
                data.encode = JSON.parse(data.encode);
            } catch (e) {
                data.encode = null;
            }
        }
        
        // Parse customFields
        if (data.customFields) {
            data.customFields = data.customFields.split(',').map(f => f.trim()).filter(f => f);
        } else {
            data.customFields = null;
        }
        
        // Parse webhookCustom
        if (data.webhookCustom) {
            try {
                data.webhookCustom = JSON.parse(data.webhookCustom);
            } catch (e) {
                data.webhookCustom = null;
            }
        }
        
        // Convert numbers
        data.ttl = parseInt(data.ttl) || 60000;
        data.maxJobsPerBoss = parseInt(data.maxJobsPerBoss) || 0;
        data.maxTotalJobs = parseInt(data.maxTotalJobs) || 0;
        data.removeDuplicate = document.getElementById('removeDuplicate').checked;

        const response = await API.createApi(data);

        if (response.success) {
            // Show success modal
            document.getElementById('newApiId').textContent = response.data.id;
            document.getElementById('newApiKey').textContent = response.data.apiKey;
            document.getElementById('newApiLink').textContent = response.data.link;
            
            document.getElementById('apiKeyModal').style.display = 'flex';
            
            form.reset();
            viewIPGroup.style.display = 'none';
            whitelistGroup.style.display = 'none';
            
            await loadUserApis();
        } else {
            alert('Lỗi: ' + (response.error || 'Không thể tạo API'));
        }
    } catch (error) {
        console.error('Create API error:', error);
        alert('Đã xảy ra lỗi khi tạo API: ' + error.message);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
});

// Copy API key
function copyApiKey() {
    const keyElement = document.getElementById('newApiKey');
    copyText(keyElement.textContent);
}

// Copy text to clipboard
function copyText(text) {
    if (!text) return;
    
    navigator.clipboard.writeText(text).then(() => {
        showToast('Đã copy vào clipboard!');
    }).catch(() => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('Đã copy vào clipboard!');
    });
}

// Show toast notification
function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <i class="fas fa-check-circle"></i>
        <span>${message}</span>
    `;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
}

// Close modal
function closeModal() {
    document.getElementById('apiKeyModal').style.display = 'none';
}

// Delete API
async function deleteApi(id) {
    if (!confirm('Bạn có chắc chắn muốn xóa API này?')) return;
    
    try {
        const response = await API.deleteApi(id);
        if (response.success) {
            showToast('Đã xóa API thành công!');
            await loadUserApis();
        } else {
            alert('Không thể xóa API: ' + (response.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Delete API error:', error);
        alert('Đã xảy ra lỗi khi xóa API');
    }
}

// Toggle API status
async function toggleApi(id) {
    try {
        const response = await API.toggleApi(id);
        if (response.success) {
            showToast(response.message || 'Đã thay đổi trạng thái API!');
            await loadUserApis();
        } else {
            alert('Không thể thay đổi trạng thái API');
        }
    } catch (error) {
        console.error('Toggle API error:', error);
        alert('Đã xảy ra lỗi khi thay đổi trạng thái API');
    }
}

// Close modal on click outside
document
