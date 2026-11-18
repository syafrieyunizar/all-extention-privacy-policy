(function (root) {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const iterations = 600000;
    const encode = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    const decode = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
    async function key(password, salt, extractable = false) {
        const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
    }
    async function encrypt(snapshot, password) {
        if (password.length < 8) throw new Error('Password pembaca harus minimal 8 karakter.');
        const plain = enc.encode(JSON.stringify(snapshot));
        if (plain.length > 500000) throw new Error('Snapshot terlalu besar untuk diterbitkan; data lama tetap aman.');
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(password, salt), plain);
        return { v: 1, salt: encode(salt), iv: encode(iv), data: encode(new Uint8Array(data)) };
    }
    function publishPassword(current, next, confirmation) {
        if (!next && !confirmation) return current;
        if (next.length < 8) throw new Error('Password baru harus minimal 8 karakter.');
        if (next !== confirmation) throw new Error('Konfirmasi password baru tidak cocok.');
        return next;
    }
    async function decryptWithKey(snapshot, keyValue) {
        try {
            if (!snapshot || snapshot.v !== 1 || typeof snapshot.salt !== 'string' || typeof snapshot.iv !== 'string' || typeof snapshot.data !== 'string' || snapshot.data.length > 700000) throw new Error();
            const salt = decode(snapshot.salt), iv = decode(snapshot.iv), data = decode(snapshot.data);
            if (salt.length !== 16 || iv.length !== 12 || data.length < 16) throw new Error();
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keyValue, data);
            const result = JSON.parse(dec.decode(plain));
            if (!Array.isArray(result.records) || typeof result.updatedAt !== 'string' || !Number.isFinite(Date.parse(result.updatedAt)) || result.records.some(record => !record || typeof record.sep !== 'string')) throw new Error();
            return result;
        } catch { throw new Error('Password pembaca salah atau data dashboard rusak.'); }
    }
    async function decrypt(snapshot, password) {
        try { return await decryptWithKey(snapshot, await key(password, decode(snapshot.salt))); }
        catch { throw new Error('Password pembaca salah atau data dashboard rusak.'); }
    }
    async function unlockSession(snapshot, password) {
        try {
            const derived = await key(password, decode(snapshot.salt), true);
            const result = await decryptWithKey(snapshot, derived);
            return { result, session: { salt: snapshot.salt, key: encode(new Uint8Array(await crypto.subtle.exportKey('raw', derived))) } };
        } catch { throw new Error('Password pembaca salah atau data dashboard rusak.'); }
    }
    async function restoreSession(snapshot, saved) {
        if (!saved || saved.salt !== snapshot?.salt || typeof saved.key !== 'string') throw new Error('Sesi berakhir. Masukkan password kembali.');
        try {
            const raw = decode(saved.key);
            if (raw.length !== 32) throw new Error();
            return await decryptWithKey(snapshot, await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']));
        } catch { throw new Error('Sesi berakhir. Masukkan password kembali.'); }
    }
    function monthCode(month) {
        const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month || '');
        if (!match) throw new Error('Pilih bulan yang valid.');
        return `${match[2]}${match[1]}`;
    }
    function fileMonth(path) {
        const match = /(?:^|\/)dashboard-(0[1-9]|1[0-2])(\d{4})\.html$/.exec(path || '');
        return match ? `${match[2]}-${match[1]}` : null;
    }
    function validateMonth(snapshot, month) {
        monthCode(month);
        if (snapshot.month !== month || !Array.isArray(snapshot.records) || snapshot.records.some(record => !record || typeof record.tglPulang !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.tglPulang) || !record.tglPulang.startsWith(`${month}-`))) {
            throw new Error('Snapshot tidak sesuai dengan bulan yang dipilih.');
        }
        return snapshot;
    }
    function merge(previous, updates, updatedAt, month) {
        validateMonth({ month, records: [...previous, ...updates] }, month);
        const records = new Map(previous.map(record => [record.sep, record]));
        updates.forEach(record => records.set(record.sep, record));
        return { month, updatedAt, records: [...records.values()] };
    }
    root.EklaimSnapshot = { encrypt, decrypt, merge, monthCode, fileMonth, validateMonth, publishPassword, unlockSession, restoreSession };
})(globalThis);

