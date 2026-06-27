// Dashboard Script
let currentPage = 1;
const pageSize = 20;
let seaChart = null;
let bossChart = null;

// Load dashboard data
async function loadDashboard() {
    try {
        // Load stats
        const stats = await API.getStats();
        if (stats.success) {
            const data = stats.data.stats;
            document.getElementById('totalNotifications').textContent = data.totalNotifications || 0;
            document.getElementById('activeServers').textContent = data.activeServers || 0;
            document.getElementById('uniqueBosses').textContent = data.uniqueBosses || 0;
            
            if (data.lastUpdate) {
                const date = new Date(data.lastUpdate);
                document.getElementById('lastUpdate').textContent = date.toLocaleString('vi-VN');
            }
        }
        
        // Load dashboard data
        const dashboard = await API.getDashboard();
        if (dashboard.success) {
            const data = dashboard.data;
            updateSeaChart(data.distribution.bySea);
            updateBossChart(data.distribution.topBosses);
            updateRecentNotifications(data.recent);
        }
        
        // Load all notifications
        await loadNotifications();
        
    } catch (error) {
        console.error('Failed to load dashboard:', error);
        showError('Không thể tải dữ liệu. Vui lòng thử lại!');
    }
}

// Update Sea chart
function updateSeaChart(seaData) {
    const ctx = document.getElementById('seaChart').getContext('2d');
    
    if (seaChart) {
        seaChart.destroy();
    }
    
    seaChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Sea 1', 'Sea 2', 'Sea 3'],
            datasets: [{
                data: [seaData['Sea 1'] || 0, seaData['Sea 2'] || 0, seaData['Sea 3'] || 0],
                backgroundColor: ['#6366f1', '#8b5cf6', '#a78bfa'],
                borderColor: ['#4f46e5', '#7c3aed', '#8b5cf6'],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    labels: {
                        color: '#e0e0e0'
                    }
                }
            }
        }
    });
}

// Update Boss chart
function updateBossChart(bossData) {
    const ctx = document.getElementById('bossChart').getContext('2d');
    
    if (bossChart) {
        bossChart.destroy();
    }
    
    const labels = bossData.map(b => b.name);
    const data = bossData.map(b => b.count);
    const colors = ['#6366f1', '#8b5cf6', '#a78bfa', '#7c3aed', '#6d28d9', 
                    '#5b21b6', '#4c1d95', '#7e22ce', '#581c87', '#3b0764'];
    
    bossChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Số lần xuất hiện',
                data: data,
                backgroundColor: colors.slice(0, data.length),
                borderColor: colors.slice(0, data.length).map(c => c),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#a0a0b0'
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    }
                },
                x: {
                    ticks: {
                        color: '#a0a0b0',
                        maxRotation: 45,
                        minRotation: 30
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// Update recent notifications
function updateRecentNotifications(notifications) {
    const tbody = document.getElementById('recentNotifications');
    
    if (!notifications || notifications.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-text">Chưa có thông báo nào</td></tr>';
        return;
    }
    
    tbody.innerHTML = notifications.map(n => `
        <tr>
            <td><strong>${n.boss}</strong></td>
            <td>Sea ${n.sea}</td>
            <td>${n.players}</td>
            <td><code>${n.job.substring(0, 12)}...</code></td>
            <td>${n.timeAgo}</td>
        </tr>
    `).join('');
}

// Load all notifications with filters
async function loadNotifications() {
    try {
        const sea = document.getElementById('seaFilter').value;
        const boss = document.getElementById('bossFilter').value;
        
        const params = {
            limit: pageSize,
            offset: (currentPage - 1) * pageSize
        };
        
        if (sea) params.sea = sea;
        if (boss) params.boss = boss;
        
        const response = await API.getNotifications(params);
        
        if (response.success) {
            const data = response.data || [];
            updateAllNotificationsTable(data);
            updatePagination(response.pagination);
        }
    } catch (error) {
        console.error('Failed to load notifications:', error);
        showError('Không thể tải danh sách thông báo');
    }
}

// Update all notifications table
function updateAllNotificationsTable(notifications) {
    const tbody = document.getElementById('allNotifications');
    
    if (!notifications || notifications.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-text">Không có thông báo nào</td></tr>';
        return;
    }
    
    tbody.innerHTML = notifications.map((n, index) => `
        <tr>
            <td>${(currentPage - 1) * pageSize + index + 1}</td>
            <td><strong>${n.boss}</strong></td>
            <td>Sea ${n.sea}</td>
            <td>${n.players}</td>
            <td><code title="${n.job}">${n.job.substring(0, 12)}...</code></td>
            <td>${new Date(n.timestamp).toLocaleString('vi-VN')}</td>
        </tr>
    `).join('');
}

// Update pagination
function updatePagination(pagination) {
    if (!pagination) return;
    
    const total = pagination.total || 0;
    const limit = pagination.limit || pageSize;
    const offset = pagination.offset || 0;
    const currentPage = Math.floor(offset / limit) + 1;
    const totalPages = Math.ceil(total / limit);
    
    document.getElementById('pageInfo').textContent = `Trang ${currentPage}/${totalPages || 1}`;
    document.getElementById('paginationInfo').textContent = 
        `Hiển thị ${offset + 1}-${Math.min(offset + limit, total)} trên tổng ${total} thông báo`;
}

// Pagination controls
function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        loadNotifications();
    }
}

function nextPage() {
    currentPage++;
    loadNotifications();
}

// Refresh data
async function refreshData() {
    const btn = document.querySelector('.dashboard-actions .btn-primary');
    btn.textContent = '⏳ Đang tải...';
    btn.disabled = true;
    
    await loadDashboard();
    
    btn.textContent = '🔄 Refresh';
    btn.disabled = false;
}

// Clear data
async function clearData() {
    if (!confirm('Bạn có chắc chắn muốn xóa tất cả dữ liệu?')) {
        return;
    }
    
    try {
        const response = await API.clearAll();
        if (response.success) {
            alert('Đã xóa thành công!');
            await loadDashboard();
        }
    } catch (error) {
        console.error('Failed to clear data:', error);
        alert('Không thể xóa dữ liệu. Vui lòng thử lại!');
    }
}

// Show error
function showError(message) {
    console.error(message);
    // You can implement a toast notification here
}

// Auto-refresh every 30 seconds
setInterval(() => {
    loadDashboard();
}, 30000);

// Load dashboard on page load
document.addEventListener('DOMContentLoaded', loadDashboard);