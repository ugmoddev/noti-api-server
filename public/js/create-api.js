// Create API Script
// Xử lý tạo và quản lý API với authentication

// ============ Check Authentication ============
function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return false;
    }
    return true;
}

// ============ Update Navigation ============
function updateNav() {
    const token = localStorage.getItem('token');
    const username = localStorage.getItem('username');
    const loginBtn = document.getElementById('navLogin');
    const logoutBtn = document.getElementById('navLogout');
    const usernameDisplay = document.getElementById('usernameDisplay');
    const userBadge = document.getElementById('userBadge');
    
    if (token && username) {
        loginBtn.style.display = 'none';
        logoutBtn.style.display = 'inline';
        usernameDisplay.textContent = username;
        if (userBadge) userBadge.style.display = 'inline-flex';
    } else {
        loginBtn.style.display = 'inline';
        logoutBtn.style.display = 'none';
        usernameDisplay.textContent = 'Guest';
        if (userBadge) userBadge.style.display = 'none';
    }
}

// ============ Logout ============
async function logout() {
    try {
        await API.logout();
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        localStorage.removeItem('token');
        localStorage.removeItem('username');
        window.location.href = '/login.html';
    }
}

// ============ DOM Elements ============
const form = document.getElementById('createApiForm');
const apiList = document.getElementById('apiList');
const privateRadios = document.querySelectorAll('input[name="privateMode"]');
const privateOptions = document.getElementById('privateOptions');
const apiLimitInfo = document.getElementById('apiLimitInfo');
const submitBtn = document.getElementById('submitBtn');

// ============ Toggle Private Options ============
privateRadios.forEach(radio => {
    radio.addEventListener('change', function() {
        privateOptions.style.display = this.value === 'true' ? 'block' : 'none';
    });
});

// ============ Load User's APIs ============
async function loadUserApis() {
    if (!checkAuth()) return;
    
    try {
        const response = await API.getMyApis();
        if (response.success) {
            renderApiList(response.data || []);
            document.getElementById('apiCount').textContent = response.data?.length || 0;
            
            // Update limit info
            const total = response.data?.length || 0;
            const maxAllowed = response.maxAllowed || 1;
            const remaining = response.remaining || 0;
            
            if (apiLimitInfo) {
                let statusIcon = '✅';
                let statusText = '';
                if (remaining > 0) {
                    statusIcon = '✅';
                    statusText = `còn ${remaining} lượt`;
                } else {
                    statusIcon = '🚫';
                    statusText = 'đã đạt giới hạn';
                }
                
                apiLimitInfo.innerHTML = `
                    <i class="fas fa-info-circle"></i>
                    <span>
                        Bạn đã tạo <strong>${total}/${maxAllowed}</strong> API 
                        <span style="color: ${remaining > 0 ? '#22c55e' : '#ef4444'}">
                            (${statusText})
                        </span>
                    </span>
                `;
            }
            
            // Disable form if limit reached
            if (submitBtn) {
                if (remaining <= 0) {
                    submitBtn.disabled = true;
                    submitBtn.innerHTML = '<i class="fas fa-ban"></i> Đã đạt giới hạn API';
                    submitBtn.style.opacity = '0.5';
                    submitBtn.style.cursor = 'not-allowed';
                } else {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fas fa-plus"></i> Tạo API';
                    submitBtn.style.opacity = '1';
                    submitBtn.style.cursor = 'pointer';
                }
            }
        }
    } catch (error) {
        console.error('Failed to load APIs:', error);
        if (apiList) {
            apiList.innerHTML = `
                <div class="error-message">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>Không thể tải danh sách API</p>
                    <small>${error.message || 'Vui lòng thử lại sau'}</small>
                </div>
            `;
        }
    }
}

// ============ Render API List ============
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
                    <button onclick="editApi('${api.id}')" class="btn-icon" title="Chỉnh sửa">
                        <i class="fas fa-edit"></i>
                    </button>
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
                    <div class="info-item">
                        <span class="label">API Key:</span>
                        <code class="api-key">${api.apiKey || '****'}</code>
                        <button onclick="copyText('${api.apiKey || ''}')" class="btn-icon small" title="Copy API Key">
                            <i class="fas fa-copy"></i>
                        </button>
                    </div>
                    <div class="info-item">
                        <span class="label">Chủ sở hữu:</span>
                        <span>${api.owner || 'unknown'}</span>
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
                    <div class="stat-box">
                        <span class="stat-number">${api.ttl || 60000}</span>
                        <span class="stat-label">TTL (ms)</span>
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
                    <button onclick="copyText('${window.location.origin}/api/${api.id}/all')" class="btn-icon small" title="Copy Link">
                        <i class="fas fa-copy"></i>
                    </button>
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

// ============ Create New API ============
form.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    if (!checkAuth()) return;
    
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

        // Remove empty values
        Object.keys(data).forEach(key => {
            if (data[key] === '' || data[key] === null || data[key] === undefined) {
                delete data[key];
            }
        });

        const response = await API.createApi(data);

        if (response.success) {
            // Show success modal
            document.getElementById('newApiId').textContent = response.data.id;
            document.getElementById('newApiKey').textContent = response.data.apiKey;
            document.getElementById('newApiLink').textContent = response.data.link;
            
            document.getElementById('apiKeyModal').style.display = 'flex';
            
            // Reset form
            form.reset();
            privateOptions.style.display = 'none';
            
            // Reload API list
            await loadUserApis();
            
            // Show toast
            showToast('✅ Tạo API thành công!');
        } else {
            if (response.error === 'API limit reached') {
                showToast('🚫 ' + response.message, 'warning');
            } else {
                alert('Lỗi: ' + (response.error || 'Không thể tạo API'));
            }
        }
    } catch (error) {
        console.error('Create API error:', error);
        alert('Đã xảy ra lỗi khi tạo API: ' + error.message);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
});

// ============ Edit API ============
async function editApi(id) {
    if (!checkAuth()) return;
    
    try {
        const response = await API.getApi(id);
        if (!response.success) {
            alert('Không thể tải thông tin API');
            return;
        }
        
        const api = response.data;
        
        // Populate form with API data
        document.getElementById('apiName').value = api.name;
        document.getElementById('displayName').value = api.displayName || '';
        document.getElementById('webhook').value = api.webhook || '';
        document.getElementById('webhookCustom').value = api.webhookCustom ? JSON.stringify(api.webhookCustom, null, 2) : '';
        document.getElementById('prefix').value = api.prefix || '';
        document.getElementById('suffix').value = api.suffix || '';
        document.getElementById('encode').value = api.encode ? JSON.stringify(api.encode) : '';
        document.getElementById('maxJobsPerBoss').value = api.maxJobsPerBoss || 0;
        document.getElementById('maxTotalJobs').value = api.maxTotalJobs || 0;
        document.getElementById('jobSort').value = api.jobSort || 'desc';
        document.getElementById('customFields').value = api.customFields ? api.customFields.join(', ') : '';
        document.getElementById('ttl').value = api.ttl || 60000;
        document.getElementById('removeDuplicate').checked = api.removeDuplicate || false;
        
        // Set private mode
        const privateRadio = document.querySelector(`input[name="privateMode"][value="${api.privateMode}"]`);
        if (privateRadio) {
            privateRadio.checked = true;
            privateOptions.style.display = api.privateMode ? 'block' : 'none';
        }
        
        // Set whitelist IPs
        if (api.whitelistIPs && api.whitelistIPs.length > 0) {
            document.getElementById('whitelistIPs').value = api.whitelistIPs.join('\n');
        }
        
        // Set view IP
        if (api.viewIP) {
            document.getElementById('viewIP').value = api.viewIP;
        }
        
        // Change submit button
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.innerHTML = '<i class="fas fa-save"></i> Cập nhật API';
        submitBtn.dataset.editId = id;
        
        // Scroll to form
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        showToast('📝 Đang chỉnh sửa API: ' + api.name);
        
    } catch (error) {
        console.error('Edit API error:', error);
        alert('Không thể tải thông tin API: ' + error.message);
    }
}

// ============ Update API ============
form.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const editId = this.querySelector('button[type="submit"]').dataset.editId;
    if (editId) {
        await updateApi(editId);
        return;
    }
});

async function updateApi(id) {
    if (!checkAuth()) return;
    
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang cập nhật...';
    submitBtn.disabled = true;

    try {
        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());
        
        data.id = id;
        
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

        // Remove empty values
        Object.keys(data).forEach(key => {
            if (data[key] === '' || data[key] === null || data[key] === undefined) {
                delete data[key];
            }
        });

        const response = await API.updateApi(data);

        if (response.success) {
            showToast('✅ Cập nhật API thành công!');
            
            // Reset form
            form.reset();
            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.innerHTML = '<i class="fas fa-plus"></i> Tạo API';
            delete submitBtn.dataset.editId;
            privateOptions.style.display = 'none';
            
            await loadUserApis();
        } else {
            alert('Lỗi: ' + (response.error || 'Không thể cập nhật API'));
        }
    } catch (error) {
        console.error('Update API error:', error);
        alert('Đã xảy ra lỗi khi cập nhật API: ' + error.message);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

// ============ Delete API ============
async function deleteApi(id) {
    if (!checkAuth()) return;
    
    if (!confirm('⚠️ Bạn có chắc chắn muốn xóa API này?\nHành động này không thể hoàn tác!')) {
        return;
    }
    
    try {
        const response = await API.deleteApi(id);
        if (response.success) {
            showToast('🗑️ Đã xóa API thành công!');
            await loadUserApis();
        } else {
            alert('Không thể xóa API: ' + (response.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Delete API error:', error);
        alert('Đã xảy ra lỗi khi xóa API: ' + error.message);
    }
}

// ============ Toggle API Status ============
async function toggleApi(id) {
    if (!checkAuth()) return;
    
    try {
        const response = await API.toggleApi(id);
        if (response.success) {
            const status = response.data?.enabled ? 'bật' : 'tắt';
            showToast(`🔄 Đã ${status} API!`);
            await loadUserApis();
        } else {
            alert('Không thể thay đổi trạng thái API');
        }
    } catch (error) {
        console.error('Toggle API error:', error);
        alert('Đã xảy ra lỗi khi thay đổi trạng thái API: ' + error.message);
    }
}

// ============ Copy Functions ============
function copyApiKey() {
    const keyElement = document.getElementById('newApiKey');
    copyText(keyElement.textContent);
}

function copyText(text) {
    if (!text) {
        showToast('⚠️ Không có gì để copy');
        return;
    }
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('📋 Đã copy vào clipboard!');
        }).catch(() => {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    
    try {
        document.execCommand('copy');
        showToast('📋 Đã copy vào clipboard!');
    } catch (err) {
        showToast('⚠️ Không thể copy. Vui lòng copy thủ công');
    } finally {
        document.body.removeChild(textarea);
    }
}

// ============ Toast Notification ============
function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) {
        existing.remove();
    }
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: 'fas fa-check-circle',
        error: 'fas fa-exclamation-circle',
        warning: 'fas fa-exclamation-triangle',
        info: 'fas fa-info-circle'
    };
    
    toast.innerHTML = `
        <i class="${icons[type] || icons.success}"></i>
        <span>${message}</span>
    `;
    
    document.body.appendChild(toast);
    
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    }, 3000);
}

// ============ Modal Controls ============
function closeModal() {
    document.getElementById('apiKeyModal').style.display = 'none';
}

// Close modal on click outside
document.getElementById('apiKeyModal').addEventListener('click', function(e) {
    if (e.target === this) {
        closeModal();
    }
});

// Close modal on ESC key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeModal();
    }
});

// ============ Init ============
document.addEventListener('DOMContentLoaded', function() {
    updateNav();
    if (checkAuth()) {
        loadUserApis();
    }
});

// ============ Export for global use ============
window.editApi = editApi;
window.deleteApi = deleteApi;
window.toggleApi = toggleApi;
window.copyApiKey = copyApiKey;
window.copyText = copyText;
window.closeModal = closeModal;
window.showToast = showToast;
window.logout = logout;
