// API Client
const API = {
    baseURL: window.location.origin,
    
    // Get auth token
    getToken() {
        return localStorage.getItem('token');
    },
    
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const token = this.getToken();
        
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        };
        
        // Add auth token if available
        if (token) {
            config.headers['Authorization'] = token;
        }
        
        try {
            const response = await fetch(url, config);
            const data = await response.json();
            
            if (!response.ok) {
                // Handle unauthorized
                if (response.status === 401) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('username');
                    window.location.href = '/login.html';
                    throw new Error('Session expired. Please login again.');
                }
                throw new Error(data.error || data.message || 'API request failed');
            }
            
            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },
    
    // Auth endpoints
    async login(username, password) {
        return this.request('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    },
    
    async register(username, password) {
        return this.request('/api/register', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    },
    
    async logout() {
        return this.request('/api/logout', {
            method: 'POST'
        });
    },
    
    async getMe() {
        return this.request('/api/me');
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
    
    // Get single API
    async getApi(id) {
        return this.request(`/api/${id}`);
    },
    
    // Create API
    async createApi(data) {
        return this.request('/api/create', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },
    
    // Update API
    async updateApi(data) {
        return this.request('/api/update', {
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
