(() => {
  'use strict';

  const TASKS_KEY = 'timewise_tasks_v1';
  const SCHEDULE_KEY = 'timewise_schedule_v1';
  const SESSION_KEY = 'timewise_sessions_v1';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const safeParse = (key, fallback) => {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  };

  let tasks = safeParse(TASKS_KEY, []);
  let schedules = safeParse(SCHEDULE_KEY, []);
  let sessions = Number(localStorage.getItem(SESSION_KEY) || 0);
  let editingTaskId = null;
  let toastTimeout = null;
  let timerDuration = 25 * 60;
  let timerRemaining = timerDuration;
  let timerInterval = null;
  let timerRunning = false;
  let timerMode = 'Fokus';
  let timerEndAt = null;

  const priorityLabels = { high: 'Tinggi', medium: 'Sedang', low: 'Rendah' };
  const priorityRanks = { high: 3, medium: 2, low: 1 };
  const categoryColors = { Belajar: 'category-Belajar', Sekolah: 'category-Sekolah', Istirahat: 'category-Istirahat', Pribadi: 'category-Pribadi', Lainnya: 'category-Lainnya' };
  const todayISO = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };
  const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const formatDate = (dateString, options = { day: 'numeric', month: 'short', year: 'numeric' }) => {
    if (!dateString) return 'Tanpa tanggal';
    const date = new Date(`${dateString}T00:00:00`);
    if (Number.isNaN(date.getTime())) return 'Tanggal tidak valid';
    return new Intl.DateTimeFormat('id-ID', options).format(date);
  };
  const saveTasks = () => localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  const saveSchedules = () => localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedules));
  const showToast = message => {
    $('#toastMessage').textContent = message;
    $('#toast').classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => $('#toast').classList.remove('show'), 2600);
  };

  function setHeaderDate() {
    const now = new Date();
    $('#topbarDate').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }).format(now);
    $('#welcomeDate').textContent = `${new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)} · Satu langkah kecil tetaplah sebuah kemajuan.`;
  }

  function navigate(page) {
    const target = document.getElementById(`page-${page}`);
    if (!target) return;
    $$('.page').forEach(element => element.classList.toggle('active-page', element === target));
    $$('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.page === page));
    const activeLabel = $(`.nav-link[data-page="${page}"]`);
    $('#crumbPage').textContent = activeLabel ? activeLabel.textContent.trim().replace(/\s+\d+$/, '') : 'Beranda';
    $('#sidebar').classList.remove('sidebar-open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'tugas') renderTasks();
    if (page === 'jadwal') renderSchedules();
  }

  function taskDeadline(task) {
    const today = todayISO();
    if (task.done) return { label: 'Selesai', className: '' };
    if (task.deadline < today) return { label: `Terlambat · ${formatDate(task.deadline, { day: 'numeric', month: 'short' })}`, className: 'overdue' };
    if (task.deadline === today) return { label: 'Deadline hari ini', className: 'soon' };
    const tomorrow = new Date(`${today}T00:00:00`);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (task.deadline === `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`) return { label: 'Besok', className: 'soon' };
    return { label: formatDate(task.deadline, { day: 'numeric', month: 'short' }), className: '' };
  }

  function taskMarkup(task) {
    const deadline = taskDeadline(task);
    const doneClass = task.done ? ' is-done' : '';
    return `<article class="task-row${doneClass}" data-task-id="${escapeHTML(task.id)}">
      <button class="task-check${task.done ? ' checked' : ''}" data-action="toggle" data-id="${escapeHTML(task.id)}" aria-label="${task.done ? 'Tandai belum selesai' : 'Tandai selesai'}">${task.done ? '✓' : ''}</button>
      <div class="task-main"><span class="task-title">${escapeHTML(task.title)}</span>${task.description ? `<span class="task-description">${escapeHTML(task.description)}</span>` : ''}<div class="task-meta"><span class="priority-pill priority-${escapeHTML(task.priority)}">${priorityLabels[task.priority] || 'Sedang'}</span><span class="deadline-pill ${deadline.className}">◷ ${escapeHTML(deadline.label)}</span></div></div>
      <div class="task-actions"><button class="icon-action" data-action="edit" data-id="${escapeHTML(task.id)}" aria-label="Edit tugas" title="Edit tugas">✎</button><button class="icon-action" data-action="delete" data-id="${escapeHTML(task.id)}" aria-label="Hapus tugas" title="Hapus tugas">×</button></div>
    </article>`;
  }

  function orderedTasks(source = tasks) {
    const sort = $('#sortTasks')?.value || 'deadline';
    const items = [...source];
    if (sort === 'priority') items.sort((a, b) => Number(a.done) - Number(b.done) || priorityRanks[b.priority] - priorityRanks[a.priority] || a.deadline.localeCompare(b.deadline));
    else if (sort === 'newest') items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    else items.sort((a, b) => Number(a.done) - Number(b.done) || a.deadline.localeCompare(b.deadline) || priorityRanks[b.priority] - priorityRanks[a.priority]);
    return items;
  }

  function renderTasks() {
    const search = ($('#taskSearch')?.value || '').trim().toLocaleLowerCase('id-ID');
    const status = $('#filterStatus')?.value || 'all';
    const priority = $('#filterPriority')?.value || 'all';
    const filtered = orderedTasks(tasks.filter(task => {
      const matchesSearch = `${task.title} ${task.description || ''}`.toLocaleLowerCase('id-ID').includes(search);
      const matchesStatus = status === 'all' || (status === 'done' ? task.done : !task.done);
      const matchesPriority = priority === 'all' || task.priority === priority;
      return matchesSearch && matchesStatus && matchesPriority;
    }));
    $('#allTasks').innerHTML = filtered.map(taskMarkup).join('');
    $('#tasksEmpty').classList.toggle('show', filtered.length === 0);
    $('#taskListSubtitle').textContent = filtered.length ? `${filtered.length} tugas ditampilkan dari ${tasks.length} tugas.` : 'Belum ada tugas yang cocok dengan filter.';
    $('#taskCountBadge').textContent = `${filtered.length} TUGAS`;
    $('#filterCountAll').textContent = tasks.length;
    $('#filterCountPending').textContent = tasks.filter(task => !task.done).length;
    $('#filterCountDone').textContent = tasks.filter(task => task.done).length;
    $('#navTaskCount').textContent = tasks.filter(task => !task.done).length;

    const upcoming = orderedTasks(tasks.filter(task => !task.done)).slice(0, 4);
    $('#upcomingTasks').innerHTML = upcoming.map(taskMarkup).join('');
    $('#dashboardEmpty').classList.toggle('show', upcoming.length === 0);
    updateDashboardStats();
  }

  function updateDashboardStats() {
    const total = tasks.length;
    const done = tasks.filter(task => task.done).length;
    const pending = total - done;
    const progress = total ? Math.round(done / total * 100) : 0;
    $('#statTotal').textContent = total;
    $('#statPending').textContent = pending;
    $('#statDone').textContent = done;
    $('#statProgress').textContent = progress;
    $('#pendingLine').style.width = `${total ? pending / total * 100 : 0}%`;
    $('#doneLine').style.width = `${progress}%`;
    $('#progressLine').style.width = `${progress}%`;
    $('#progressCircle').style.background = `conic-gradient(var(--purple) ${progress * 3.6}deg, #eeeafb ${progress * 3.6}deg)`;
    $('#circlePercent').textContent = `${progress}%`;
    $('#legendDone').textContent = done;
    $('#legendPending').textContent = pending;
    $('#encouragementText').textContent = total === 0 ? 'Mulai dari satu tugas kecil hari ini.' : progress === 100 ? 'Hebat! Semua tugas sudah selesai. Nikmati waktumu.' : `Kamu sudah menyelesaikan ${done} dari ${total} tugas. Terus lanjutkan!`;
  }

  function openTaskModal(task = null) {
    editingTaskId = task?.id || null;
    $('#taskModalTitle').textContent = task ? 'Edit Tugas' : 'Tambah Tugas Baru';
    $('#saveTaskBtn').textContent = task ? 'Simpan Perubahan' : 'Simpan Tugas';
    $('#taskTitle').value = task?.title || '';
    $('#taskDeadline').value = task?.deadline || todayISO();
    $('#taskPriority').value = task?.priority || 'medium';
    $('#taskDescription').value = task?.description || '';
    openModal('taskModal');
    setTimeout(() => $('#taskTitle').focus(), 80);
  }

  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (!$('.modal-backdrop.open')) document.body.classList.remove('modal-open');
  }

  function saveTaskFromForm(event) {
    event.preventDefault();
    const title = $('#taskTitle').value.trim();
    const deadline = $('#taskDeadline').value;
    if (!title || !deadline) return;
    if (editingTaskId) {
      tasks = tasks.map(task => task.id === editingTaskId ? { ...task, title, deadline, priority: $('#taskPriority').value, description: $('#taskDescription').value.trim() } : task);
      showToast('Perubahan tugas berhasil disimpan');
    } else {
      tasks.push({ id: makeId(), title, deadline, priority: $('#taskPriority').value, description: $('#taskDescription').value.trim(), done: false, createdAt: Date.now() });
      showToast('Tugas baru berhasil ditambahkan');
    }
    saveTasks();
    closeModal('taskModal');
    renderTasks();
  }

  function handleTaskAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    const task = tasks.find(item => item.id === id);
    if (!task) return;
    if (action === 'toggle') {
      task.done = !task.done;
      saveTasks();
      renderTasks();
      showToast(task.done ? 'Mantap! Tugas ditandai selesai' : 'Tugas dikembalikan ke daftar aktif');
    } else if (action === 'edit') {
      openTaskModal(task);
    } else if (action === 'delete') {
      if (!window.confirm(`Hapus tugas "${task.title}"?`)) return;
      tasks = tasks.filter(item => item.id !== id);
      saveTasks();
      renderTasks();
      showToast('Tugas berhasil dihapus');
    }
  }

  function addScheduleFromForm(event) {
    event.preventDefault();
    const title = $('#scheduleTitle').value.trim();
    const start = $('#scheduleStart').value;
    const end = $('#scheduleEnd').value;
    if (!title || !start || !end) return;
    if (end <= start) {
      showToast('Waktu selesai harus setelah waktu mulai');
      $('#scheduleEnd').focus();
      return;
    }
    schedules.push({ id: makeId(), date: $('#scheduleDate').value || todayISO(), title, start, end, category: $('#scheduleCategory').value });
    saveSchedules();
    closeModal('scheduleModal');
    $('#scheduleForm').reset();
    $('#scheduleStart').value = '08:00';
    $('#scheduleEnd').value = '09:00';
    renderSchedules();
    showToast('Agenda berhasil ditambahkan');
  }

  function renderSchedules() {
    const selectedDate = $('#scheduleDate').value || todayISO();
    $('#scheduleDateLabel').textContent = selectedDate === todayISO() ? 'Agenda untuk hari ini.' : `Agenda untuk ${formatDate(selectedDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`;
    const daySchedules = schedules.filter(item => item.date === selectedDate).sort((a, b) => a.start.localeCompare(b.start));
    $('#scheduleList').innerHTML = daySchedules.map(item => `<article class="schedule-row"><div class="schedule-time">${escapeHTML(item.start)}<span>sampai ${escapeHTML(item.end)}</span></div><div class="schedule-bar ${categoryColors[item.category] || ''}"></div><div class="schedule-info"><strong>${escapeHTML(item.title)}</strong><span>${escapeHTML(item.category)}</span></div><button class="schedule-delete" data-delete-schedule="${escapeHTML(item.id)}" aria-label="Hapus agenda" title="Hapus agenda">×</button></article>`).join('');
    $('#scheduleEmpty').classList.toggle('show', daySchedules.length === 0);
  }

  function setTimerMode(mode, minutes) {
    timerMode = mode;
    timerDuration = minutes * 60;
    timerRemaining = timerDuration;
    stopTimer(false);
    $$('.timer-mode-btn').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
    $('#timerModeLabel').textContent = mode.toUpperCase();
    $('#timerSubtext').textContent = mode === 'Fokus' ? 'Satu hal dalam satu waktu.' : 'Ambil jeda dan pulihkan energi.';
    updateTimerDisplay();
  }

  function updateTimerDisplay() {
    const minutes = Math.floor(timerRemaining / 60);
    const seconds = timerRemaining % 60;
    $('#timerDisplay').textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    const elapsedFraction = timerDuration ? (timerDuration - timerRemaining) / timerDuration : 0;
    $('#timerRing').style.background = `conic-gradient(var(--purple) ${elapsedFraction * 360}deg, #eeecfb ${elapsedFraction * 360}deg)`;
    $('#timerStart').innerHTML = timerRunning ? 'Ⅱ Jeda timer' : (timerRemaining < timerDuration ? '▶ Lanjutkan' : '▶ Mulai fokus');
  }

  function stopTimer(reset = false) {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    timerRunning = false;
    timerEndAt = null;
    if (reset) timerRemaining = timerDuration;
    updateTimerDisplay();
  }

  function startOrPauseTimer() {
    if (timerRunning) {
      timerRemaining = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
      stopTimer(false);
      return;
    }
    if (timerRemaining <= 0) timerRemaining = timerDuration;
    timerRunning = true;
    timerEndAt = Date.now() + timerRemaining * 1000;
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      timerRemaining = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
      if (timerRemaining <= 0) {
        stopTimer(false);
        if (timerMode === 'Fokus') {
          sessions += 1;
          localStorage.setItem(SESSION_KEY, String(sessions));
          $('#sessionCount').textContent = sessions;
        }
        showToast(timerMode === 'Fokus' ? 'Sesi fokus selesai! Waktunya istirahat.' : 'Waktu istirahat selesai. Siap lanjut?');
        updateTimerDisplay();
        try { if ('Notification' in window && Notification.permission === 'granted') new Notification('TimeWise', { body: timerMode === 'Fokus' ? 'Sesi fokus selesai. Bagus!' : 'Waktu istirahat selesai.' }); } catch (_) {}
      } else updateTimerDisplay();
    }, 250);
  }

  function init() {
    setHeaderDate();
    $('#scheduleDate').value = todayISO();
    $('#sessionCount').textContent = sessions;
    renderTasks();
    renderSchedules();

    $$('.nav-link,[data-page]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));
    $$('[data-open-task]').forEach(button => button.addEventListener('click', () => openTaskModal()));
    $$('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.closeModal)));
    $$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(backdrop.id); }));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') $$('.modal-backdrop.open').forEach(modal => closeModal(modal.id)); });
    $('#taskForm').addEventListener('submit', saveTaskFromForm);
    $('#allTasks').addEventListener('click', handleTaskAction);
    $('#upcomingTasks').addEventListener('click', handleTaskAction);
    $('#taskSearch').addEventListener('input', renderTasks);
    $('#filterStatus').addEventListener('change', renderTasks);
    $('#filterPriority').addEventListener('change', renderTasks);
    $('#sortTasks').addEventListener('change', renderTasks);
    $('#addScheduleBtn').addEventListener('click', () => openModal('scheduleModal'));
    $('#emptyAddSchedule').addEventListener('click', () => openModal('scheduleModal'));
    $('#scheduleForm').addEventListener('submit', addScheduleFromForm);
    $('#scheduleDate').addEventListener('change', renderSchedules);
    $('#scheduleList').addEventListener('click', event => {
      const button = event.target.closest('[data-delete-schedule]');
      if (!button) return;
      const item = schedules.find(schedule => schedule.id === button.dataset.deleteSchedule);
      if (!item || !window.confirm(`Hapus agenda "${item.title}"?`)) return;
      schedules = schedules.filter(schedule => schedule.id !== item.id);
      saveSchedules();
      renderSchedules();
      showToast('Agenda berhasil dihapus');
    });
    $('#mobileMenu').addEventListener('click', () => $('#sidebar').classList.toggle('sidebar-open'));
    $$('.timer-mode-btn').forEach(button => button.addEventListener('click', () => setTimerMode(button.dataset.mode, Number(button.dataset.minutes))));
    $('#timerStart').addEventListener('click', startOrPauseTimer);
    $('#timerReset').addEventListener('click', () => { stopTimer(true); showToast('Timer diatur ulang'); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
