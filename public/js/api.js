// API Client
const API = {
    baseURL: window.location.origin,
    
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };
        
        try {
            const response = await fetch(url, config);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || data.message || 'API request failed');
            }
            
            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },
    
    // Get stats
    async getStats() {
        return this.request('/api/stats');
    },
    
    // Get dashboard data
    async getDashboard() {
        return this.request('/api/dashboard');
    },
    
    // Get notifications with filters
    async getNotifications(params = {}) {
        const query = new URLSearchParams(params).toString();
        const endpoint = `/api/notifications${query ? '?' + query : ''}`;
        return this.request(endpoint);
    },
    
    // Get all APIs
    async getMyApis() {
        return this.request('/api/my');
    },
    
    // Create API
    async createApi(data) {
        // Remove empty values
        Object.keys(data).forEach(key => {
            if (data[key] === '' || data[key] === null || data[key] === undefined) {
                delete data[key];
            }
        });
        
        return this.request('/api/create', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },
    
    // Delete API
    async deleteApi(id) {
        return this.request(`/api/${id}`, {
            method: 'DELETE'
        });
    },
    
    // Toggle API
    async toggleApi(id) {
        return this.request(`/api/${id}/toggle`, {
            method: 'POST'
        });
    },
    
    // Clear all data
    async clearAll() {
        return this.request('/api/clear', {
            method: 'DELETE'
        });
    }
};
