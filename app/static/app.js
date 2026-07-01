// photonne-tools — frontend vanilla JS v0.2

const API = '';

let currentEventSource = null;
let currentRunId = null;
let jobsRefreshTimer = null;   // auto-refresh del panel de jobs
let runCommands = {};          // run_id -> comando exacto (para el modal de log)

// File browser state
let browserTargetInput = null;   // qué input estamos rellenando
let browserCurrentPath = null;   // path que estamos viendo actualmente

// ============================================================
// Tabs
// ============================================================

function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelector(`[data-tab="${name}"]`).classList.add('active');
    document.getElementById(`tab-${name}`).classList.add('active');

    // Auto-refresh sólo mientras la pestaña Jobs está activa, para reflejar
    // transiciones running → success/failed y el indicador en vivo.
    clearInterval(jobsRefreshTimer);
    jobsRefreshTimer = null;

    if (name === 'jobs') {
        loadJobs();
        jobsRefreshTimer = setInterval(loadJobs, 4000);
    }
    if (name === 'runs') loadRuns();
}

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// ============================================================
// Toast
// ============================================================

function toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    setTimeout(() => el.classList.remove('show'), 3500);
}

// ============================================================
// API helpers
// ============================================================

async function apiGet(path) {
    const r = await fetch(API + path);
    if (!r.ok) {
        const t = await r.text();
        let msg = t;
        try { msg = JSON.parse(t).detail || t; } catch {}
        throw new Error(msg);
    }
    return r.json();
}

async function apiPost(path, body) {
    const r = await fetch(API + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
        const text = await r.text();
        let msg = text;
        try { msg = JSON.parse(text).detail || text; } catch {}
        throw new Error(msg);
    }
    return r.json();
}

async function apiDelete(path) {
    const r = await fetch(API + path, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
}

// ============================================================
// File Browser
// ============================================================

function openBrowser(inputName) {
    browserTargetInput = document.querySelector(`[name="${inputName}"]`);
    if (!browserTargetInput) return;

    document.getElementById('browser-modal').classList.remove('hidden');

    // Estado inicial del checkbox de trailing slash
    const currentVal = browserTargetInput.value;
    document.getElementById('browser-trailing-slash').checked =
        currentVal.endsWith('/') || currentVal === '';

    // Cargar directorio inicial: si el input tiene un path, ir ahí; si no, mostrar raíces
    const initialPath = extractDirectory(currentVal);
    if (initialPath) {
        loadBrowserPath(initialPath).catch(() => loadRoots());
    } else {
        loadRoots();
    }
}

function extractDirectory(pathStr) {
    if (!pathStr) return null;
    // Si acaba en / probablemente ya es un directorio
    if (pathStr.endsWith('/')) return pathStr.slice(0, -1);
    return pathStr;
}

function closeBrowser() {
    document.getElementById('browser-modal').classList.add('hidden');
    browserTargetInput = null;
    browserCurrentPath = null;
    document.getElementById('browser-selected-path').textContent = '(nada)';
}

async function loadRoots() {
    try {
        const data = await apiGet('/api/roots');
        browserCurrentPath = null;
        renderBrowserRoots(data.roots);
        document.getElementById('browser-current-path').textContent = 'directorios raíz permitidos';
        document.getElementById('browser-selected-path').textContent = '(elige una raíz)';
    } catch (e) {
        renderBrowserError(e.message);
    }
}

async function loadBrowserPath(path) {
    try {
        const data = await apiGet('/api/files?path=' + encodeURIComponent(path));
        browserCurrentPath = data.path;
        renderBrowserListing(data);
    } catch (e) {
        renderBrowserError(e.message);
    }
}

function renderBrowserRoots(roots) {
    const list = document.getElementById('browser-list');
    if (roots.length === 0) {
        list.innerHTML = '<li class="browser-empty">No hay raíces configuradas.</li>';
        return;
    }
    list.innerHTML = roots.map(r => {
        if (!r.exists) {
            return `
                <li class="browser-item file">
                    <span class="browser-icon">✕</span>
                    <span class="browser-name">${escapeHtml(r.path)}</span>
                    <span class="browser-size">No existe</span>
                </li>
            `;
        }
        return `
            <li class="browser-item" onclick="loadBrowserPath('${escapeAttr(r.path)}')">
                <span class="browser-icon">▸</span>
                <span class="browser-name">${escapeHtml(r.path)}</span>
            </li>
        `;
    }).join('');
}

function renderBrowserListing(data) {
    const list = document.getElementById('browser-list');
    document.getElementById('browser-current-path').textContent = data.path;
    updateSelectedPath();

    let html = '';

    // "Volver": si hay parent y es allowed, o hay "up to roots"
    if (data.parent) {
        html += `
            <li class="browser-item parent" onclick="loadBrowserPath('${escapeAttr(data.parent)}')">
                <span class="browser-icon">↑</span>
                <span class="browser-name">.. (volver)</span>
            </li>
        `;
    } else {
        html += `
            <li class="browser-item parent" onclick="loadRoots()">
                <span class="browser-icon">↑</span>
                <span class="browser-name">.. (raíces)</span>
            </li>
        `;
    }

    if (data.entries.length === 0) {
        html += '<li class="browser-empty">(Directorio vacío)</li>';
    } else {
        html += data.entries.map(e => {
            if (e.is_dir) {
                return `
                    <li class="browser-item" onclick="loadBrowserPath('${escapeAttr(e.path)}')">
                        <span class="browser-icon">▸</span>
                        <span class="browser-name">${escapeHtml(e.name)}</span>
                    </li>
                `;
            } else {
                return `
                    <li class="browser-item file">
                        <span class="browser-icon">·</span>
                        <span class="browser-name">${escapeHtml(e.name)}</span>
                        <span class="browser-size">${formatSize(e.size)}</span>
                    </li>
                `;
            }
        }).join('');
    }

    list.innerHTML = html;
}

function renderBrowserError(msg) {
    document.getElementById('browser-list').innerHTML =
        `<li class="browser-error">${escapeHtml(msg)}</li>`;
}

function updateSelectedPath() {
    if (!browserCurrentPath) return;
    const wantSlash = document.getElementById('browser-trailing-slash').checked;
    const path = wantSlash ? browserCurrentPath.replace(/\/+$/, '') + '/' : browserCurrentPath;
    document.getElementById('browser-selected-path').textContent = path;
}

document.getElementById('browser-trailing-slash').addEventListener('change', updateSelectedPath);

function selectCurrentPath() {
    if (!browserCurrentPath || !browserTargetInput) return;
    const wantSlash = document.getElementById('browser-trailing-slash').checked;
    const finalPath = wantSlash
        ? browserCurrentPath.replace(/\/+$/, '') + '/'
        : browserCurrentPath;
    browserTargetInput.value = finalPath;
    browserTargetInput.dispatchEvent(new Event('input', { bubbles: true }));
    closeBrowser();
    toast('path seleccionado', 'success');
}

// ============================================================
// Jobs
// ============================================================

async function loadJobs() {
    try {
        const jobs = await apiGet('/api/jobs');
        const container = document.getElementById('jobs-list');
        const empty = document.getElementById('jobs-empty');

        if (jobs.length === 0) {
            container.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');
        container.innerHTML = jobs.map(job => {
            const isRunning = job.last_status === 'running';
            const meta = isRunning
                ? `<span class="job-running"><span class="dot-live"></span>Ejecutándose…</span>`
                : `${job.last_run ? `Última run: ${formatDate(job.last_run)}` : 'Sin ejecuciones'}` +
                  `${job.last_status ? ` · <span class="status-badge status-${job.last_status}">${job.last_status}</span>` : ''}`;
            const runningBtn = (isRunning && job.last_run_id)
                ? `<button class="btn-primary" onclick="openLog('${job.last_run_id}', '${escapeAttr(job.name)}', true)">Ver progreso</button>`
                : `<button class="btn-primary" onclick="runJob('${job.id}', '${escapeAttr(job.name)}')">Ejecutar</button>`;
            return `
            <div class="job-card">
                <div class="job-card-head">
                    <div class="job-name">${escapeHtml(job.name)}</div>
                    <span class="tool-badge">${job.tool}</span>
                </div>
                <div class="job-meta">${meta}</div>
                <div class="job-actions">
                    ${runningBtn}
                    <button class="btn-secondary" onclick="showJobConfig('${job.id}', '${escapeAttr(job.name)}')">Ver config</button>
                    <button class="btn-secondary" onclick="viewRuns('${job.id}')">Historial</button>
                    <button class="btn-secondary" onclick="deleteJob('${job.id}', '${escapeAttr(job.name)}')">Eliminar</button>
                </div>
            </div>
        `;
        }).join('');
    } catch (e) {
        toast('Error cargando jobs: ' + e.message, 'error');
    }
}

async function deleteJob(jobId, name) {
    if (!confirm(`¿Eliminar job "${name}"? Esto también borra el histórico de runs.`)) return;
    try {
        await apiDelete('/api/jobs/' + jobId);
        toast('Job eliminado', 'success');
        loadJobs();
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

async function runJob(jobId, name) {
    try {
        const result = await apiPost(`/api/jobs/${jobId}/run`);
        toast(`Run lanzada: ${result.run_id.slice(0, 8)}…`, 'success');
        openLog(result.run_id, name, true, result.command);
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

async function viewRuns(jobId) {
    try {
        const runs = await apiGet(`/api/runs?job_id=${jobId}`);
        if (runs.length === 0) {
            toast('Sin ejecuciones todavía', '');
            return;
        }
        openLog(runs[0].id, 'Log', runs[0].status === 'running', runs[0].command);
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

// ============================================================
// Ver config de un job
// ============================================================

const CONFIG_LABELS = {
    source: 'Origen',
    destination: 'Destino',
    flags: 'Flags',
    dry_run: 'Dry-run',
    delete: '--delete',
    target: 'Directorio objetivo',
    mode: 'Modo',
    custom_args: 'Argumentos',
    recursive: 'Recursivo',
};

function configRow(label, value) {
    let val = value;
    if (typeof value === 'boolean') val = value ? 'sí' : 'no';
    if (val === '' || val == null) val = '—';
    return `
        <div class="config-row">
            <span class="config-key">${escapeHtml(label)}</span>
            <span class="config-val">${escapeHtml(String(val))}</span>
        </div>
    `;
}

async function showJobConfig(jobId, name) {
    try {
        const job = await apiGet('/api/jobs/' + jobId);
        document.getElementById('config-title').textContent = `Config · ${name}`;
        const cfg = job.config || {};
        let rows = configRow('Herramienta', job.tool);
        for (const [key, val] of Object.entries(cfg)) {
            rows += configRow(CONFIG_LABELS[key] || key, val);
        }
        document.getElementById('config-body').innerHTML = rows;
        document.getElementById('config-modal').classList.remove('hidden');
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

function closeConfig() {
    document.getElementById('config-modal').classList.add('hidden');
}

// ============================================================
// New job form
// ============================================================

const toolSelect = document.getElementById('tool-select');
toolSelect.addEventListener('change', () => {
    document.getElementById('fields-rsync').classList.toggle('hidden', toolSelect.value !== 'rsync');
    document.getElementById('fields-exiftool').classList.toggle('hidden', toolSelect.value !== 'exiftool');
});

const exifModeSelect = document.querySelector('[name="exif_mode"]');
exifModeSelect.addEventListener('change', () => {
    document.getElementById('exif-custom-row').classList.toggle('hidden', exifModeSelect.value !== 'custom');
});

document.getElementById('new-job-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const tool = f.tool.value;

    let config;
    if (tool === 'rsync') {
        config = {
            source: f.rsync_source.value.trim(),
            destination: f.rsync_destination.value.trim(),
            flags: f.rsync_flags.value.trim() || '-av',
            dry_run: f.rsync_dry_run.checked,
            delete: f.rsync_delete.checked,
        };
    } else if (tool === 'exiftool') {
        config = {
            target: f.exif_target.value.trim(),
            mode: f.exif_mode.value,
            custom_args: f.exif_custom_args.value.trim(),
            recursive: f.exif_recursive.checked,
            dry_run: f.exif_dry_run.checked,
        };
    }

    try {
        await apiPost('/api/jobs', {
            name: f.name.value.trim(),
            tool: tool,
            config: config,
        });
        toast('Job creado', 'success');
        f.reset();
        switchTab('jobs');
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
});

// ============================================================
// Runs
// ============================================================

async function loadRuns() {
    try {
        const runs = await apiGet('/api/runs?limit=50');
        const container = document.getElementById('runs-list');
        if (runs.length === 0) {
            container.innerHTML = '<div class="empty"><p>Aún no hay runs.</p></div>';
            return;
        }
        // Guardamos el comando por run para pasárselo al modal sin meterlo en el
        // atributo onclick (evita romper el HTML con comillas en los paths).
        runCommands = {};
        runs.forEach(run => { runCommands[run.id] = run.command || ''; });

        container.innerHTML = runs.map(run => `
            <div class="run-row" onclick="openLog('${run.id}', 'Run ${run.id.slice(0, 8)}', ${run.status === 'running'}, runCommands['${run.id}'])">
                <div class="run-info">
                    <div class="run-time">${formatDate(run.started_at)}</div>
                    <div class="run-id">${run.id.slice(0, 8)}… · job ${run.job_id.slice(0, 8)}…</div>
                </div>
                <span class="status-badge status-${run.status}">${run.status}</span>
            </div>
        `).join('');
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

// ============================================================
// Log viewer
// ============================================================

async function openLog(runId, title, isLive, command) {
    currentRunId = runId;
    document.getElementById('log-title').textContent = title;
    document.getElementById('log-content').textContent = '';
    document.getElementById('log-modal').classList.remove('hidden');

    // Comando exacto ejecutado (para saber qué ha copiado).
    const cmdEl = document.getElementById('log-command');
    if (command) {
        cmdEl.textContent = '$ ' + command;
        cmdEl.classList.remove('hidden');
    } else {
        cmdEl.classList.add('hidden');
    }

    // Barra de progreso: visible sólo en runs en vivo.
    resetProgress();
    document.getElementById('log-progress').classList.toggle('hidden', !isLive);
    if (isLive) setProgress(null);  // indeterminada hasta el primer %

    const stopBtn = document.getElementById('log-stop-btn');
    stopBtn.classList.toggle('hidden', !isLive);
    stopBtn.onclick = () => stopRun(runId);

    if (isLive) {
        streamLog(runId);
    } else {
        try {
            const result = await apiGet(`/api/runs/${runId}/log`);
            document.getElementById('log-content').textContent = result.content;
            const pre = document.getElementById('log-content');
            pre.scrollTop = pre.scrollHeight;
        } catch (e) {
            document.getElementById('log-content').textContent = 'Error cargando log: ' + e.message;
        }
    }
}

function streamLog(runId) {
    if (currentEventSource) currentEventSource.close();
    const pre = document.getElementById('log-content');
    currentEventSource = new EventSource(`/api/runs/${runId}/stream`);

    currentEventSource.onmessage = (e) => {
        pre.textContent += e.data + '\n';
        pre.scrollTop = pre.scrollHeight;
        updateProgressFromLine(e.data);
        if (e.data.includes('[FINALIZADO]')) {
            currentEventSource.close();
            currentEventSource = null;
            document.getElementById('log-stop-btn').classList.add('hidden');
            finishProgress();
        }
    };

    currentEventSource.onerror = () => {
        currentEventSource?.close();
        currentEventSource = null;
    };
}

// ============================================================
// Barra de progreso
// ============================================================

function resetProgress() {
    const fill = document.getElementById('log-progress-fill');
    fill.style.width = '0%';
    fill.classList.remove('indeterminate');
    document.getElementById('log-progress-label').textContent = '';
}

// pct = null → barra indeterminada (spinner); número 0-100 → barra fija.
function setProgress(pct) {
    const fill = document.getElementById('log-progress-fill');
    const label = document.getElementById('log-progress-label');
    if (pct == null) {
        fill.classList.add('indeterminate');
        fill.style.width = '35%';
        label.textContent = '…';
    } else {
        fill.classList.remove('indeterminate');
        const clamped = Math.max(0, Math.min(100, pct));
        fill.style.width = clamped + '%';
        label.textContent = Math.round(clamped) + '%';
    }
}

function finishProgress() {
    setProgress(100);
}

function updateProgressFromLine(line) {
    // exiftool -progress: "======== /path [3/50]"
    const counter = line.match(/\[(\d+)\/(\d+)\]/);
    if (counter) {
        const done = parseInt(counter[1], 10);
        const total = parseInt(counter[2], 10);
        if (total > 0) setProgress((done / total) * 100);
        return;
    }
    // rsync --info=progress2: línea con "  1,234,567  45%  1.2MB/s ..."
    const pct = line.match(/\b(\d{1,3})%/);
    if (pct) {
        setProgress(parseInt(pct[1], 10));
    }
}

async function stopRun(runId) {
    if (!confirm('¿Detener este run?')) return;
    try {
        await apiPost(`/api/runs/${runId}/stop`);
        toast('Run detenida', '');
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

function closeLog() {
    document.getElementById('log-modal').classList.add('hidden');
    if (currentEventSource) {
        currentEventSource.close();
        currentEventSource = null;
    }
    resetProgress();
    currentRunId = null;
}

// ============================================================
// Utils
// ============================================================

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
    return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' K';
    if (bytes < 1024 ** 3) return (bytes / 1024 ** 2).toFixed(1) + ' M';
    return (bytes / 1024 ** 3).toFixed(2) + ' G';
}

// ============================================================
// Init
// ============================================================

// La pestaña Jobs está activa por defecto: arranca la carga y el auto-refresh.
loadJobs();
jobsRefreshTimer = setInterval(loadJobs, 4000);

// Cerrar modales con Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (!document.getElementById('browser-modal').classList.contains('hidden')) {
            closeBrowser();
        } else if (!document.getElementById('config-modal').classList.contains('hidden')) {
            closeConfig();
        } else if (!document.getElementById('log-modal').classList.contains('hidden')) {
            closeLog();
        }
    }
});
