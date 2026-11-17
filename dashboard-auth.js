(function (root) {
    async function request(config, path, options = {}, token = '') {
        let url;
        try { url = new URL(config.url); } catch { throw new Error('URL Supabase belum dikonfigurasi atau tidak valid.'); }
        if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('URL Supabase harus berupa alamat HTTPS proyek.');
        if (!config.key) throw new Error('Anon Key belum dikonfigurasi.');
        const response = await fetch(`${url.origin}${path}`, {
            ...options, cache: 'no-store', credentials: 'omit',
            headers: { apikey: config.key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
        });
        const body = await response.text();
        let data = null;
        try { data = body ? JSON.parse(body) : null; } catch { throw new Error('Respons server tidak valid.'); }
        if (!response.ok) throw new Error(response.status === 401 || response.status === 400 ? 'Akses ditolak atau sesi berakhir.' : `Server menolak permintaan (${response.status}).`);
        return data;
    }
    async function verifySession(config, data) {
        if (!data?.access_token || !data.refresh_token || !data.expires_in) throw new Error('Sesi masuk tidak valid.');
        const role = await request(config, '/rest/v1/rpc/dashboard_access_role', { method: 'POST', body: '{}' }, data.access_token);
        if (!['viewer', 'admin'].includes(role)) throw new Error('Akun ini tidak memiliki akses dashboard.');
        return { token: data.access_token, refreshToken: data.refresh_token, role, expiresAt: Date.now() + data.expires_in * 1000 };
    }
    async function login(config, email, password) {
        if (!email || !password) throw new Error('Email dan password diperlukan.');
        const data = await request(config, '/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
        return verifySession(config, data);
    }
    async function cloud(config, session, endpoint, options = {}, prefix = '/rest/v1/') {
        if (!session) throw new Error('Sesi berakhir. Silakan masuk kembali.');
        if (Date.now() >= session.expiresAt - 30000) {
            if (!session.refreshTask) {
                session.refreshTask = (async () => {
                    const data = await request(config, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refreshToken }) });
                    Object.assign(session, await verifySession(config, data));
                })().finally(() => { session.refreshTask = null; });
            }
            await session.refreshTask;
        }
        if (options.method && options.method !== 'GET' && session.role !== 'admin') throw new Error('Hanya pengelola yang dapat mengirim data.');
        return request(config, `${prefix}${endpoint}`, options, session.token);
    }
    async function publish(config, session, payload) {
        if (session?.role !== 'admin') throw new Error('Hanya pengelola yang dapat menerbitkan.');
        return cloud(config, session, 'publish-dashboard', { method: 'POST', body: JSON.stringify(payload) }, '/functions/v1/');
    }
    root.EklaimDashboardAuth = { login, cloud, publish };
})(globalThis);
