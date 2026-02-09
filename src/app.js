/**
 * Violoncello - Text-Based Web Reader
 * Full Heavy-Duty Version (Uncondensed)
 */

// --- GLOBAL STATE ---
let isMenuOpen = false;
let isUrlBarOpen = false;
let isAboutOpen = false;
let currUrl = "";
let historyStack = [];
let currentSize = getSafeLocalStorage('userTextSize', 'medium');
let colorMode = getSafeLocalStorage('colorMode', 'light');
let isLoading = false;
let selectedLinkIndex = -1;
const MAX_HISTORY = 50; // Prevent memory issues
const REQUEST_TIMEOUT = 15000;

// --- UTILITY: SAFE LOCALSTORAGE ACCESS ---
function getSafeLocalStorage(key, defaultValue) {
    try {
        return localStorage.getItem(key) || defaultValue;
    } catch (e) {
        console.error('localStorage access failed:', e);
        return defaultValue;
    }
}

function setSafeLocalStorage(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        console.error('localStorage write failed:', e);
        return false;
    }
}

// --- CSS INJECTION FOR KEYBOARD COMPLIANCE ---
const style = document.createElement('style');
style.innerHTML = `
    :focus { outline: none !important; }
    .menu-item:focus { background: #ff6000 !important; color: white !important; }
    .kai-link:focus { background: #eee; color: #ff6000; text-decoration: underline; }
`;
document.head.appendChild(style);

// --- PAGE LOADER & SCRAPER ---
async function loadPage(url, isBackAction = false) {
    if (isLoading) return; // Prevent duplicate requests
    isLoading = true;

    const loader = document.getElementById('loading-screen');
    if (loader) loader.classList.remove('hidden');

    // Validate URL
    if (!url || typeof url !== 'string') {
        showError('Invalid URL');
        isLoading = false;
        return;
    }

    // History management
    if (!isBackAction && currUrl !== "" && currUrl !== url) {
        historyStack.push(currUrl);
        // Limit history size to prevent memory issues
        if (historyStack.length > MAX_HISTORY) {
            historyStack.shift();
        }
    }

    try {
        // Handle common redirect wrappers (e.g., DuckDuckGo result links with uddg=)
        try {
            const parsedTemp = new URL(url);
            if (parsedTemp.hostname.includes('duckduckgo.com') && parsedTemp.pathname.startsWith('/l/')) {
                const p = new URLSearchParams(parsedTemp.search);
                const uddg = p.get('uddg');
                if (uddg) {
                    try {
                        const decodedUrl = decodeURIComponent(uddg);
                        // Validate decoded URL to prevent javascript: or data: URI attacks
                        const parsed = new URL(decodedUrl);
                        const allowedProtocols = ['http:', 'https:', 'mailto:', 'ftp:'];
                        if (allowedProtocols.includes(parsed.protocol)) {
                            url = decodedUrl;
                        }
                        // If protocol is not allowed, ignore the uddg param and use original URL
                    } catch (e) {
                        // If decoding or parsing fails, ignore uddg param
                    }
                }
            }
        } catch (e) {
            // ignore URL parsing errors
        }

        const xhr = new XMLHttpRequest({ mozSystem: true });
        xhr.open('GET', url, true);
        xhr.timeout = REQUEST_TIMEOUT;

        const htmlString = await new Promise((resolve, reject) => {
            xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve(xhr.responseText) : reject();
            xhr.onerror = () => reject();
            xhr.ontimeout = () => reject();
            xhr.send();
        });

        // If the response is not HTML (images, PDFs, etc.), do not open externally.
        // Instead, show a helpful message — external opening is disabled for security.
        try {
            const ct = xhr.getResponseHeader && xhr.getResponseHeader('Content-Type');
            if (ct && !ct.toLowerCase().includes('html') && !ct.toLowerCase().startsWith('text/')) {
                showNotification('This content type cannot be rendered in-app.', true);
                isLoading = false;
                if (loader) loader.classList.add('hidden');
                return;
            }
        } catch (e) {
            // ignore header read errors and continue
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');

        // Comprehensive Scraper Targeting
        const source = doc.querySelector('article, main, [role="main"], #content, .content, .post, .results, #links') || doc.body;

        // Strip non-essential elements
        const junk = source.querySelectorAll('script, style, iframe, ads, nav, footer, img, video, svg, input, button, form, noscript, canvas, object');
        junk.forEach(el => el.remove());

        // Process all remaining elements for accessibility and navigation
        const allElements = source.querySelectorAll('*');
        const allowedProtocols = ['http:', 'https:', 'mailto:', 'ftp:'];
        allElements.forEach(el => {
            // Remove inline styles and event handlers
            el.removeAttribute('style');
            // Remove any inline event handlers (onclick, onerror, etc.)
            Array.from(el.attributes).forEach(attr => {
                if (/^on/i.test(attr.name)) {
                    el.removeAttribute(attr.name);
                }
            });

            if (el.tagName === 'A') {
                const href = el.getAttribute('href');
                if (href) {
                    try {
                        const resolved = new URL(href, url);
                        // Only allow http/https/mailto/ftp schemes
                        if (allowedProtocols.includes(resolved.protocol)) {
                            el.setAttribute('href', resolved.href);
                        } else {
                            // Strip dangerous or unsupported protocols
                            el.removeAttribute('href');
                        }
                    } catch (e) {
                        // If URL is invalid, remove href to avoid javascript: or other bad schemes
                        el.removeAttribute('href');
                    }
                }
                // Make links keyboard-focusable and mark for in-app handling
                el.classList.add('kai-link');
                el.setAttribute('tabindex', '0'); // Essential for D-Pad focus
                // Remove target to prevent opening external windows
                el.removeAttribute('target');
                el.setAttribute('rel', 'noreferrer');
            }
        });

        const reader = document.getElementById('reader');
        // Clear existing content
        reader.innerHTML = "";
        // Append only the child nodes of the fetched source to avoid appending a <body> or <html> element
        const frag = document.createDocumentFragment();
        Array.from(source.childNodes).forEach(node => {
            // Clone nodes to avoid moving them from the parsed document
            frag.appendChild(node.cloneNode(true));
        });
        reader.appendChild(frag);
        reader.scrollTo(0, 0);

        // Setup link interactions after rendering page
        try {
            setupLinkInteractions();
        } catch (e) {
            console.warn('Link setup failed:', e);
        }

        currUrl = url;
        document.getElementById('url-input').value = url;
        setSafeLocalStorage('lastVisitedUrl', url);

    } catch (e) {
        showError('Failed to load page. Site may be blocking access or you may be offline.');
    } finally {
        isLoading = false;
        if (loader) loader.classList.add('hidden');
        document.getElementById('reader').focus();
        updateSoftkeyLabels();
    }
}

// --- ERROR DISPLAY FUNCTION ---
function showError(message) {
    const reader = document.getElementById('reader');
    reader.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #ff6000;">
            <p style="font-size: 18px; margin-bottom: 15px;"><b>⚠ Error</b></p>
            <p style="font-size: 14px; line-height: 1.6;">${escapeHtml(message)}</p>
            <p style="font-size: 12px; color: #aaa; margin-top: 20px;">Press BACK to go back</p>
        </div>
    `;
}

// --- WELCOME SCREEN ---
function showWelcome() {
    const reader = document.getElementById('reader');
    reader.innerHTML = `
        <div style="padding: 20px 20px; text-align: center;">
            <p style="font-size: 24px; margin-bottom: 5px;"><b>Violoncello</b></p>
            <p style="font-size: 16px; line-height: 1.6; margin-bottom: 30px; color: #999;">
                Text Browser
            </p>
            <p style="font-size: 18px; margin-bottom: 5px; font-weight: bold;">
                Get Started
            </p>
            <p style="font-size: 14px; color: #aaa; line-height: 1.6;">
                Press <b>Left Key</b> to enter a URL<br>or search the web.
            </p>
            <p style="font-size: 12px; color: #666; margin-top: 10px; line-height: 1.4;">
                Navigate with D-Pad arrows<br>
                Scroll with Volume buttons<br>
                Press Right Key for menu
            </p>
        </div>
    `;
    currUrl = '';
}

// --- LINK SELECTION HELPERS ---
function clearLinkSelection() {
    const prev = document.querySelector('#reader a.kai-link.link-selected');
    if (prev) {
        prev.classList.remove('link-selected');
        try { prev.blur(); } catch (e) { }
    }
    selectedLinkIndex = -1;
    updateSoftkeyLabels();
}

function selectLink(index) {
    const links = getSortedLinks();
    if (!links || links.length === 0) return;
    index = ((index % links.length) + links.length) % links.length;
    clearLinkSelection();
    const link = links[index];
    if (!link) return;
    link.classList.add('link-selected');
    try { link.focus(); } catch (e) { }
    try {
        // Scroll within the reader container to keep link visible without moving page under fixed UI
        const reader = document.getElementById('reader');
        if (reader) {
            // Use offsetTop to get position relative to scrollable content (not viewport)
            let el = link;
            let top = 0;
            while (el && el !== reader) {
                top += el.offsetTop;
                el = el.offsetParent;
            }
            // Center link in viewport with padding at top
            const targetScroll = Math.max(0, top - (reader.clientHeight / 3));
            const maxScroll = reader.scrollHeight - reader.clientHeight;
            reader.scrollTop = Math.min(targetScroll, maxScroll);
        } else {
            link.scrollIntoView({ block: 'nearest' });
        }
    } catch (e) {
        try { link.scrollIntoView(false); } catch (err) { }
    }
    selectedLinkIndex = index;
    updateSoftkeyLabels();
}

function setupLinkInteractions() {
    clearLinkSelection();
    // Normalize all anchors inside the reader: ensure they have the kai-link class
    // and are keyboard-focusable. This guards against pages where class addition
    // may have failed during sanitization or parsing.
    const anchors = Array.from(document.querySelectorAll('#reader a'));
    anchors.forEach((l) => {
        if (!l.classList.contains('kai-link')) l.classList.add('kai-link');
        l.setAttribute('tabindex', '0');
    });
}

function getSortedLinks() {
    const links = Array.from(document.querySelectorAll('#reader a.kai-link'));
    // Map to rects and sort top->left for consistent D-Pad navigation
    const mapped = links.map(l => {
        const r = l.getBoundingClientRect ? l.getBoundingClientRect() : { top: 0, left: 0 };
        return { el: l, top: Math.round(r.top), left: Math.round(r.left) };
    });

    // If getBoundingClientRect returned identical values (e.g., in non-layout environments),
    // fall back to data attributes `data-top` and `data-left` when present.
    const allZeroTop = mapped.every(m => m.top === 0);
    if (allZeroTop) {
        const fallback = links.map(l => {
            const t = parseInt(l.getAttribute('data-top') || l.dataset.top || '0', 10) || 0;
            const left = parseInt(l.getAttribute('data-left') || l.dataset.left || '0', 10) || 0;
            return { el: l, top: t, left };
        });
        fallback.sort((a, b) => (a.top - b.top) || (a.left - b.left));
        return fallback.map(f => f.el);
    }

    mapped.sort((a, b) => (a.top - b.top) || (a.left - b.left));
    return mapped.map(m => m.el);
}

// --- HELPERS: Nearest link selection relative to reader viewport ---
function findNearestLinkIndex(direction, linksParam) {
    // Use provided links array if available to avoid double-sorting on DOM changes
    const links = linksParam || getSortedLinks();
    if (!links || links.length === 0) return -1;
    const reader = document.getElementById('reader');
    if (!reader) return 0;
    const readerRect = reader.getBoundingClientRect();
    const viewportCenter = readerRect.top + (reader.clientHeight / 2);

    let bestIndex = -1;
    let bestScore = Infinity;
    for (let i = 0; i < links.length; i++) {
        const r = links[i].getBoundingClientRect();
        const linkCenter = r.top + (r.height / 2);
        const delta = linkCenter - viewportCenter;
        // Prefer links in the requested direction; give them better score
        let score = Math.abs(delta);
        if (direction === 'down' && delta >= 0) score *= 0.5;
        if (direction === 'up' && delta <= 0) score *= 0.5;
        if (score < bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }
    return bestIndex;
}

// --- HTML ESCAPE FOR SECURITY ---
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- SEARCH & URL OVERLAY ---
function handleUrlSubmit() {
    let input = document.getElementById('url-input').value.trim();
    if (!input) return;

    let url;
    if (!input.includes(".") || input.includes(" ")) {
        // Search query
        url = `https://duckduckgo.com/html/?q=${encodeURIComponent(input)}`;
    } else {
        // URL input
        try {
            // Test if it's a valid URL
            new URL(input.startsWith('http') ? input : 'https://' + input);
            url = input.startsWith('http') ? input : 'https://' + input;
        } catch (e) {
            showError('Invalid URL format. Please enter a valid website address.');
            return;
        }
    }

    toggleUrlBar();
    loadPage(url);
}

function toggleUrlBar() {
    isUrlBarOpen = !isUrlBarOpen;
    const overlay = document.getElementById('url-overlay');
    const input = document.getElementById('url-input');

    if (isUrlBarOpen) {
        clearLinkSelection();
        overlay.classList.remove('hidden');
        input.focus();
        // KaiOS-Specific Selection Fix
        setTimeout(() => {
            input.setSelectionRange(0, input.value.length);
            input.select();
        }, 150);
    } else {
        overlay.classList.add('hidden');
        document.getElementById('reader').focus();
    }
    updateSoftkeyLabels();
}

// --- MENU SYSTEM ---
function resetMainMenu() {
    const menu = document.getElementById('option-menu');
    menu.innerHTML = `
        <div class="menu-item" tabindex="0" data-action="top">Go to Top</div>
        <div class="menu-item" tabindex="0" data-action="refresh">Refresh Page</div>
        <div class="menu-item" tabindex="0" data-action="add-bookmark">Add Bookmark</div>
        <div class="menu-item" tabindex="0" data-action="view-bookmarks">My Bookmarks</div>
        <div class="menu-item" tabindex="0" data-action="text-toggle">Text Size: ${currentSize.toUpperCase()}</div>
        <div class="menu-item" tabindex="0" data-action="color-toggle">Color Mode: ${colorMode.toUpperCase()}</div>
        <div class="menu-item" tabindex="0" data-action="about">About Violoncello</div>
        <div class="menu-item" tabindex="0" data-action="close">Close Menu</div>
    `;
}

// --- NOTIFICATION SYSTEM ---
function showNotification(message, isError = false) {
    const notification = document.createElement('div');
    notification.className = 'notification ' + (isError ? 'notification-error' : 'notification-success');
    notification.innerText = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 2500);
}

function showBookmarks() {
    const menu = document.getElementById('option-menu');
    let b = [];
    try {
        b = JSON.parse(getSafeLocalStorage('bookmarks', "[]"));
    } catch (e) {
        console.error('Bookmarks parsing error:', e);
        setSafeLocalStorage('bookmarks', "[]");
    }

    let html = '<div class="menu-item" tabindex="0" data-action="main-menu">← Back to Main Menu</div>';

    if (b.length === 0) {
        html += '<div class="menu-item" tabindex="0" data-action="main-menu" style="opacity:0.6;">No bookmarks saved.</div>';
    } else {
        b.forEach((item, index) => {
            html += `<div class="menu-item" tabindex="0" data-action="load-bookmark" data-url="${escapeHtml(item.url)}">${escapeHtml(item.title)}</div>`;
            html += `<div class="menu-item menu-delete" tabindex="0" data-action="delete-bookmark" data-index="${index}">[Delete Item]</div>`;
        });
        html += `<div class="menu-item menu-delete" tabindex="0" data-action="confirm-clear-all">CLEAR ALL</div>`;
    }

    menu.innerHTML = html;
    setTimeout(() => {
        const first = menu.querySelector('.menu-item');
        if (first) first.focus();
    }, 50);
}

function handleMenuAction(action) {
    const el = document.activeElement;

    switch (action) {
        case "top":
            document.getElementById('reader').scrollTo(0, 0);
            closeMenu();
            break;
        case "refresh":
            loadPage(currUrl);
            closeMenu();
            break;
        case "add-bookmark":
            try {
                // Prevent bookmarking the local default homepage (currUrl === '')
                if (!currUrl) {
                    showNotification('Cannot bookmark the default homepage', true);
                    closeMenu();
                    break;
                }

                let b = JSON.parse(getSafeLocalStorage('bookmarks', "[]"));
                // Normalize title: trim whitespace and collapse multiple spaces
                let title = (document.querySelector('h1, h2')?.innerText || "Untitled Page")
                    .trim()
                    .replace(/\s+/g, ' ')
                    .substring(0, 20);
                b.push({ title, url: currUrl });
                if (setSafeLocalStorage('bookmarks', JSON.stringify(b))) {
                    showNotification('Bookmark saved!');
                } else {
                    showNotification('Storage full - bookmark may not save', true);
                }
            } catch (e) {
                showNotification('Failed to save bookmark', true);
            }
            closeMenu();
            break;
        case "view-bookmarks":
            try {
                showBookmarks();
            } catch (e) {
                console.error('Bookmarks error:', e);
                showNotification('Failed to load bookmarks', true);
                resetMainMenu();
            }
            break;
        case "main-menu":
            resetMainMenu();
            setTimeout(() => {
                const first = document.querySelector('.menu-item');
                if (first) first.focus();
            }, 50);
            break;
        case "load-bookmark":
            loadPage(el.getAttribute('data-url'));
            closeMenu();
            break;
        case "delete-bookmark":
            // Show confirmation before deleting
            const bookmarkIndex = el.getAttribute('data-index');
            const bookmarks = JSON.parse(getSafeLocalStorage('bookmarks', "[]"));
            const bookmarkTitle = bookmarks[bookmarkIndex]?.title || "Bookmark";
            const confirmMenu = document.getElementById('option-menu');
            confirmMenu.innerHTML = `
                <div class="menu-item" style="opacity:0.7;">Delete "${escapeHtml(bookmarkTitle)}"?</div>
                <div class="menu-item menu-delete" tabindex="0" data-action="confirm-delete-bookmark" data-index="${bookmarkIndex}">Yes, Delete</div>
                <div class="menu-item" tabindex="0" data-action="cancel-delete">Cancel</div>
            `;
            setTimeout(() => {
                const firstItem = confirmMenu.querySelector('[data-action="confirm-delete-bookmark"]');
                if (firstItem) firstItem.focus();
            }, 50);
            break;
        case "confirm-delete-bookmark":
            try {
                let bookmarks = JSON.parse(getSafeLocalStorage('bookmarks', "[]"));
                bookmarks.splice(parseInt(el.getAttribute('data-index'), 10), 1);
                setSafeLocalStorage('bookmarks', JSON.stringify(bookmarks));
                showNotification('Bookmark deleted');
                showBookmarks();
            } catch (e) {
                console.error('Delete bookmark error:', e);
                showNotification('Failed to delete bookmark', true);
            }
            break;
        case "cancel-delete":
            showBookmarks();
            break;
        case "confirm-clear-all":
            // Show confirmation before clearing all
            const clearMenu = document.getElementById('option-menu');
            clearMenu.innerHTML = `
                <div class="menu-item" style="opacity:0.7;">Delete ALL bookmarks?</div>
                <div class="menu-item menu-delete" tabindex="0" data-action="really-clear-all">Yes, Delete All</div>
                <div class="menu-item" tabindex="0" data-action="cancel-clear-all">Cancel</div>
            `;
            setTimeout(() => {
                const firstItem = clearMenu.querySelector('[data-action="really-clear-all"]');
                if (firstItem) firstItem.focus();
            }, 50);
            break;
        case "really-clear-all":
            try {
                setSafeLocalStorage('bookmarks', "[]");
                showNotification('All bookmarks deleted');
                showBookmarks();
            } catch (e) {
                console.error('Clear bookmarks error:', e);
                showNotification('Failed to clear bookmarks', true);
            }
            break;
        case "cancel-clear-all":
            showBookmarks();
            break;
        case "text-toggle":
            const sizes = ['xsmall', 'small', 'medium', 'large', 'xlarge'];
            currentSize = sizes[(sizes.indexOf(currentSize) + 1) % sizes.length];
            setSafeLocalStorage('userTextSize', currentSize);
            document.getElementById('reader').className = 'text-' + currentSize;
            el.innerText = "Text Size: " + currentSize.toUpperCase();
            break;
        case "color-toggle":
            const colors = ['light', 'dark', 'sepia', 'darkblue', 'terminal'];
            colorMode = colors[(colors.indexOf(colorMode) + 1) % colors.length];
            setSafeLocalStorage('colorMode', colorMode);
            applyColorMode(colorMode);
            el.innerText = "Color Mode: " + colorMode.toUpperCase();
            break;
        case "about":
            openAbout();
            break;
        case "close":
            closeMenu();
            break;
    }
}

// --- COLOR MODE APPLICATION ---
function applyColorMode(mode) {
    const body = document.body;
    body.className = 'color-' + mode;
}

// --- POPUP CONTROLS ---
function openMenu() {
    resetMainMenu();

    // Disable reader interaction when menu is open
    const readerEl = document.getElementById('reader');
    clearLinkSelection();
    readerEl.blur();
    readerEl.style.pointerEvents = 'none';
    readerEl.setAttribute('aria-hidden', 'true');

    // Make menu visible and interactive
    const menuEl = document.getElementById('option-menu');
    menuEl.classList.remove('hidden');
    menuEl.classList.add('active');
    menuEl.style.pointerEvents = 'auto';
    menuEl.setAttribute('aria-hidden', 'false');

    isMenuOpen = true;

    // Forcefully focus first menu item with multiple attempts
    setTimeout(() => {
        const items = document.querySelectorAll('#option-menu .menu-item');
        if (items && items.length > 0) {
            const firstItem = items[0];
            firstItem.focus();
            firstItem.scrollIntoView(false);
            // Verify focus was set
            if (document.activeElement !== firstItem) {
                firstItem.focus();
            }
        }
    }, 5);

    updateSoftkeyLabels();
}

function closeMenu() {
    isMenuOpen = false;

    // Re-enable reader and hide menu
    const readerEl = document.getElementById('reader');
    readerEl.style.pointerEvents = 'auto';
    readerEl.setAttribute('aria-hidden', 'false');
    readerEl.focus();

    const menuEl = document.getElementById('option-menu');
    menuEl.classList.add('hidden');
    menuEl.classList.remove('active');
    menuEl.style.pointerEvents = 'none';
    menuEl.setAttribute('aria-hidden', 'true');

    updateSoftkeyLabels();
}

function openAbout() {
    document.getElementById('option-menu').classList.add('hidden');
    isMenuOpen = false;
    document.getElementById('about-screen').classList.remove('hidden');
    isAboutOpen = true;
    updateSoftkeyLabels();
}

function closeAbout() {
    isAboutOpen = false;
    document.getElementById('about-screen').classList.add('hidden');
    document.getElementById('reader').focus();
    updateSoftkeyLabels();
}

// --- HARDWARE INPUT ENGINE ---
window.addEventListener('keydown', (e) => {
    // 1. Volume Keys - Scroll reader only, never interrupt scroll at boundaries
    if (e.key === 'VolumeUp' || e.key === 'AudioVolumeUp') {
        e.preventDefault();
        if (!isMenuOpen && !isUrlBarOpen && !isAboutOpen) {
            const reader = document.getElementById('reader');
            reader.scrollBy(0, -window.innerHeight * 0.75);
        }
        return;
    }
    if (e.key === 'VolumeDown' || e.key === 'AudioVolumeDown') {
        e.preventDefault();
        if (!isMenuOpen && !isUrlBarOpen && !isAboutOpen) {
            const reader = document.getElementById('reader');
            reader.scrollBy(0, window.innerHeight * 0.75);
        }
        return;
    }

    // 2. Escape Logic
    if (isAboutOpen) {
        if (['Backspace', 'Enter', 'SoftRight'].includes(e.key)) {
            e.preventDefault();
            closeAbout();
        }
        return;
    }

    // 3. URL Bar Backspace Handling - Allow text deletion, only close if empty
    if (isUrlBarOpen && e.key === 'Backspace') {
        const input = document.getElementById('url-input');
        if (input.value.length === 0) {
            e.preventDefault();
            toggleUrlBar();
        }
        // If input has content, let default backspace behavior delete text
        return;
    }

    // 3.5 Link selection and navigation when reader is active
    // Behavior: Arrow keys will select the link nearest the reader viewport
    // (preferring the arrow direction) when starting link navigation.
    if (!isMenuOpen && !isUrlBarOpen && !isAboutOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const links = getSortedLinks();

        if (!links || links.length === 0) {
            // No links on page - allow normal scrolling
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        if (selectedLinkIndex !== -1) {
            // Already in link-navigation mode: move to next/previous
            selectLink(e.key === 'ArrowDown' ? selectedLinkIndex + 1 : selectedLinkIndex - 1);
        } else {
            // Enter link-navigation mode: pick the link nearest to current viewport
            const dir = (e.key === 'ArrowDown') ? 'down' : 'up';
            const nearest = findNearestLinkIndex(dir, links);
            if (nearest === -1) {
                // Fallback to first/last
                selectLink(e.key === 'ArrowDown' ? 0 : links.length - 1);
            } else {
                selectLink(nearest);
            }
        }
        return;
    }

    // 4. Arrow Navigation for Menus - MORE ROBUST
    if (isMenuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        e.stopPropagation();
        const items = Array.from(document.querySelectorAll('#option-menu .menu-item'));
        const current = document.activeElement;
        let i = items.indexOf(current);

        if (i === -1) {
            // If no item is focused, focus the first
            items[0].focus();
            return;
        }

        let next = (e.key === 'ArrowDown') ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        const nextItem = items[next];
        nextItem.focus();
        nextItem.scrollIntoView(false);
        return;
    }

    // 5. Main Controller
    switch (e.key) {
        case 'SoftLeft': case 'F1':
            e.preventDefault();
            if (!isMenuOpen && !isAboutOpen) toggleUrlBar();
            break;
        case 'SoftRight': case 'F2':
            e.preventDefault();
            if (!isUrlBarOpen && !isAboutOpen) {
                isMenuOpen ? closeMenu() : openMenu();
            }
            break;
        case 'Enter':
            e.preventDefault();
            if (isUrlBarOpen) {
                handleUrlSubmit();
            } else if (isMenuOpen) {
                handleMenuAction(document.activeElement.getAttribute('data-action'));
            } else if (!isMenuOpen && !isUrlBarOpen && !isAboutOpen && selectedLinkIndex !== -1) {
                // Open the currently selected link (sorted spatially)
                const links = getSortedLinks();
                const link = links[selectedLinkIndex];
                if (link && link.href) loadPage(link.href);
            } else if (document.activeElement && document.activeElement.tagName === 'A') {
                loadPage(document.activeElement.href);
            }
            break;
        case 'Escape':
            // Clear link selection to allow free scrolling, or close menu if open
            if (isMenuOpen) {
                e.preventDefault();
                closeMenu();
            } else if (selectedLinkIndex !== -1) {
                e.preventDefault();
                clearLinkSelection();
            }
            break;
        case 'Backspace':
            e.preventDefault();
            if (isMenuOpen) closeMenu();
            else if (historyStack.length > 0) loadPage(historyStack.pop(), true);
            else window.close();
            break;
    }
    updateSoftkeyLabels();
});

// --- UI UPDATER ---
function updateSoftkeyLabels() {
    const l = document.getElementById('lsk'),
        c = document.getElementById('csk'),
        r = document.getElementById('rsk');

    l.innerText = ""; c.innerText = ""; r.innerText = "";

    if (isAboutOpen) {
        c.innerText = "CLOSE";
    } else if (isUrlBarOpen) {
        l.innerText = "Cancel";
        c.innerText = "GO";
    } else if (isMenuOpen) {
        l.innerText = "";
        c.innerText = "SELECT";
        r.innerText = "Close";
    } else {
        l.innerText = "URL";
        // If a link is selected in the reader, offer OPEN on center softkey
        const readerHasSelectedLink = (selectedLinkIndex !== -1) || !!document.querySelector('#reader a.kai-link.link-selected') || (document.activeElement && document.activeElement.tagName === 'A' && document.activeElement.closest && document.activeElement.closest('#reader'));
        if (readerHasSelectedLink) {
            c.innerText = "OPEN";
            r.innerText = "Menu";
        } else {
            c.innerText = historyStack.length > 0 ? "BACK" : "";
            r.innerText = "Menu";
        }
    }
}

// --- SERVICE WORKER REGISTRATION (for offline support) ---
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./src/sw.js').catch(err => {
        console.log('Service Worker registration failed:', err);
    });
}

// --- FOCUS TRAP FOR MENU (Arrows stay within menu items) ---
function setupMenuFocusTrap() {
    const menu = document.getElementById('option-menu');
    if (!menu) return;

    menu.addEventListener('keydown', (e) => {
        if (!isMenuOpen) return;

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            // Only trap arrow keys, other keys bubble to main handler
            const items = Array.from(document.querySelectorAll('#option-menu .menu-item'));
            if (items.length === 0) return;

            const current = document.activeElement;
            const idx = items.indexOf(current);

            if (idx === -1) {
                items[0].focus();
                return;
            }

            e.preventDefault();
            e.stopPropagation(); // Stop bubble to main handler
            const next = (e.key === 'ArrowDown') ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
            items[next].focus();
            items[next].scrollIntoView(false);
        }
    }, false);
}

// --- INITIALIZE ---
window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('reader').className = 'text-' + currentSize;
    applyColorMode(colorMode);
    setupMenuFocusTrap();

    // Ensure reader gets initial focus
    document.getElementById('reader').focus();

    const lastUrl = getSafeLocalStorage('lastVisitedUrl', '');

    // Show welcome screen on first load or if no saved URL
    if (!lastUrl) {
        showWelcome();
    } else {
        loadPage(lastUrl);
    }
});

// Handle page unload to save state
window.addEventListener('beforeunload', () => {
    setSafeLocalStorage('lastVisitedUrl', currUrl);
});

// Click interceptor for the "Mouse" or virtual cursor
if (document.getElementById('reader')) {
    const reader = document.getElementById('reader');

    reader.addEventListener('click', (e) => {
        // Only allow clicking links when menu, URL bar, and about screen are closed
        if (isMenuOpen || isUrlBarOpen || isAboutOpen) {
            e.preventDefault();
            return;
        }
        const link = e.target.closest('a');
        if (link) {
            e.preventDefault();
            loadPage(link.href);
        }
    });

    // Ensure smooth scrolling at boundaries
    reader.addEventListener('scroll', (e) => {
        // Allow natural scroll behavior at all boundaries
        const maxScroll = reader.scrollHeight - reader.clientHeight;
        if (reader.scrollTop < 0) {
            reader.scrollTop = 0;
        } else if (reader.scrollTop > maxScroll) {
            reader.scrollTop = maxScroll;
        }
    });
}