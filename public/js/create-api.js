// ============================================
// ============ WEBHOOK FUNCTIONS ============
// ============================================

// Detect webhook type
function detectWebhookType(url) {
    if (!url) return null;
    
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('discord.com') || lowerUrl.includes('discordapp.com')) {
        return 'discord';
    }
    if (lowerUrl.includes('slack.com')) {
        return 'slack';
    }
    if (lowerUrl.includes('telegram.org') || lowerUrl.includes('telegram.com')) {
        return 'telegram';
    }
    return 'custom';
}

// Show webhook preview
function showWebhookPreview(url) {
    const previewEl = document.getElementById('webhookPreview');
    if (!previewEl) return;
    
    if (url && url.trim()) {
        try {
            // Add https:// if missing
            let fullUrl = url.trim();
            if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
                fullUrl = 'https://' + fullUrl;
            }
            
            const parsed = new URL(fullUrl);
            const domain = parsed.hostname;
            const type = detectWebhookType(fullUrl);
            
            const typeLabels = {
                discord: 'Discord',
                slack: 'Slack',
                telegram: 'Telegram',
                custom: 'Custom'
            };
            
            const typeIcons = {
                discord: 'fab fa-discord',
                slack: 'fab fa-slack',
                telegram: 'fab fa-telegram',
                custom: 'fas fa-link'
            };
            
            previewEl.innerHTML = `
                <i class="${typeIcons[type] || 'fas fa-link'}"></i>
                Webhook: <span class="highlight">${typeLabels[type] || 'Custom'}</span>
                <span style="color:#6b6b80;margin:0 6px;">•</span>
                Domain: <span class="highlight">${domain}</span>
            `;
            previewEl.classList.add('show');
        } catch (e) {
            previewEl.classList.remove('show');
        }
    } else {
        previewEl.classList.remove('show');
    }
}

// Test Webhook
async function testWebhook() {
    const webhookInput = document.getElementById('webhook');
    const statusEl = document.getElementById('webhookStatus');
    let url = webhookInput.value.trim();
    
    if (!url) {
        statusEl.className = 'webhook-status error';
        statusEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Vui lòng nhập Webhook URL';
        return;
    }
    
    // Add https:// if missing
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    
    // Validate URL
    try {
        new URL(url);
    } catch (e) {
        statusEl.className = 'webhook-status error';
        statusEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> URL không hợp lệ';
        return;
    }
    
    // Show loading
    statusEl.className = 'webhook-status loading';
    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Đang kiểm tra...';
    
    try {
        const testData = {
            content: '🔔 Webhook test from NOTI API Server',
            embeds: [{
                title: '✅ Webhook Test Successful',
                color: 65280,
                fields: [
                    { name: 'Status', value: 'Connected', inline: true },
                    { name: 'Time', value: new Date().toISOString(), inline: true }
                ],
                timestamp: new Date().toISOString()
            }]
        };
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testData),
            signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
            statusEl.className = 'webhook-status success';
            statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Webhook hoạt động tốt! ✅';
            
            // Show success animation
            const wrapper = webhookInput.closest('.floating-input-wrapper');
            if (wrapper) {
                wrapper.classList.add('webhook-valid');
                setTimeout(() => {
                    wrapper.classList.remove('webhook-valid');
                }, 3000);
            }
        } else {
            statusEl.className = 'webhook-status error';
            statusEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> Lỗi ${response.status}: ${response.statusText}`;
            
            const wrapper = webhookInput.closest('.floating-input-wrapper');
            if (wrapper) {
                wrapper.classList.add('webhook-invalid');
                setTimeout(() => {
                    wrapper.classList.remove('webhook-invalid');
                }, 3000);
            }
        }
    } catch (error) {
        statusEl.className = 'webhook-status error';
        if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
            statusEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Timeout - Webhook không phản hồi';
        } else {
            statusEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${error.message}`;
        }
        
        const wrapper = webhookInput.closest('.floating-input-wrapper');
        if (wrapper) {
            wrapper.classList.add('webhook-invalid');
            setTimeout(() => {
                wrapper.classList.remove('webhook-invalid');
            }, 3000);
        }
    }
}

// ============================================
// ============ INIT WEBHOOK EVENTS ===========
// ============================================

// Add webhook event listeners when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    const webhookInput = document.getElementById('webhook');
    const statusEl = document.getElementById('webhookStatus');
    
    if (webhookInput) {
        // Real-time preview
        webhookInput.addEventListener('input', function() {
            const url = this.value.trim();
            showWebhookPreview(url);
            
            // Reset status
            if (statusEl) {
                statusEl.className = 'webhook-status';
                statusEl.innerHTML = '';
            }
        });
        
        // Auto-detect on blur
        webhookInput.addEventListener('blur', function() {
            const url = this.value.trim();
            if (url) {
                let fullUrl = url;
                if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://')) {
                    fullUrl = 'https://' + fullUrl;
                }
                const type = detectWebhookType(fullUrl);
                if (type && statusEl) {
                    const typeLabels = {
                        discord: 'Discord',
                        slack: 'Slack',
                        telegram: 'Telegram',
                        custom: 'Custom Webhook'
                    };
                    statusEl.className = 'webhook-status success';
                    statusEl.innerHTML = `<i class="fas fa-check-circle"></i> ${typeLabels[type] || 'Webhook'} detected`;
                }
            }
        });
    }
});

// Export webhook functions
window.testWebhook = testWebhook;
window.detectWebhookType = detectWebhookType;
window.showWebhookPreview = showWebhookPreview;
