(() => {
    const $ = id => document.getElementById(id);
    const core = EklaimDashboard;
    const month = $('month');
    const source = $('source');
    const message = $('message');
    const isExtension = typeof chrome !== 'undefined' && !!chrome.storage?.local;
    let config = { ...EKLAIM_DASHBOARD_CONFIG };
    let session = null;
    let publishedAt = null;
    let records = [];
    let undated = false;
    let renderTimer;
    let loadVersion = 0;

    const today = new Date();
    month.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    function notify(text, error = false) {
        message.textContent = text;
        message.classList.toggle('error', error);
    }

    function cell(row, value) {
        const td = document.createElement('td');
        td.textContent = value || '—';
        row.appendChild(td);
        return td;
    }

    function dateLabel(value) {
        if (!value) return '—';
        const [year, monthNumber, day] = value.split('-').map(Number);
        return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, monthNumber - 1, day)));
    }

    function percent(part, total) { return total ? Math.round(part * 100 / total) : 0; }

    function chosenRecords() {
        if (!undated && !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month.value)) return [];
        return records.filter(record => undated ? !record.tglPulang : record.tglPulang?.startsWith(month.value));
    }

    function showDetails(title, list) {
        $('details-title').textContent = title;
        const body = $('details-body');
        body.replaceChildren();
        list.forEach(record => {
            const item = document.createElement('div');
            item.className = 'detail-item';
            const name = document.createElement('strong');
            name.textContent = record.nama || 'Nama belum tersedia';
            const id = document.createElement('small');
            id.textContent = `SEP ${record.sep} · RM ${record.rm || '—'} · Pulang ${dateLabel(record.tglPulang)}`;
            const note = document.createElement('p');
            note.textContent = core.noteText(record.note);
            item.append(name, id, note);
            body.appendChild(item);
        });
        $('details-dialog').showModal();
    }

    function detailButton(label, list, title) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'link-button';
        button.textContent = label;
        button.title = list.map(record => `${record.nama || record.sep}: ${core.noteText(record.note)}`).join('\n');
        button.addEventListener('click', () => showDetails(title, list));
        return button;
    }

    function badge(label, type) {
        const span = document.createElement('span');
        span.className = `status ${type}`;
        span.textContent = label;
        return span;
    }

    function resumeStatus(record) {
        if (source.value !== 'local') {
            const status = record.status === 'sudah' ? ['Sudah', 'done'] : record.status === 'belum' ? ['Belum', 'missing'] : ['Belum diperiksa', 'pending'];
            return badge(...status);
        }
        const select = document.createElement('select');
        select.className = 'status-select';
        select.setAttribute('aria-label', `Status resume ${record.nama || record.sep}`);
        [['pending', 'Belum diperiksa'], ['sudah', 'Sudah'], ['belum', 'Belum']].forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            select.appendChild(option);
        });
        select.value = ['sudah', 'belum'].includes(record.status) ? record.status : 'pending';
        select.addEventListener('change', async () => {
            select.disabled = true;
            try {
                await sendMessage({ action: 'dashboardCapture', record: { sep: record.sep, status: select.value } });
                notify('Status resume dashboard tersimpan di perangkat ini.');
            } catch (error) {
                select.value = record.status || 'pending';
                notify(`Status gagal disimpan: ${error.message}`, true);
                select.disabled = false;
            }
        });
        return select;
    }

    function renderDate(row, record, field) {
        const td = cell(row, dateLabel(record[field]));
        if (!record[field] && source.value === 'local') {
            const input = document.createElement('input');
            input.type = 'date';
            input.setAttribute('aria-label', `${field === 'tglMasuk' ? 'Tanggal masuk' : 'Tanggal pulang'} untuk ${record.nama || record.sep}`);
            input.addEventListener('change', async () => {
                if (!input.value) return;
                input.disabled = true;
                try {
                    await sendMessage({ action: 'dashboardCapture', record: { sep: record.sep, [field]: input.value } });
                    notify('Tanggal tersimpan di perangkat ini.');
                } catch (error) {
                    notify(`Tanggal gagal disimpan: ${error.message}`, true);
                    input.disabled = false;
                }
            });
            td.textContent = '';
            td.className = 'date-edit';
            td.appendChild(input);
        }
    }

    function render() {
        const chosen = chosenRecords();
        const groups = core.summarize(chosen);
        const done = groups.reduce((sum, item) => sum + item.done, 0);
        const complete = groups.reduce((sum, item) => sum + item.complete, 0);
        const incomplete = groups.reduce((sum, item) => sum + item.incomplete, 0);
        $('total').textContent = chosen.length;
        $('done').replaceChildren(document.createTextNode(String(done)), Object.assign(document.createElement('small'), { textContent: ` / ${chosen.length}` }));
        $('complete').replaceChildren(document.createTextNode(String(complete)), Object.assign(document.createElement('small'), { textContent: ` / ${done}` }));
        $('done-percent').textContent = `${percent(done, chosen.length)}% dari seluruh pasien`;
        $('incomplete').textContent = incomplete;
        $('doctor-count').textContent = `${groups.length} dokter`;
        $('undated-count').textContent = records.filter(record => !record.tglPulang).length;
        $('undated').setAttribute('aria-pressed', String(undated));
        $('undated').firstChild.textContent = undated ? 'Kembali ke bulan ' : 'Tanggal belum tersedia ';
        $('publish').textContent = undated ? 'Kirim tanpa tanggal' : 'Kirim ke Supabase';
        $('publish').hidden = source.value !== 'local';
        $('source-caption').textContent = source.value === 'local'
            ? 'Data tersimpan di perangkat. Pengiriman dan penerbitan hanya dilakukan saat Anda menekan tombol kirim.'
            : 'Snapshot terakhir yang diterbitkan pengelola; tidak diperbarui otomatis.';
        $('last-published').textContent = publishedAt ? `Terakhir diperbarui: ${new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(publishedAt))}` : '';

        const doctorBody = $('doctors');
        doctorBody.replaceChildren();
        groups.forEach(group => {
            const row = document.createElement('tr');
            cell(row, group.doctor);
            const progressCell = cell(row, '');
            progressCell.className = 'progress-cell';
            const heading = document.createElement('div');
            heading.className = 'progress-heading';
            const fraction = document.createElement('strong');
            fraction.textContent = `${group.done} / ${group.total}`;
            const value = document.createElement('span');
            value.textContent = `${percent(group.done, group.total)}%`;
            heading.append(fraction, value);
            const progress = document.createElement('div');
            progress.className = 'progress';
            progress.setAttribute('role', 'progressbar');
            progress.setAttribute('aria-label', `Penyelesaian resume ${group.doctor}`);
            progress.setAttribute('aria-valuemin', '0');
            progress.setAttribute('aria-valuemax', '100');
            progress.setAttribute('aria-valuenow', String(percent(group.done, group.total)));
            const bar = document.createElement('span');
            bar.style.width = `${percent(group.done, group.total)}%`;
            progress.appendChild(bar);
            progressCell.replaceChildren(heading, progress);
            cell(row, `${group.complete} / ${group.done}`);
            const incompleteCell = cell(row, '');
            const details = chosen.filter(record => (core.doctorKey(record.dpjp) || core.doctorKey('DPJP belum tersedia')) === core.doctorKey(group.doctor) && record.status === 'sudah' && core.noteText(record.note));
            if (details.length) incompleteCell.replaceChildren(detailButton(`${group.incomplete} / ${group.done}`, details, `Berkas perlu dilengkapi · ${group.doctor}`));
            else incompleteCell.textContent = `0 / ${group.done}`;
            doctorBody.appendChild(row);
        });
        $('doctors-empty').hidden = groups.length > 0;

        const query = $('search').value.trim().toLocaleLowerCase('id');
        const filtered = chosen.filter(record => [record.nama, record.sep, record.rm, record.dpjp, record.ruangan].some(value => String(value || '').toLocaleLowerCase('id').includes(query)));
        filtered.sort((a, b) => (a.tglPulang || '').localeCompare(b.tglPulang || '') || String(a.nama || '').localeCompare(String(b.nama || ''), 'id') || a.sep.localeCompare(b.sep));
        const body = $('patients');
        body.replaceChildren();
        filtered.forEach(record => {
            const row = document.createElement('tr');
            renderDate(row, record, 'tglMasuk');
            renderDate(row, record, 'tglPulang');
            cell(row, record.sep); cell(row, record.nama); cell(row, record.rm); cell(row, record.ruangan); cell(row, record.dpjp);
            const statusCell = cell(row, '');
            statusCell.replaceChildren(resumeStatus(record));
            const noteCell = cell(row, '');
            if (core.noteText(record.note)) noteCell.replaceChildren(detailButton('Lihat catatan', [record], `Catatan · ${record.nama || record.sep}`));
            else noteCell.replaceChildren(badge(record.status === 'sudah' ? 'Lengkap' : 'Menunggu resume', record.status === 'sudah' ? 'complete' : 'pending'));
            body.appendChild(row);
        });
        $('patients-empty').hidden = filtered.length > 0;
        const otherMonths = source.value === 'local' && !undated
            ? records.filter(record => record.tglPulang && !record.tglPulang.startsWith(month.value)).length : 0;
        $('patients-empty').textContent = query
            ? 'Tidak ada pasien yang cocok dengan pencarian.'
            : otherMonths && !chosen.length
                ? `Tidak ada pasien di bulan ini. Ada ${otherMonths} pasien pada bulan lain; pilih bulan tanggal pulangnya.`
                : 'Belum ada pasien pada tampilan ini. Buka resume di e-RM untuk menambah data.';
    }

    function sendMessage(payload) {
        return new Promise((resolve, reject) => chrome.runtime.sendMessage(payload, response => {
            const error = chrome.runtime.lastError?.message || response?.error;
            if (error) reject(new Error(error)); else resolve(response);
        }));
    }

    async function load(silent = false) {
        const version = ++loadVersion;
        const currentSource = source.value;
        $('refresh').disabled = true;
        try {
            let loaded;
            if (currentSource === 'local') {
                if (!isExtension || session?.role !== 'admin') throw new Error('Data perangkat hanya tersedia bagi pengelola.');
                const items = await chrome.storage.local.get(null);
                loaded = Object.entries(items)
                    .filter(([key, value]) => /^eklaim_dashboard_\d{4}R\d{7}V\d{6}$/.test(key) && value?.sep)
                    .map(([, record]) => core.resolve(record, items));
            } else {
                loaded = records;
            }
            if (version !== loadVersion) return;
            records = loaded;
            if (silent !== true) notify('');
            render();
        } catch (error) {
            if (version !== loadVersion) return;
            records = [];
            render();
            notify(`Gagal memuat data: ${error.message}`, true);
        } finally {
            if (version === loadVersion) $('refresh').disabled = false;
        }
    }

    $('publish').addEventListener('click', () => {
        if (session?.role !== 'admin') { notify('Hanya pengelola yang dapat mengirim data.', true); return; }
        if (!chosenRecords().length) { notify('Tidak ada data dalam periode ini untuk dikirim.'); return; }
        $('publish-error').textContent = '';
        $('publish-password').value = '';
        $('publish-dialog').showModal();
    });
    $('publish-form').addEventListener('submit', async event => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button[type="submit"]');
        button.disabled = true;
        $('publish-error').textContent = '';
        try {
            const password = $('publish-password').value;
            const current = await EklaimDashboardAuth.publish(config, session, { action: 'read' });
            const previous = current.snapshot ? await EklaimSnapshot.decrypt(current.snapshot, password) : { records: [] };
            const fields = ['sep', 'rm', 'nama', 'ruangan', 'dpjp', 'tglMasuk', 'tglPulang', 'status', 'note'];
            const selected = chosenRecords().map(record => Object.fromEntries(fields.map(field => [field, record[field] || ''])));
            const snapshot = EklaimSnapshot.merge(previous.records, selected, new Date().toISOString());
            const encrypted = await EklaimSnapshot.encrypt(snapshot, password);
            await EklaimDashboardAuth.publish(config, session, { action: 'write', sha: current.sha, snapshot: encrypted });
            publishedAt = snapshot.updatedAt;
            $('publish-dialog').close();
            render();
            notify(`${selected.length} pasien diterbitkan. Dashboard publik akan menampilkan snapshot setelah GitHub Pages selesai memperbarui halaman.`);
        } catch (error) { $('publish-error').textContent = `Gagal menerbitkan: ${error.message}`; }
        finally { $('publish-password').value = ''; button.disabled = false; }
    });

    month.addEventListener('change', () => { undated = false; render(); });
    source.addEventListener('change', () => { undated = false; load(); });
    $('search').addEventListener('input', render);
    $('undated').addEventListener('click', () => { undated = !undated; render(); });
    $('refresh').addEventListener('click', load);
    document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));

    $('login-form').addEventListener('submit', async event => {
        event.preventDefault();
        const button = event.currentTarget.querySelector('button[type="submit"]');
        button.disabled = true;
        $('login-error').textContent = '';
        try {
            if (isExtension) {
                session = await EklaimDashboardAuth.login(config, $('login-email').value.trim(), $('login-password').value);
                if (session.role !== 'admin') { session = null; throw new Error('Akun ini bukan pengelola dashboard.'); }
                source.value = 'local';
            } else {
                const response = await fetch('dashboard-snapshot.json', { cache: 'no-store', credentials: 'omit' });
                if (!response.ok) throw new Error(response.status === 404 ? 'Dashboard belum diterbitkan.' : 'Snapshot dashboard tidak dapat dimuat.');
                const snapshot = await EklaimSnapshot.decrypt(await response.json(), $('login-password').value);
                records = snapshot.records;
                publishedAt = snapshot.updatedAt;
                source.value = 'shared';
            }
            $('dashboard-shell').hidden = false;
            $('login-screen').hidden = true;
            await load();
        } catch (error) { $('login-error').textContent = error.message; }
        finally { $('login-password').value = ''; button.disabled = false; }
    });
    $('logout').addEventListener('click', () => {
        session = null; records = []; publishedAt = null; loadVersion++; render();
        $('dashboard-shell').hidden = true; $('login-screen').hidden = false;
    });

    $('open-settings').addEventListener('click', async () => {
        const settings = await chrome.storage.local.get(['eklaim_supabase_url', 'eklaim_supabase_key', 'eklaim_user_identity', 'eklaim_encryption_password', 'eklaim_dashboard_admin_email']);
        $('settings-url').value = settings.eklaim_supabase_url || '';
        $('settings-key').value = settings.eklaim_supabase_key || '';
        $('settings-user').value = settings.eklaim_user_identity || '';
        $('settings-password').value = settings.eklaim_encryption_password || '';
        $('settings-admin-email').value = settings.eklaim_dashboard_admin_email || ''; 
        $('settings-error').textContent = '';
        $('settings-dialog').showModal();
    });
    $('settings-form').addEventListener('submit', async event => {
        event.preventDefault();
        const url = $('settings-url').value.trim().replace(/\/$/, '');
        const key = $('settings-key').value.trim();
        try {
            if (!!url !== !!key) throw new Error('Isi URL dan Anon Key, atau kosongkan keduanya.');
            if (url) {
                const parsed = new URL(url);
                if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error('URL Supabase harus berupa alamat HTTPS proyek.');
                const origins = [`${parsed.origin}/*`];
                if (!await chrome.permissions.contains({ origins }) && !await chrome.permissions.request({ origins })) throw new Error('Izin akses alamat Supabase belum diberikan.');
            }
            await chrome.storage.local.set({
                eklaim_supabase_url: url, eklaim_supabase_key: key,
                eklaim_user_identity: $('settings-user').value.trim() || 'Anonim',
                eklaim_encryption_password: $('settings-password').value,
                eklaim_dashboard_admin_email: $('settings-admin-email').value.trim()
            });
            config = { url, key };
            $('login-email').value = $('settings-admin-email').value.trim();
            $('settings-dialog').close();
            notify('Pengaturan berhasil disimpan.');
        } catch (error) { $('settings-error').textContent = error.message; }
    });

    if (isExtension) chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || source.value !== 'local') return;
        if (!Object.keys(changes).some(key => /^eklaim_(dashboard_|sepdata_|sepmap_|note_)/.test(key))) return;
        clearTimeout(renderTimer);
        renderTimer = setTimeout(() => load(true), 150);
    });
    if (isExtension) {
        $('login-email-label').hidden = false;
        $('login-email').required = true;
        $('login-form').appendChild($('open-settings'));
        chrome.storage.local.get(['eklaim_supabase_url', 'eklaim_supabase_key', 'eklaim_dashboard_admin_email']).then(settings => {
            config = { url: settings.eklaim_supabase_url || '', key: settings.eklaim_supabase_key || '' };
            $('login-email').value = settings.eklaim_dashboard_admin_email || '';
        });
    } else {
        $('open-settings').hidden = true;
        $('refresh').hidden = true;
        $('publish').hidden = true;
    }
})();
