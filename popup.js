document.addEventListener('DOMContentLoaded', async () => {
    const startScanBtn        = document.getElementById('startScanBtn');
    const stopScanBtn         = document.getElementById('stopScanBtn');
    const unfollowSelectedBtn = document.getElementById('unfollowSelectedBtn');
    const restartBtn          = document.getElementById('restartBtn');
    const selectAllBtn        = document.getElementById('selectAllBtn');
    const deselectAllBtn      = document.getElementById('deselectAllBtn');
    const clearWhitelistBtn   = document.getElementById('clearWhitelistBtn');
    const tabNav              = document.getElementById('tabNav');
    const tabResults          = document.getElementById('tabResults');
    const tabWhitelist        = document.getElementById('tabWhitelist');
  
    const initialState   = document.getElementById('initialState');
    const scanningState  = document.getElementById('scanningState');
    const resultsState   = document.getElementById('resultsState');
    const whitelistState = document.getElementById('whitelistState');
  
    const percentageEl      = document.getElementById('percentage');
    const progressCircle    = document.getElementById('progressCircle');
    const scanDetailsEl     = document.getElementById('scanDetails');
    const unfollowerCountEl = document.getElementById('unfollowerCount');
    const whitelistCountEl  = document.getElementById('whitelistCount');
    const unfollowerList    = document.getElementById('unfollowerList');
    const whitelistList     = document.getElementById('whitelistList');
    const toast             = document.getElementById('toast');
  
    const CIRCUMFERENCE = 213.6;
  
    let currentUnfollowers = [];
    let isUnfollowing = false;
    let toastTimer = null;
    let activeTab = 'results';
  
    // ── Restore state on popup open ──────────────────────────────────────────
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
    if (tab && tab.url && tab.url.includes('instagram.com')) {
      chrome.tabs.sendMessage(tab.id, { action: 'GET_STATE' }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        const state = res.state;
        if (!state) return;
  
        if (state.status === 'scanning') {
          showState('scanning');
          updateProgress(state.percentage || 0, state.message || 'Running...');
        } else if (state.status === 'unfollowing') {
          isUnfollowing = true;
          showState('scanning');
          updateProgress(0, state.message || 'Unfollowing...');
        } else if (state.status === 'complete') {
          currentUnfollowers = state.results || [];
          renderResults();
          showState('results');
          chrome.storage.local.remove('_appState');
        }
      });
    }
  
    function showState(state) {
      [initialState, scanningState, resultsState, whitelistState].forEach(el => el.classList.add('hidden'));
      tabNav.classList.add('hidden');
  
      if (state === 'initial')  initialState.classList.remove('hidden');
      if (state === 'scanning') scanningState.classList.remove('hidden');
      if (state === 'results') {
        tabNav.classList.remove('hidden');
        setTab(activeTab);
      }
    }
  
    function setTab(tab) {
      activeTab = tab;
      resultsState.classList.add('hidden');
      whitelistState.classList.add('hidden');
      tabResults.classList.remove('active');
      tabWhitelist.classList.remove('active');
  
      if (tab === 'results') {
        resultsState.classList.remove('hidden');
        tabResults.classList.add('active');
      } else {
        whitelistState.classList.remove('hidden');
        tabWhitelist.classList.add('active');
        renderWhitelist();
      }
    }
  
    tabResults.addEventListener('click', () => setTab('results'));
    tabWhitelist.addEventListener('click', () => setTab('whitelist'));
  
    function updateProgress(pct, detail) {
      const clamped = Math.max(0, Math.min(100, pct));
      percentageEl.textContent = `${clamped}%`;
      progressCircle.style.strokeDashoffset = CIRCUMFERENCE - (CIRCUMFERENCE * clamped) / 100;
      if (detail) scanDetailsEl.textContent = detail;
    }
  
    function showToast(msg, isError = false, duration = 4000) {
      clearTimeout(toastTimer);
      toast.textContent = msg;
      toast.classList.remove('hidden', 'error');
      if (isError) toast.classList.add('error');
      toastTimer = setTimeout(() => toast.classList.add('hidden'), duration);
    }
  
    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
  
    function makeAvatarLetter(username) {
      return (username || '?')[0].toUpperCase();
    }
  
    // ── Selection Logic ──────────────────────────────────────────────────────
  
    function updateSelectionCount() {
      const count = document.querySelectorAll('.checkbox-custom:checked').length;
      unfollowSelectedBtn.textContent = `Unfollow Selected (${count})`;
      unfollowSelectedBtn.disabled = count === 0;
      if (count === 0) {
          unfollowSelectedBtn.style.opacity = '0.5';
          unfollowSelectedBtn.style.cursor = 'not-allowed';
      } else {
          unfollowSelectedBtn.style.opacity = '1';
          unfollowSelectedBtn.style.cursor = 'pointer';
      }
    }
  
    selectAllBtn.addEventListener('click', () => {
      document.querySelectorAll('.checkbox-custom').forEach(cb => cb.checked = true);
      updateSelectionCount();
    });
  
    deselectAllBtn.addEventListener('click', () => {
      document.querySelectorAll('.checkbox-custom').forEach(cb => cb.checked = false);
      updateSelectionCount();
    });
  
    // ── Actions ──────────────────────────────────────────────────────────────
  
    startScanBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
      if (!tab || !tab.url || !tab.url.includes('instagram.com')) {
        showToast('Please open Instagram first.', true);
        return;
      }
  
      chrome.tabs.sendMessage(tab.id, { action: 'PING' }, (res) => {
        if (chrome.runtime.lastError || !res) {
          showToast('Could not connect. Refresh the Instagram page (F5) and try again.', true);
          return;
        }
  
        isUnfollowing = false;
        activeTab = 'results';
        showState('scanning');
        updateProgress(0, 'Starting...');
  
        chrome.tabs.sendMessage(tab.id, { action: 'START_SCAN' }, () => {
          if (chrome.runtime.lastError) {
            showToast('Failed to start scan. Refresh the page and try again.', true);
            showState('initial');
          }
        });
      });
    });
  
    stopScanBtn.addEventListener('click', async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) chrome.tabs.sendMessage(tab.id, { action: 'STOP_SCAN' });
      isUnfollowing = false;
      showState('initial');
    });
  
    restartBtn.addEventListener('click', () => {
        if (confirm('Start a new scan?')) {
            isUnfollowing = false;
            showState('initial');
        }
    });
  
    unfollowSelectedBtn.addEventListener('click', async () => {
      const selectedIds = Array.from(document.querySelectorAll('.checkbox-custom:checked'))
        .map(cb => cb.dataset.id);
  
      if (selectedIds.length === 0) {
        showToast('No users selected.');
        return;
      }
  
      // CONFIRMATION DIALOG IS CRITICAL HERE
      if (!confirm(`Are you sure you want to unfollow ${selectedIds.length} user(s)?`)) {
        return;
      }
  
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
  
      isUnfollowing = true;
      showState('scanning');
      updateProgress(0, `Unfollowing ${selectedIds.length} user(s)...`);
  
      chrome.tabs.sendMessage(tab.id, { action: 'START_UNFOLLOW', userIds: selectedIds });
    });
  
    clearWhitelistBtn.addEventListener('click', async () => {
      if (confirm('Clear entire whitelist?')) {
          await chrome.storage.local.set({ whitelist: [] });
          renderWhitelist();
          showToast('Whitelist cleared.');
      }
    });
  
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'SCAN_PROGRESS') {
        if (msg.percentage >= 0) {
          updateProgress(msg.percentage, msg.message);
        } else {
          if (msg.message) scanDetailsEl.textContent = msg.message;
        }
      }
  
      if (msg.type === 'SCAN_COMPLETE') {
        if (isUnfollowing) {
          isUnfollowing = false;
          showToast(msg.message || 'Done!');
          showState('initial');
        } else {
          currentUnfollowers = msg.results || [];
          renderResults();
          showState('results');
        }
      }
  
      if (msg.type === 'SCAN_ERROR') {
        isUnfollowing = false;
        showToast(msg.error, true, 6000);
        showState('initial');
      }
    });
  
    function renderResults() {
      unfollowerCountEl.textContent = currentUnfollowers.length;
      unfollowerList.innerHTML = '';
  
      if (currentUnfollowers.length === 0) {
        unfollowerList.innerHTML = `<div class="empty-msg">Everyone follows you back!</div>`;
        updateSelectionCount();
        return;
      }
  
      currentUnfollowers.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.dataset.id = user.id;
  
        // Default is now UNCHECKED (no 'checked' attribute)
        div.innerHTML = `
          <div class="user-avatar-letter">${makeAvatarLetter(user.username)}</div>
          <div class="user-info">
            <span class="username">${escapeHtml(user.username)}</span>
            ${user.full_name ? `<span class="fullname">${escapeHtml(user.full_name)}</span>` : ''}
          </div>
          <div class="user-actions">
            <button class="icon-action whitelist-btn" data-id="${user.id}" title="Add to whitelist">
                <!-- Lock Icon for Whitelist -->
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
            </button>
            <input type="checkbox" class="checkbox-custom" data-id="${user.id}">
          </div>
        `;
  
        unfollowerList.appendChild(div);
      });
  
      // Listen for checkbox changes
      unfollowerList.querySelectorAll('.checkbox-custom').forEach(cb => {
          cb.addEventListener('change', updateSelectionCount);
      });
  
      // Whitelist logic
      unfollowerList.querySelectorAll('.whitelist-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.dataset.id;
          const user = currentUnfollowers.find(u => String(u.id) === String(id));
          if (!user) return;
  
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab) chrome.tabs.sendMessage(tab.id, { action: 'ADD_TO_WHITELIST', user });
  
          // Optimistic UI update
          const item = unfollowerList.querySelector(`.user-item[data-id="${id}"]`);
          if (item) item.remove();
  
          currentUnfollowers = currentUnfollowers.filter(u => String(u.id) !== String(id));
          unfollowerCountEl.textContent = currentUnfollowers.length;
          updateSelectionCount();
          showToast(`@${user.username} sent to whitelist.`);
        });
      });
      
      updateSelectionCount(); // Initialize count
    }
  
    async function renderWhitelist() {
      const data = await chrome.storage.local.get(['whitelist']);
      const whitelist = data.whitelist || [];
  
      whitelistCountEl.textContent = whitelist.length;
      whitelistList.innerHTML = '';
  
      if (whitelist.length === 0) {
        whitelistList.innerHTML = `<div class="empty-msg">Whitelist is empty.</div>`;
        return;
      }
  
      whitelist.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.dataset.id = user.id;
  
        div.innerHTML = `
          <div class="user-avatar-letter">${makeAvatarLetter(user.username)}</div>
          <div class="user-info">
            <span class="username">${escapeHtml(user.username)}</span>
            ${user.full_name ? `<span class="fullname">${escapeHtml(user.full_name)}</span>` : ''}
          </div>
          <div class="user-actions">
            <button class="icon-action remove-btn" data-id="${user.id}" title="Remove from whitelist">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        `;
  
        whitelistList.appendChild(div);
      });
  
      whitelistList.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.currentTarget.dataset.id;
          const data = await chrome.storage.local.get(['whitelist']);
          const updated = (data.whitelist || []).filter(u => String(u.id) !== String(id));
          await chrome.storage.local.set({ whitelist: updated });
          renderWhitelist();
          showToast('Removed from whitelist.');
        });
      });
    }
  });
