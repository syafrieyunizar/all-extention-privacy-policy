(function (root) {
    const months = {
        jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2,
        mar: 3, maret: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5,
        jun: 6, juni: 6, june: 6, jul: 7, juli: 7, july: 7,
        agt: 8, agu: 8, agust: 8, agustus: 8, aug: 8, august: 8,
        sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, oct: 10, october: 10,
        nov: 11, november: 11, des: 12, desember: 12, dec: 12, december: 12
    };

    function date(value) {
        const text = String(value || '').trim().toLowerCase();
        let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        let year, month, day;
        if (match) {
            [, year, month, day] = match;
        } else {
            match = text.match(/^(\d{1,2})[\s/.-]+([a-z]+|\d{1,2})[\s/.-]+(\d{4})/);
            if (!match) return '';
            day = match[1];
            month = months[match[2]] || Number(match[2]);
            year = match[3];
        }
        year = Number(year); month = Number(month); day = Number(day);
        const check = new Date(Date.UTC(year, month - 1, day));
        if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return '';
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }

    function noteText(value) {
        const raw = String(value || '').trim();
        const body = raw.replace(/\[(REVISI|READMISI|TIDAK LAYAK)\]\s*/gi, '').trim();
        if (body) return body;
        if (/\[TIDAK LAYAK\]/i.test(raw)) return 'SEP tidak layak';
        if (/\[READMISI\]/i.test(raw)) return 'Kasus readmisi';
        if (/\[REVISI\]/i.test(raw)) return 'Perlu revisi casemix';
        return '';
    }

    function doctorKey(value) {
        return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id');
    }

    function resolve(record, items) {
        const sep = record.sep;
        const source = items[`eklaim_dashboard_meta_${sep}`] || {};
        const map = items[`eklaim_sepmap_${sep}`] || {};
        const rm = String(source.rm || record.rm || map.rm || '').replace(/\D/g, '').replace(/^0+/, '');
        const sepData = items[`eklaim_sepdata_${sep}_${rm}`] || {};
        const key = `eklaim_note_${sep}`;
        return {
            ...record,
            nama: source.nama || record.nama || map.nama || '',
            rm: source.rm || record.rm || map.rm || '',
            tglMasuk: date(source.tglMasuk) || date(record.tglMasuk) || date(map.tglMasuk),
            tglPulang: date(source.tglPulang) || date(record.tglPulang) || date(map.tglPulang),
            ruangan: sepData.ruangan || record.ruangan || map.ruangan || '',
            dpjp: sepData.dpjp || record.dpjp || map.dpjp || '',
            note: Object.prototype.hasOwnProperty.call(items, key) ? items[key] : (record.note || '')
        };
    }

    function summarize(records) {
        const groups = new Map();
        records.forEach(record => {
            const doctor = String(record.dpjp || '').trim().replace(/\s+/g, ' ') || 'DPJP belum tersedia';
            const key = doctorKey(doctor);
            const group = groups.get(key) || { doctor, total: 0, done: 0, complete: 0, incomplete: 0 };
            group.total++;
            if (record.status === 'sudah') {
                group.done++;
                if (noteText(record.note)) group.incomplete++;
                else group.complete++;
            }
            groups.set(key, group);
        });
        return [...groups.values()].sort((a, b) => a.doctor.localeCompare(b.doctor, 'id'));
    }

    function patientRows(records, options = {}) {
        const query = String(options.query || '').trim().toLocaleLowerCase('id');
        const doctors = options.doctors || new Set();
        const rooms = options.rooms || new Set();
        const filtered = records.filter(record => {
            const doctor = doctorKey(record.dpjp || 'DPJP belum tersedia');
            const room = doctorKey(record.ruangan || 'Ruangan belum tersedia');
            return (!doctors.size || doctors.has(doctor)) && (!rooms.size || rooms.has(room)) &&
                (!query || [record.nama, record.sep, record.rm, record.dpjp, record.ruangan].some(value => String(value || '').toLocaleLowerCase('id').includes(query)));
        });
        const key = options.sortKey || 'tglPulang';
        const direction = options.sortDirection === 'desc' ? -1 : 1;
        function value(record) {
            if (key === 'status') return record.status === 'sudah' ? 'Sudah' : record.status === 'belum' ? 'Belum' : '';
            if (key === 'completeness') return record.status === 'sudah' ? (noteText(record.note) ? 'Belum lengkap' : 'Lengkap') : '';
            return String(record[key] || '').trim();
        }
        return filtered.sort((a, b) => {
            const av = value(a), bv = value(b);
            if (!av || !bv) return av ? -1 : bv ? 1 : String(a.sep || '').localeCompare(String(b.sep || ''));
            return direction * av.localeCompare(bv, 'id', { numeric: true, sensitivity: 'base' }) || String(a.nama || '').localeCompare(String(b.nama || ''), 'id') || String(a.sep || '').localeCompare(String(b.sep || ''));
        });
    }

    root.EklaimDashboard = { date, noteText, doctorKey, resolve, summarize, patientRows };
})(globalThis);
