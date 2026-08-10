// Shared API utilities
const API_BASE = '/api';

function getToken() {
  return localStorage.getItem('pos_token');
}

function getUser() {
  const data = localStorage.getItem('pos_user');
  return data ? JSON.parse(data) : null;
}

function logout() {
  localStorage.removeItem('pos_token');
  localStorage.removeItem('pos_user');
  window.location.href = '/';
}

async function api(endpoint, options = {}) {
  const token = getToken();
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...options
  };

  const res = await fetch(`${API_BASE}${endpoint}`, config);

  if (res.status === 401) {
    logout();
    throw new Error('Sesión expirada');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error del servidor' }));
    throw new Error(err.error || 'Error del servidor');
  }

  // Check if response is JSON
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return res.json();
  }
  return res;
}

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Protect pages
function requireAuth(requiredRole) {
  const user = getUser();
  const token = getToken();
  if (!user || !token) {
    window.location.href = '/';
    return null;
  }
  if (requiredRole && user.role !== requiredRole) {
    window.location.href = user.role === 'admin' ? '/admin' : '/vendedor';
    return null;
  }
  return user;
}
