(function (root) {
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const iterations = 600000;
    const encode = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    const decode = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
    async function key(password, salt) {
        const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    async function encrypt(snapshot, password) {
        if (password.length < 16) throw new Error('Password pembaca harus minimal 16 karakter.');
        const plain = enc.encode(JSON.stringify(snapshot));
        if (plain.length > 500000) throw new Error('Snapshot terlalu besar untuk diterbitkan; data lama tetap aman.');
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(password, salt), plain);
        return { v: 1, salt: encode(salt), iv: encode(iv), data: encode(new Uint8Array(data)) };
    }
    async function decrypt(snapshot, password) {
        try {
            if (!snapshot || snapshot.v !== 1 || typeof snapshot.salt !== 'string' || typeof snapshot.iv !== 'string' || typeof snapshot.data !== 'string' || snapshot.data.length > 700000) throw new Error();
            const salt = decode(snapshot.salt), iv = decode(snapshot.iv), data = decode(snapshot.data);
            if (salt.length !== 16 || iv.length !== 12 || data.length < 16) throw new Error();
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(password, salt), data);
            const result = JSON.parse(dec.decode(plain));
            if (!Array.isArray(result.records) || typeof result.updatedAt !== 'string' || !Number.isFinite(Date.parse(result.updatedAt)) || result.records.some(record => !record || typeof record.sep !== 'string')) throw new Error();
            return result;
        } catch { throw new Error('Password pembaca salah atau data dashboard rusak.'); }
    }
    function merge(previous, updates, updatedAt) {
        const records = new Map(previous.map(record => [record.sep, record]));
        updates.forEach(record => records.set(record.sep, record));
        return { updatedAt, records: [...records.values()] };
    }
    root.EklaimSnapshot = { encrypt, decrypt, merge };
})(globalThis);
