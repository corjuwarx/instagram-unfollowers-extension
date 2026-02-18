let stopRequested = false;
let isProcessing = false; // Prevent concurrent operations
const INSTAGRAM_HOSTNAME = 'https://www.instagram.com';

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ── API Helpers ─────────────────────────────────────────────────────────────

async function fetchAPI(url) {
    const csrftoken = getCookie('csrftoken') || '';
    const claim = sessionStorage.getItem('www-claim-v2') || '0';
    
    const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
            'Accept': '*/*',
            'X-IG-App-ID': '936619743392459',
            'X-ASBD-ID': '129477',
            'X-CSRFToken': csrftoken,
            'X-IG-WWW-Claim': claim,
            'X-Requested-With': 'XMLHttpRequest',
        }
    });

    if (response.status === 429) {
        throw new Error('RATE_LIMIT');
    }

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
}

async function unfollowUser(userId) {
    const csrftoken = getCookie('csrftoken') || '';
    const claim = sessionStorage.getItem('www-claim-v2') || '0';
    
    const response = await fetch(`${INSTAGRAM_HOSTNAME}/api/v1/friendships/destroy/${userId}/`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'X-CSRFToken': csrftoken,
            'X-IG-App-ID': '936619743392459',
            'X-ASBD-ID': '129477',
            'X-IG-WWW-Claim': claim,
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `container_module=profile&user_id=${userId}`
    });

    if (response.status === 429) throw new Error('RATE_LIMIT');
    if (response.status === 403) throw new Error('FORBIDDEN');
    
    if (!response.ok) {
        // Try to get error message from body
        try {
            const errBody = await response.json();
            throw new Error(errBody.message || errBody.status || `HTTP ${response.status}`);
        } catch (e) {
            throw new Error(`HTTP ${response.status}`);
        }
    }

    return response.json();
}

// ── State Management ────────────────────────────────────────────────────────

async function loadWhitelist() {
    const data = await chrome.storage.local.get(['whitelist']);
    return data.whitelist || [];
}

async function saveWhitelist(list) {
    await chrome.storage.local.set({ whitelist: list });
}

async function saveState(state) {
    await chrome.storage.local.set({ _appState: state });
}

async function clearState() {
    await chrome.storage.local.remove('_appState');
}

// ── Utils ───────────────────────────────────────────────────────────────────

function getUserId() {
    // 1. Try cookie (most reliable for logged in user)
    let id = getCookie('ds_user_id');
    if (id) return id;

    // 2. Try parsing scripts (Fallback)
    try {
        const jsonScripts = Array.from(document.querySelectorAll('script[type="application/json"]'));
        for (const s of jsonScripts) {
            // New pattern
            if (s.textContent.includes('viewer')) {
                const match = s.textContent.match(/"viewerId"\s*:\s*"(\d+)"/);
                if (match) return match[1];
                const match2 = s.textContent.match(/"id"\s*:\s*"(\d+)"/);
                if (match2) return match2[1];
            }
        }
        
        // Legacy pattern
        const allScripts = Array.from(document.querySelectorAll('script:not([src])'));
        for (const s of allScripts) {
            const match = s.textContent.match(/"viewerId"\s*:\s*"(\d+)"/);
            if (match) return match[1];
        }
    } catch (e) {
        console.error('[Unfollowers] getUserId error:', e);
    }

    return null;
}

// ── Main Logic ──────────────────────────────────────────────────────────────

async function startScanning() {
    if (isProcessing) {
        chrome.runtime.sendMessage({ type: 'SCAN_ERROR', error: 'Already running. Please wait or stop.' });
        return;
    }
    isProcessing = true;
    stopRequested = false;

    
    try {
        const userId = getUserId();

        if (!userId) {
            chrome.runtime.sendMessage({
                type: 'SCAN_ERROR',
                error: 'User ID not found. Please log in and go to your profile page, then refresh.'
            });
            isProcessing = false;
            return;
        }

        await saveState({ status: 'scanning', message: 'Fetching following list...' });

        const following = [];
        const followers = [];

        // 1. Fetch Following
        let hasNext = true;
        let maxId = '';

        while (hasNext && !stopRequested) {
            const url = `${INSTAGRAM_HOSTNAME}/api/v1/friendships/${userId}/following/?count=50${maxId ? '&max_id=' + maxId : ''}`;
            const data = await fetchAPI(url);

            if (!data || data.status !== 'ok') {
                throw new Error(`API Error (Following): ${data?.message || 'Unknown'}`);
            }

            (data.users || []).forEach(u => following.push({
                id: String(u.pk),
                username: u.username,
                full_name: u.full_name || '',
            }));

            hasNext = !!data.next_max_id;
            maxId = data.next_max_id || '';

            const msg = `Following: ${following.length} fetched...`;
            await saveState({ status: 'scanning', percentage: 25, message: msg });
            chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', percentage: 25, message: msg });

            if (hasNext) await sleep(1500 + Math.random() * 1000); // 1.5 - 2.5s
        }

        if (stopRequested) { await clearState(); return; }

        // Safety Pause
        await saveState({ status: 'scanning', percentage: 50, message: 'Safety pause (5s)...' });
        chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', percentage: 50, message: 'Safety pause (5s)...' });
        await sleep(5000);

        // 2. Fetch Followers
        hasNext = true;
        maxId = '';

        while (hasNext && !stopRequested) {
            const url = `${INSTAGRAM_HOSTNAME}/api/v1/friendships/${userId}/followers/?count=50${maxId ? '&max_id=' + maxId : ''}`;
            const data = await fetchAPI(url);

            if (!data || data.status !== 'ok') {
                throw new Error(`API Error (Followers): ${data?.message || 'Unknown'}`);
            }

            (data.users || []).forEach(u => followers.push({ id: String(u.pk) }));

            hasNext = !!data.next_max_id;
            maxId = data.next_max_id || '';

            const msg = `Followers: ${followers.length} fetched...`;
            await saveState({ status: 'scanning', percentage: 75, message: msg });
            chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', percentage: 75, message: msg });

            if (hasNext) await sleep(1500 + Math.random() * 1000); // 1.5 - 2.5s
        }

        if (stopRequested) { await clearState(); return; }

        // 3. Process
        const followerIds = new Set(followers.map(f => f.id));
        const whitelist = await loadWhitelist();
        const whitelistIds = new Set(whitelist.map(u => String(u.id)));

        const unfollowers = following.filter(f => !followerIds.has(f.id) && !whitelistIds.has(f.id));

        await saveState({ status: 'complete', results: unfollowers });
        chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE', results: unfollowers });

    } catch (error) {
        console.error('[Unfollowers] Scan error:', error);
        await clearState();
        let msg = error.message;
        if (msg === 'RATE_LIMIT') msg = 'Rate limit detected. Please wait ~15 mins.';
        chrome.runtime.sendMessage({ type: 'SCAN_ERROR', error: msg });
    } finally {
        isProcessing = false;
    }
}

async function processUnfollows(userIds) {
    if (isProcessing) {
        chrome.runtime.sendMessage({ type: 'SCAN_ERROR', error: 'Already running. Please wait.' });
        return;
    }
    isProcessing = true;
    stopRequested = false;

    const whitelist = await loadWhitelist();
    const whitelistIds = new Set(whitelist.map(u => String(u.id)));
    let count = 0;

    await saveState({ status: 'unfollowing', total: userIds.length, count: 0 });

    try {
        for (const id of userIds) {
            if (stopRequested) break;
            if (whitelistIds.has(String(id))) continue;

            try {
                const res = await unfollowUser(id);
                
                // In API v1, status is 'ok' on success
                if (res && res.status === 'ok') {
                    count++;
                    
                    // Success delay: 30-60s
                    const delay = 30000 + Math.random() * 30000;
                    const secs = Math.round(delay / 1000);
                    const msg = `Unfollowed ${count}. Waiting ${secs}s...`;

                    await saveState({ status: 'unfollowing', total: userIds.length, count, message: msg });
                    chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', percentage: -1, message: msg });
                    
                    await sleep(delay);

                    // Big break even 10 users
                    if (count > 0 && count % 10 === 0) {
                        const mins = 5 + Math.floor(Math.random() * 6); // 5-10m
                        const breakMsg = `Safety break: ${mins} min...`;
                        await saveState({ status: 'unfollowing', total: userIds.length, count, message: breakMsg });
                        chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', percentage: -1, message: breakMsg });
                        await sleep(mins * 60000);
                    }
                } else {
                    throw new Error(res.message || 'API status not ok');
                }

            } catch (err) {
                console.error('[Unfollowers] Unfollow error:', err);
                
                if (err.message === 'RATE_LIMIT' || err.message === 'FORBIDDEN') {
                    const waitMins = 15;
                    const errMsg = `Rate limit! Pausing ${waitMins} min...`;
                    await saveState({ status: 'unfollowing', total: userIds.length, count, message: errMsg });
                    chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', percentage: -1, message: errMsg });
                    await sleep(waitMins * 60000);
                } else {
                    // Other error, safety wait then skip
                    await sleep(45000);
                }
            }
        }

        await clearState();
        chrome.runtime.sendMessage({
            type: 'SCAN_COMPLETE',
            results: [],
            message: stopRequested ? 'Process Stopped.' : `Done! Unfollowed ${count} user(s).`
        });
    } catch(e) {
         console.error('[Unfollowers] Process Error', e);
         chrome.runtime.sendMessage({ type: 'SCAN_ERROR', error: e.message });
    } finally {
        isProcessing = false;
    }
}

// ── Message Listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PING') {
        sendResponse({ status: 'PONG' });
        return true;
    }

    if (request.action === 'GET_STATE') {
        chrome.storage.local.get(['_appState'], (data) => {
            sendResponse({ state: data._appState || null });
        });
        return true;
    }

    if (request.action === 'START_SCAN') {
        startScanning();
        sendResponse({ status: 'started' });
        return true;
    }

    if (request.action === 'STOP_SCAN') {
        stopRequested = true;
        clearState();
        sendResponse({ status: 'stopped' });
        return true;
    }

    if (request.action === 'ADD_TO_WHITELIST') {
        (async () => {
            const whitelist = await loadWhitelist();
            if (!whitelist.some(u => String(u.id) === String(request.user.id))) {
                whitelist.push(request.user);
                await saveWhitelist(whitelist);
            }
            sendResponse({ status: 'ok' });
        })();
        return true;
    }

    if (request.action === 'START_UNFOLLOW') {
        processUnfollows(request.userIds || []);
        sendResponse({ status: 'process_started' });
        return true;
    }
});