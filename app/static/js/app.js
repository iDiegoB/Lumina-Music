/**
 * LUMINA MUSIC - CLIENT APPLICATION LOGIC
 * Progressive Web App & Cloud-Connected Player
 */

// --- API ENDPOINT RESOLVER (OPCIÓN A: SERVIDOR PYTHON EXTERNO EN RENDER / CLOUD) ---
function apiUrl(endpoint) {
    const base = (window.LUMINA_CONFIG && window.LUMINA_CONFIG.API_URL) ? window.LUMINA_CONFIG.API_URL.replace(/\/+$/, '') : '';
    return `${base}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;
}

// --- STATE MANAGEMENT ---
const state = {
    currentTrack: null,
    queue: [],
    queueIndex: -1,
    favorites: JSON.parse(localStorage.getItem('lumina_favorites') || '[]'),
    savedPlaylists: JSON.parse(localStorage.getItem('lumina_saved_playlists') || '[]'),
    currentPlaylist: null,
    playlistRenderIndex: 0,
    playlistChunkSize: 35,
    playlistObserver: null,
    isPlaying: false,
    isShuffle: false,
    repeatMode: 'off', // 'off', 'all', 'one'
    volume: parseFloat(localStorage.getItem('lumina_volume') || '0.8'),
    isMuted: false,
    gamerMode: false,
    cachedStreams: {}, // memory cache for stream URLs (capped to 50 items)
    currentView: 'explore',
    isSearching: false,
    lastSearchQuery: '',
    isFullscreenVisualizer: false,
    isMiniPlayer: false
};

// --- PERMANENT DISK / LOCALSTORAGE SYNCHRONIZATION ---
async function loadUserDataFromServer() {
    try {
        const res = await fetch(apiUrl('/api/user/data'));
        if (res.ok) {
            const data = await res.json();
            if (data) {
                if (Array.isArray(data.favorites)) state.favorites = data.favorites;
                if (Array.isArray(data.savedPlaylists)) state.savedPlaylists = data.savedPlaylists;
                if (typeof data.volume === 'number') {
                    state.volume = data.volume;
                    setVolume(state.volume);
                }
                if (typeof data.gamerMode === 'boolean') {
                    state.gamerMode = data.gamerMode;
                    applyGamerMode(state.gamerMode);
                }
                updateFavCount();
                updatePlaylistCount();
                if (state.currentView === 'favorites') renderFavorites();
                if (state.currentView === 'playlists') renderPlaylistsOverview();
            }
        }
    } catch (e) {
        console.warn('Could not load user data from backend:', e);
    }
}

let saveDebounceTimer = null;
function saveUserDataToServer() {
    clearTimeout(saveDebounceTimer);
    localStorage.setItem('lumina_favorites', JSON.stringify(state.favorites));
    localStorage.setItem('lumina_saved_playlists', JSON.stringify(state.savedPlaylists));
    localStorage.setItem('lumina_volume', state.volume.toString());
    localStorage.setItem('lumina_gamer_mode', state.gamerMode.toString());

    saveDebounceTimer = setTimeout(async () => {
        try {
            await fetch(apiUrl('/api/user/data'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    favorites: state.favorites,
                    savedPlaylists: state.savedPlaylists,
                    volume: state.volume,
                    gamerMode: state.gamerMode
                })
            });
        } catch (e) {
            console.warn('Error saving user data to backend:', e);
        }
    }, 400);
}

// --- DOM ELEMENTS ---
const elements = {
    // Window controls
    btnMinimize: document.getElementById('btn-minimize'),
    btnMaximize: document.getElementById('btn-maximize'),
    btnClose: document.getElementById('btn-close'),
    ramText: document.getElementById('ram-usage-text'),

    // Audio Engine
    audio: document.getElementById('audio-engine'),
    visualizer: document.getElementById('audio-visualizer'),

    // Player Elements
    playerBar: document.getElementById('player-bar'),
    playerCover: document.getElementById('player-cover'),
    playerTitle: document.getElementById('player-title'),
    playerArtist: document.getElementById('player-artist'),
    btnPlayPause: document.getElementById('btn-play-pause'),
    iconPlayPause: document.getElementById('icon-play-pause'),
    btnPrev: document.getElementById('btn-prev'),
    btnNext: document.getElementById('btn-next'),
    btnShuffle: document.getElementById('btn-shuffle'),
    btnRepeat: document.getElementById('btn-repeat'),
    btnToggleFav: document.getElementById('btn-toggle-favorite'),
    iconFav: document.getElementById('icon-fav'),

    // Progress
    progressTrack: document.getElementById('progress-track'),
    progressFill: document.getElementById('progress-fill'),
    progressThumb: document.getElementById('progress-thumb'),
    currentTime: document.getElementById('current-time'),
    totalDuration: document.getElementById('total-duration'),

    // Volume
    volumeTrack: document.getElementById('volume-track'),
    volumeFill: document.getElementById('volume-fill'),
    volumeThumb: document.getElementById('volume-thumb'),
    btnVolumeIcon: document.getElementById('btn-volume-icon'),
    iconVolume: document.getElementById('icon-volume'),

    // Navigation & Views
    navItems: document.querySelectorAll('.nav-item'),
    viewPanels: document.querySelectorAll('.view-panel'),
    favCountBadge: document.getElementById('fav-count'),
    queueCountBadge: document.getElementById('queue-count'),
    playlistCountBadge: document.getElementById('playlist-count'),

    // Search & Genres
    searchInput: document.getElementById('global-search-input'),
    searchClearBtn: document.getElementById('search-clear-btn'),
    genreChips: document.getElementById('genre-chips'),

    // Views Content Containers
    exploreSections: document.getElementById('explore-sections'),
    searchGrid: document.getElementById('search-grid'),
    searchSubtitle: document.getElementById('search-subtitle'),
    favoritesGrid: document.getElementById('favorites-grid'),
    favoritesEmpty: document.getElementById('favorites-empty'),
    queueList: document.getElementById('queue-list'),
    lyricsTitle: document.getElementById('lyrics-title'),
    lyricsArtist: document.getElementById('lyrics-artist'),
    lyricsContent: document.getElementById('lyrics-content'),
    lyricsSource: document.getElementById('lyrics-source'),

    // Playlist Elements
    playlistsGrid: document.getElementById('playlists-grid'),
    plDetailCover: document.getElementById('pl-detail-cover'),
    plDetailTitle: document.getElementById('pl-detail-title'),
    plDetailAuthor: document.getElementById('pl-detail-author'),
    plDetailCount: document.getElementById('pl-detail-count'),
    plTracksList: document.getElementById('pl-tracks-list'),
    plTracksSentinel: document.getElementById('pl-tracks-sentinel'),
    btnPlPlayAll: document.getElementById('btn-pl-play-all'),
    btnPlQueueAll: document.getElementById('btn-pl-queue-all'),
    btnPlSaveToggle: document.getElementById('btn-pl-save-toggle'),
    plSaveIcon: document.getElementById('pl-save-icon'),
    plSaveText: document.getElementById('pl-save-text'),
    btnPlLoadAll: document.getElementById('btn-pl-load-all'),
    inlinePlaylistInput: document.getElementById('inline-playlist-input'),
    btnInlineImport: document.getElementById('btn-inline-import'),

    // Import Modal
    modalImport: document.getElementById('modal-import-playlist'),
    btnOpenImportModal: document.getElementById('btn-open-import-modal'),
    btnPlaylistsImportTrigger: document.getElementById('btn-playlists-import-trigger'),
    btnCloseImportModal: document.getElementById('btn-close-import-modal'),
    btnCancelImportModal: document.getElementById('btn-cancel-import-modal'),
    btnSubmitImportModal: document.getElementById('btn-submit-import-modal'),
    modalPlaylistInput: document.getElementById('modal-playlist-input'),

    // Quick buttons & Ambient
    heroPlayRandom: document.getElementById('hero-play-random'),
    btnPlayAllFavs: document.getElementById('btn-play-all-favorites'),
    btnClearQueue: document.getElementById('btn-clear-queue'),
    btnToggleLyricsQuick: document.getElementById('btn-toggle-lyrics-quick'),
    btnToggleQueueQuick: document.getElementById('btn-toggle-queue-quick'),
    ambientGlow: document.getElementById('ambient-glow'),
    toastContainer: document.getElementById('toast-container'),

    // Viewing Modes & Toggles
    btnPlayerMini: document.getElementById('btn-player-mini'),
    btnHeaderMini: document.getElementById('btn-header-mini'),
    btnPlayerFullscreen: document.getElementById('btn-player-fullscreen'),

    // Fullscreen Song Visualizer Elements
    fullscreenVisualizer: document.getElementById('fullscreen-visualizer'),
    fsBackdrop: document.getElementById('fs-backdrop'),
    fsCover: document.getElementById('fs-cover'),
    fsTitle: document.getElementById('fs-title'),
    fsArtist: document.getElementById('fs-artist'),
    fsAlbum: document.getElementById('fs-album'),
    fsProgressTrack: document.getElementById('fs-progress-track'),
    fsProgressFill: document.getElementById('fs-progress-fill'),
    fsProgressThumb: document.getElementById('fs-progress-thumb'),
    fsCurrentTime: document.getElementById('fs-current-time'),
    fsTotalDuration: document.getElementById('fs-total-duration'),
    fsBtnPlayPause: document.getElementById('fs-btn-play-pause'),
    fsIconPlayPause: document.getElementById('fs-icon-play-pause'),
    fsBtnPrev: document.getElementById('fs-btn-prev'),
    fsBtnNext: document.getElementById('fs-btn-next'),
    fsBtnShuffle: document.getElementById('fs-btn-shuffle'),
    fsBtnRepeat: document.getElementById('fs-btn-repeat'),
    fsBtnFav: document.getElementById('fs-btn-fav'),
    fsIconFav: document.getElementById('fs-icon-fav'),
    fsBtnNativeFs: document.getElementById('fs-btn-native-fs'),
    fsBtnClose: document.getElementById('fs-btn-close'),

    // Mini Floating Player Elements
    miniPlayerContainer: document.getElementById('mini-player-container'),
    miniBgArt: document.getElementById('mini-bg-art'),
    btnMiniRestore: document.getElementById('btn-mini-restore'),
    btnMiniClose: document.getElementById('btn-mini-close'),
    miniCover: document.getElementById('mini-cover'),
    miniTitle: document.getElementById('mini-title'),
    miniArtist: document.getElementById('mini-artist'),
    miniProgressTrack: document.getElementById('mini-progress-track'),
    miniProgressFill: document.getElementById('mini-progress-fill'),
    miniProgressThumb: document.getElementById('mini-progress-thumb'),
    miniCurrentTime: document.getElementById('mini-current-time'),
    miniTotalDuration: document.getElementById('mini-total-duration'),
    miniBtnPrev: document.getElementById('mini-btn-prev'),
    miniBtnPlayPause: document.getElementById('mini-btn-play-pause'),
    miniIconPlayPause: document.getElementById('mini-icon-play-pause'),
    miniBtnNext: document.getElementById('mini-btn-next')
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    initLucide();
    setupEventListeners();
    setupAudioEvents();
    setupKeyboardShortcuts();
    setupMediaSession();
    setupPlaylistSentinel();
    setupGamerAndFocusListeners();
    
    // Apply initial volume & badges
    setVolume(state.volume);
    updateFavCount();
    updatePlaylistCount();
    
    // Load persisted user data from disk
    loadUserDataFromServer();

    // Load home content & start RAM monitor
    loadExploreContent();
    startSystemMonitor();
});

function initLucide() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// --- SYSTEM RAM MONITOR ---
function startSystemMonitor() {
    const updateStats = async () => {
        try {
            const res = await fetch(apiUrl('/api/system/stats'));
            const data = await res.json();
            if (data && data.ram_mb) {
                elements.ramText.textContent = `RAM: ${data.ram_mb} MB`;
            }
        } catch (e) {
            // Ignore polling errors
        }
    };
    updateStats();
    setInterval(updateStats, 4000);
}

// --- WINDOW CONTROLS & EVENT LISTENERS ---
function setupEventListeners() {
    // PWA Service Worker Registration
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').then((reg) => {
                console.log('LuminaMusic PWA ServiceWorker active:', reg.scope);
            }).catch((err) => {
                console.warn('PWA ServiceWorker notice:', err);
            });
        });
    }

    // PWA Install Prompt for Mobile and Supported Browsers
    let deferredInstallPrompt = null;
    const btnPwaInstall = document.getElementById('btn-pwa-install');
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        if (btnPwaInstall) {
            btnPwaInstall.style.display = 'inline-flex';
            btnPwaInstall.addEventListener('click', async () => {
                if (deferredInstallPrompt) {
                    deferredInstallPrompt.prompt();
                    const { outcome } = await deferredInstallPrompt.userChoice;
                    console.log('PWA installation outcome:', outcome);
                    deferredInstallPrompt = null;
                    btnPwaInstall.style.display = 'none';
                }
            });
        }
    });

    window.addEventListener('appinstalled', () => {
        if (btnPwaInstall) btnPwaInstall.style.display = 'none';
        showToast('¡LuminaMusic se instaló en tu dispositivo!', 'info');
    });

    // Mobile Bottom Navigation Tabs
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
    mobileNavItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetView = item.getAttribute('data-view');
            switchView(targetView);
        });
    });

    // Mobile Player Bar click opens Fullscreen Visualizer
    const playerLeft = document.querySelector('.player-left');
    if (playerLeft) {
        playerLeft.addEventListener('click', (e) => {
            if (e.target.closest('#btn-toggle-favorite')) return;
            if (window.innerWidth <= 768) {
                toggleFullscreenVisualizer(true);
            }
        });
    }

    const btnQuickImport = document.getElementById('btn-quick-import');
    if (btnQuickImport) {
        btnQuickImport.addEventListener('click', openImportModal);
    }

    const btnGamerMode = document.getElementById('btn-gamer-mode');
    if (btnGamerMode) {
        btnGamerMode.addEventListener('click', toggleGamerMode);
    }

    // Desktop Navigation tabs
    elements.navItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetView = item.getAttribute('data-view');
            switchView(targetView);
        });
    });

    // Global Search Bar with smart Playlist URL detection
    let searchTimeout = null;
    elements.searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        elements.searchClearBtn.style.display = query ? 'flex' : 'none';

        clearTimeout(searchTimeout);
        // Instant check: if user pastes a playlist link, load it immediately!
        if (query.includes('list=') || (query.length > 20 && (query.startsWith('PL') || query.startsWith('RD') || query.startsWith('http')))) {
            loadPlaylist(query);
            return;
        }

        if (query.length >= 2) {
            searchTimeout = setTimeout(() => {
                performSearch(query);
            }, 380);
        }
    });

    elements.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const query = elements.searchInput.value.trim();
            if (query) {
                clearTimeout(searchTimeout);
                if (query.includes('list=') || query.startsWith('PL')) {
                    loadPlaylist(query);
                } else {
                    performSearch(query);
                }
            }
        }
    });

    elements.searchClearBtn.addEventListener('click', () => {
        elements.searchInput.value = '';
        elements.searchClearBtn.style.display = 'none';
        elements.searchInput.focus();
    });

    // Category / Genre chips
    elements.genreChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip-btn');
        if (!chip) return;

        document.querySelectorAll('.chip-btn').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');

        const cat = chip.getAttribute('data-category');
        if (cat === 'trending') {
            switchView('explore');
        } else {
            const queryMap = {
                'pop': 'Top Pop Hits 2026',
                'rock': 'Mejor Rock Internacional',
                'latino': 'Éxitos Latinos Reggaeton Pop',
                'lofi': 'Lo-Fi Chill Beats',
                'electronic': 'Electronic Dance Synthwave'
            };
            const q = queryMap[cat] || cat;
            elements.searchInput.value = q;
            elements.searchClearBtn.style.display = 'flex';
            performSearch(q);
        }
    });

    // Playback control buttons
    elements.btnPlayPause.addEventListener('click', togglePlayPause);
    elements.btnPrev.addEventListener('click', playPrevious);
    elements.btnNext.addEventListener('click', playNext);
    elements.btnShuffle.addEventListener('click', toggleShuffle);
    elements.btnRepeat.addEventListener('click', toggleRepeat);
    elements.btnToggleFav.addEventListener('click', toggleCurrentFavorite);

    // Universal Progress Bar scrub (Main Player, Fullscreen Visualizer, Mini Player)
    const bindTrackScrubber = (trackEl) => {
        if (!trackEl) return;
        let isScrubbing = false;
        const doScrub = (e) => {
            const rect = trackEl.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            if (elements.audio.duration) {
                elements.audio.currentTime = percent * elements.audio.duration;
                updateProgressUI(percent * elements.audio.duration, elements.audio.duration);
            }
        };

        trackEl.addEventListener('mousedown', (e) => {
            isScrubbing = true;
            doScrub(e);
            const onMouseMove = (ev) => {
                if (isScrubbing) doScrub(ev);
            };
            const onMouseUp = () => {
                isScrubbing = false;
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    };

    bindTrackScrubber(elements.progressTrack);
    bindTrackScrubber(elements.fsProgressTrack);
    bindTrackScrubber(elements.miniProgressTrack);

    // Mode Toggle Buttons
    if (elements.btnPlayerMini) elements.btnPlayerMini.addEventListener('click', toggleMiniPlayer);
    if (elements.btnHeaderMini) elements.btnHeaderMini.addEventListener('click', toggleMiniPlayer);
    if (elements.btnMiniRestore) elements.btnMiniRestore.addEventListener('click', toggleMiniPlayer);
    if (elements.btnPlayerFullscreen) elements.btnPlayerFullscreen.addEventListener('click', () => toggleFullscreenVisualizer(true));
    if (elements.playerCover) elements.playerCover.addEventListener('click', () => toggleFullscreenVisualizer(true));

    // Fullscreen Song Visualizer Controls
    if (elements.fsBtnClose) elements.fsBtnClose.addEventListener('click', () => toggleFullscreenVisualizer(false));
    if (elements.fsBtnNativeFs) elements.fsBtnNativeFs.addEventListener('click', toggleNativeFullscreen);
    if (elements.fsBtnPlayPause) elements.fsBtnPlayPause.addEventListener('click', togglePlayPause);
    if (elements.fsBtnPrev) elements.fsBtnPrev.addEventListener('click', playPrevious);
    if (elements.fsBtnNext) elements.fsBtnNext.addEventListener('click', playNext);
    if (elements.fsBtnShuffle) elements.fsBtnShuffle.addEventListener('click', toggleShuffle);
    if (elements.fsBtnRepeat) elements.fsBtnRepeat.addEventListener('click', toggleRepeat);
    if (elements.fsBtnFav) elements.fsBtnFav.addEventListener('click', toggleCurrentFavorite);

    // Mini Floating Player Controls
    if (elements.btnMiniClose) {
        elements.btnMiniClose.addEventListener('click', () => {
            if (window.pywebview && window.pywebview.api && window.pywebview.api.close) {
                window.pywebview.api.close();
            } else {
                window.close();
            }
        });
    }
    if (elements.miniBtnPlayPause) elements.miniBtnPlayPause.addEventListener('click', togglePlayPause);
    if (elements.miniBtnPrev) elements.miniBtnPrev.addEventListener('click', playPrevious);
    if (elements.miniBtnNext) elements.miniBtnNext.addEventListener('click', playNext);

    // Smooth Pointer Drag for frameless floating mini player across monitors
    if (elements.miniPlayerContainer) {
        let isMiniDragging = false;
        let lastScreenX = 0;
        let lastScreenY = 0;
        let accumulatedDx = 0;
        let accumulatedDy = 0;
        let dragRafId = null;

        const flushMiniDrag = () => {
            dragRafId = null;
            if (!isMiniDragging && accumulatedDx === 0 && accumulatedDy === 0) return;
            const toMoveX = accumulatedDx;
            const toMoveY = accumulatedDy;
            accumulatedDx = 0;
            accumulatedDy = 0;
            if ((toMoveX !== 0 || toMoveY !== 0) && window.pywebview && window.pywebview.api && window.pywebview.api.move_by) {
                window.pywebview.api.move_by(toMoveX, toMoveY);
            }
            if (isMiniDragging) {
                dragRafId = requestAnimationFrame(flushMiniDrag);
            }
        };

        elements.miniPlayerContainer.addEventListener('pointerdown', (e) => {
            if (!state.isMiniPlayer || e.button !== 0) return;
            if (e.target.closest('button, .mini-progress-track, .mini-ctrl-btn, .mini-play-btn, .mini-action-btn')) {
                return;
            }
            isMiniDragging = true;
            elements.miniPlayerContainer.classList.add('is-dragging');
            lastScreenX = e.screenX;
            lastScreenY = e.screenY;
            accumulatedDx = 0;
            accumulatedDy = 0;
            try {
                elements.miniPlayerContainer.setPointerCapture(e.pointerId);
            } catch (_) {}

            if (window.pywebview && window.pywebview.api && window.pywebview.api.start_drag_session) {
                window.pywebview.api.start_drag_session();
            }

            if (!dragRafId) {
                dragRafId = requestAnimationFrame(flushMiniDrag);
            }
        });

        elements.miniPlayerContainer.addEventListener('pointermove', (e) => {
            if (!isMiniDragging || !state.isMiniPlayer) return;
            const scale = window.devicePixelRatio || 1;
            const dx = (e.screenX - lastScreenX) * scale;
            const dy = (e.screenY - lastScreenY) * scale;
            lastScreenX = e.screenX;
            lastScreenY = e.screenY;
            accumulatedDx += dx;
            accumulatedDy += dy;
        });

        const stopMiniDrag = (e) => {
            if (isMiniDragging) {
                isMiniDragging = false;
                elements.miniPlayerContainer.classList.remove('is-dragging');
                try {
                    elements.miniPlayerContainer.releasePointerCapture(e.pointerId);
                } catch (_) {}
                if (dragRafId) {
                    cancelAnimationFrame(dragRafId);
                    dragRafId = null;
                }
                flushMiniDrag();
                if (window.pywebview && window.pywebview.api && window.pywebview.api.end_drag_session) {
                    window.pywebview.api.end_drag_session();
                }
            }
        };

        elements.miniPlayerContainer.addEventListener('pointerup', stopMiniDrag);
        elements.miniPlayerContainer.addEventListener('pointercancel', stopMiniDrag);
    }

    // Volume Bar scrub
    const handleVolumeScrub = (e) => {
        const rect = elements.volumeTrack.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setVolume(percent);
    };

    elements.volumeTrack.addEventListener('mousedown', (e) => {
        handleVolumeScrub(e);
        const onMouseMove = (ev) => handleVolumeScrub(ev);
        const onMouseUp = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    });

    elements.btnVolumeIcon.addEventListener('click', toggleMute);

    // Quick Action buttons
    elements.btnToggleLyricsQuick.addEventListener('click', () => switchView('lyrics'));
    elements.btnToggleQueueQuick.addEventListener('click', () => switchView('queue'));
    elements.btnClearQueue.addEventListener('click', clearQueue);
    elements.btnPlayAllFavs.addEventListener('click', playAllFavorites);
    elements.heroPlayRandom.addEventListener('click', () => {
        const firstSection = elements.exploreSections.querySelector('.songs-grid');
        if (firstSection && firstSection.children.length > 0) {
            const firstCard = firstSection.children[0];
            firstCard.click();
        }
    });

    // Playlist Modal events
    elements.btnOpenImportModal.addEventListener('click', openImportModal);
    if (elements.btnPlaylistsImportTrigger) {
        elements.btnPlaylistsImportTrigger.addEventListener('click', openImportModal);
    }
    elements.btnCloseImportModal.addEventListener('click', closeImportModal);
    elements.btnCancelImportModal.addEventListener('click', closeImportModal);
    elements.btnSubmitImportModal.addEventListener('click', () => {
        const val = elements.modalPlaylistInput.value.trim();
        if (val) {
            closeImportModal();
            loadPlaylist(val);
        } else {
            showToast('Por favor pega un enlace de playlist válido', 'error');
        }
    });
    elements.modalPlaylistInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const val = elements.modalPlaylistInput.value.trim();
            if (val) {
                closeImportModal();
                loadPlaylist(val);
            }
        }
    });

    // Inline playlist import
    if (elements.btnInlineImport) {
        elements.btnInlineImport.addEventListener('click', () => {
            const val = elements.inlinePlaylistInput.value.trim();
            if (val) {
                elements.inlinePlaylistInput.value = '';
                loadPlaylist(val);
            }
        });
    }

    // Playlist Detail View action buttons
    elements.btnPlPlayAll.addEventListener('click', playAllPlaylistTracks);
    elements.btnPlQueueAll.addEventListener('click', queueAllPlaylistTracks);
    elements.btnPlSaveToggle.addEventListener('click', toggleSaveCurrentPlaylist);
    elements.btnPlLoadAll.addEventListener('click', () => {
        if (state.currentPlaylist && state.currentPlaylist.id) {
            loadPlaylist(state.currentPlaylist.id, 'all');
        }
    });
}

// --- MODAL CONTROLS ---
function openImportModal() {
    elements.modalImport.style.display = 'flex';
    elements.modalPlaylistInput.value = '';
    setTimeout(() => elements.modalPlaylistInput.focus(), 50);
}

function closeImportModal() {
    elements.modalImport.style.display = 'none';
}

// --- FULLSCREEN VISUALIZER & MINI FLOATING PLAYER CONTROLS ---
function toggleFullscreenVisualizer(show) {
    if (show === undefined) show = !state.isFullscreenVisualizer;
    state.isFullscreenVisualizer = show;

    if (elements.fullscreenVisualizer) {
        elements.fullscreenVisualizer.style.display = show ? 'flex' : 'none';
    }

    if (show && state.currentTrack) {
        updateVisualizerUI(state.currentTrack);
        if (elements.audio.duration) {
            updateProgressUI(elements.audio.currentTime, elements.audio.duration);
        }
        updatePlayPauseUI(state.isPlaying);
    }
    initLucide();
}

function toggleNativeFullscreen() {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.toggle_fullscreen) {
        window.pywebview.api.toggle_fullscreen();
    } else if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
    } else {
        document.documentElement.requestFullscreen().catch(() => {});
    }
}

async function toggleMiniPlayer() {
    if (state.isFullscreenVisualizer) {
        toggleFullscreenVisualizer(false);
    }

    let isMini = !state.isMiniPlayer;
    if (window.pywebview && window.pywebview.api && window.pywebview.api.toggle_mini_player) {
        try {
            isMini = await window.pywebview.api.toggle_mini_player();
        } catch (e) {
            console.warn('pywebview toggle_mini_player error:', e);
        }
    }

    state.isMiniPlayer = !!isMini;
    document.body.classList.toggle('mini-player-mode', state.isMiniPlayer);

    if (state.currentTrack) {
        if (state.isMiniPlayer) {
            updateMiniPlayerUI(state.currentTrack);
        } else {
            updatePlayerUI(state.currentTrack);
        }
        if (elements.audio.duration) {
            updateProgressUI(elements.audio.currentTime, elements.audio.duration);
        }
        updatePlayPauseUI(state.isPlaying);
    }
    initLucide();
}

function updateVisualizerUI(track) {
    if (!track || !elements.fullscreenVisualizer) return;
    if (elements.fsCover) elements.fsCover.src = track.thumbnail;
    if (elements.fsTitle) elements.fsTitle.textContent = track.title;
    if (elements.fsArtist) elements.fsArtist.textContent = track.artist;
    if (elements.fsAlbum) elements.fsAlbum.textContent = track.album || 'YouTube Music';
    if (elements.fsBackdrop) {
        elements.fsBackdrop.style.backgroundImage = `url('${track.thumbnail}')`;
    }
    const isFav = state.favorites.some(f => f.id === track.id);
    if (elements.fsBtnFav) elements.fsBtnFav.classList.toggle('active', isFav);
    if (elements.fsIconFav) elements.fsIconFav.classList.toggle('fill-current', isFav);
    if (elements.fsBtnShuffle) elements.fsBtnShuffle.classList.toggle('active', state.isShuffle);
    if (elements.fsBtnRepeat) elements.fsBtnRepeat.classList.toggle('active', state.repeatMode !== 'off');
}

function updateMiniPlayerUI(track) {
    if (!track || !elements.miniPlayerContainer) return;
    if (elements.miniCover) elements.miniCover.src = track.thumbnail;
    if (elements.miniTitle) elements.miniTitle.textContent = track.title;
    if (elements.miniArtist) elements.miniArtist.textContent = track.artist;
    if (elements.miniBgArt) {
        elements.miniBgArt.style.backgroundImage = `url('${track.thumbnail}')`;
    }
}

// --- VIEW NAVIGATION ---
function switchView(viewName) {
    state.currentView = viewName;
    elements.navItems.forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-view') === viewName);
    });

    const mobileNavItems = document.querySelectorAll('.mobile-nav-item');
    mobileNavItems.forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-view') === viewName);
    });

    elements.viewPanels.forEach(panel => {
        panel.classList.toggle('active', panel.id === `view-${viewName}`);
    });

    if (viewName === 'favorites') {
        renderFavorites();
    } else if (viewName === 'queue') {
        renderQueue();
    } else if (viewName === 'lyrics') {
        loadLyricsForCurrentTrack();
    } else if (viewName === 'playlists') {
        renderPlaylistsOverview();
    }

    initLucide();
}

// --- PLAYLIST IMPORT & PROGRESSIVE RENDERING (MEMORY OPTIMIZED) ---
async function loadPlaylist(urlOrId, limit = '200') {
    switchView('playlist-detail');
    showToast('Cargando playlist de YouTube Music...', 'info');

    elements.plDetailTitle.textContent = 'Cargando playlist...';
    elements.plDetailAuthor.textContent = 'Conectando con YouTube Music';
    elements.plDetailCount.textContent = '...';
    elements.plTracksList.innerHTML = `
        <div class="section-loader" style="padding: 60px 0;">
            <div class="spinner"></div>
            <span>Extrayendo canciones y carátulas de la playlist...</span>
        </div>
    `;

    try {
        const res = await fetch(apiUrl(`/api/playlist?url=${encodeURIComponent(urlOrId)}&limit=${limit}`));
        if (!res.ok) throw new Error('No se pudo cargar la playlist.');
        const data = await res.json();

        state.currentPlaylist = data;
        state.playlistRenderIndex = 0;

        // Update Header UI
        elements.plDetailCover.src = data.thumbnail || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400';
        elements.plDetailTitle.textContent = data.title;
        elements.plDetailAuthor.textContent = data.author ? `Por ${data.author}` : 'YouTube Music';
        elements.plDetailCount.textContent = `${data.trackCount} canciones cargadas`;

        // Check if saved
        const isSaved = state.savedPlaylists.some(p => p.id === data.id);
        updateSavePlaylistBtn(isSaved);

        // Render first chunk of tracks
        elements.plTracksList.innerHTML = '';
        renderNextPlaylistChunk();
        showToast(`Playlist cargada: ${data.title} (${data.tracks.length} canciones)`);
        initLucide();
    } catch (err) {
        console.error('Error loading playlist:', err);
        elements.plTracksList.innerHTML = `
            <div class="empty-state">
                <i data-lucide="alert-triangle" class="empty-icon"></i>
                <h3>No se pudo cargar la playlist</h3>
                <p>Verifica que el enlace sea correcto y que la playlist sea pública o no listada.</p>
            </div>
        `;
        showToast('Error al importar playlist. Revisa el enlace.', 'error');
        initLucide();
    }
}

// Progressive chunk renderer to keep DOM & RAM footprint ultra low!
function renderNextPlaylistChunk() {
    if (!state.currentPlaylist || !state.currentPlaylist.tracks) return;

    const tracks = state.currentPlaylist.tracks;
    const start = state.playlistRenderIndex;
    const end = Math.min(start + state.playlistChunkSize, tracks.length);

    for (let i = start; i < end; i++) {
        const track = tracks[i];
        const row = createPlaylistTrackRow(track, i + 1);
        elements.plTracksList.appendChild(row);
    }

    state.playlistRenderIndex = end;
    initLucide();
}

function setupPlaylistSentinel() {
    // Observer triggered when user scrolls near the bottom of playlist
    if ('IntersectionObserver' in window) {
        state.playlistObserver = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                if (state.currentPlaylist && state.playlistRenderIndex < state.currentPlaylist.tracks.length) {
                    renderNextPlaylistChunk();
                }
            }
        }, { rootMargin: '300px' });

        if (elements.plTracksSentinel) {
            state.playlistObserver.observe(elements.plTracksSentinel);
        }
    }
}

function createPlaylistTrackRow(track, index) {
    const row = document.createElement('div');
    row.className = 'playlist-track-row';
    const isFav = state.favorites.some(f => f.id === track.id);
    const isCurrent = state.currentTrack && state.currentTrack.id === track.id;
    if (isCurrent) row.classList.add('active');

    row.innerHTML = `
        <span class="row-index">${isCurrent ? '▶' : index}</span>
        <img src="${track.thumbnail}" alt="" class="row-thumb" loading="lazy">
        <div class="row-info">
            <div class="row-title">${escapeHtml(track.title)}</div>
            <div class="row-artist">${escapeHtml(track.artist)}</div>
        </div>
        <div class="row-album">${escapeHtml(track.album || '')}</div>
        <div class="row-duration">${track.duration || '--:--'}</div>
        <div class="row-actions">
            <button class="card-action-btn ${isFav ? 'active' : ''} row-fav-btn" title="Favorito">
                <i data-lucide="heart" class="${isFav ? 'fill-current' : ''}"></i>
            </button>
            <button class="card-action-btn row-queue-btn" title="Añadir a la cola">
                <i data-lucide="plus"></i>
            </button>
        </div>
    `;

    row.addEventListener('click', (e) => {
        if (e.target.closest('.row-fav-btn') || e.target.closest('.row-queue-btn')) return;
        playTrack(track, false);
    });

    const favBtn = row.querySelector('.row-fav-btn');
    favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavoriteTrack(track);
        const nowFav = state.favorites.some(f => f.id === track.id);
        favBtn.classList.toggle('active', nowFav);
        const heart = favBtn.querySelector('i');
        if (heart) heart.classList.toggle('fill-current', nowFav);
    });

    const queueBtn = row.querySelector('.row-queue-btn');
    queueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addToQueue(track);
        showToast(`Añadida a la cola: ${track.title}`);
    });

    return row;
}

function playAllPlaylistTracks() {
    if (!state.currentPlaylist || !state.currentPlaylist.tracks.length) return;
    state.queue = [...state.currentPlaylist.tracks];
    state.queueIndex = 0;
    updateQueueBadge();
    playTrack(state.queue[0], false);
    showToast(`Reproduciendo playlist (${state.queue.length} canciones)`);
}

function queueAllPlaylistTracks() {
    if (!state.currentPlaylist || !state.currentPlaylist.tracks.length) return;
    state.currentPlaylist.tracks.forEach(t => {
        if (!state.queue.some(q => q.id === t.id)) {
            state.queue.push(t);
        }
    });
    updateQueueBadge();
    showToast(`Se agregaron ${state.currentPlaylist.tracks.length} canciones a la cola`);
}

function toggleSaveCurrentPlaylist() {
    if (!state.currentPlaylist) return;
    const pl = state.currentPlaylist;
    const idx = state.savedPlaylists.findIndex(p => p.id === pl.id);

    if (idx >= 0) {
        state.savedPlaylists.splice(idx, 1);
        updateSavePlaylistBtn(false);
        showToast('Playlist eliminada de tu biblioteca');
    } else {
        state.savedPlaylists.unshift({
            id: pl.id,
            title: pl.title,
            thumbnail: pl.thumbnail,
            trackCount: pl.trackCount,
            author: pl.author
        });
        updateSavePlaylistBtn(true);
        showToast('Playlist guardada en tu biblioteca ⭐');
    }

    localStorage.setItem('lumina_saved_playlists', JSON.stringify(state.savedPlaylists));
    saveUserDataToServer();
    updatePlaylistCount();
}

function updateSavePlaylistBtn(isSaved) {
    if (elements.btnPlSaveToggle) {
        elements.plSaveText.textContent = isSaved ? 'Guardada en Playlists' : 'Guardar Playlist';
        elements.btnPlSaveToggle.classList.toggle('active', isSaved);
        if (elements.plSaveIcon) {
            elements.plSaveIcon.classList.toggle('fill-current', isSaved);
        }
    }
}

function updatePlaylistCount() {
    if (elements.playlistCountBadge) {
        elements.playlistCountBadge.textContent = state.savedPlaylists.length;
    }
}

function renderPlaylistsOverview() {
    elements.playlistsGrid.innerHTML = '';
    if (state.savedPlaylists.length === 0) {
        elements.playlistsGrid.innerHTML = `
            <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 0;">
                <i data-lucide="library" class="empty-icon"></i>
                <h3>No tienes playlists guardadas</h3>
                <p>Pega el enlace de cualquier playlist arriba para importarla y guardarla aquí.</p>
            </div>
        `;
        initLucide();
        return;
    }

    state.savedPlaylists.forEach(pl => {
        const card = document.createElement('div');
        card.className = 'playlist-card';
        card.innerHTML = `
            <div class="playlist-thumb-box">
                <img src="${pl.thumbnail}" alt="" class="playlist-thumb-img" loading="lazy">
                <div class="card-overlay">
                    <button class="card-play-btn" title="Abrir playlist">
                        <i data-lucide="play" class="fill-current"></i>
                    </button>
                </div>
            </div>
            <div class="playlist-card-title">${escapeHtml(pl.title)}</div>
            <div class="playlist-card-meta">${pl.trackCount || 0} canciones ${pl.author ? '• ' + escapeHtml(pl.author) : ''}</div>
        `;
        card.addEventListener('click', () => loadPlaylist(pl.id));
        elements.playlistsGrid.appendChild(card);
    });
    initLucide();
}

// --- EXPLORE / HOME VIEW LOADER ---
async function loadExploreContent() {
    try {
        const res = await fetch(apiUrl('/api/explore'));
        const data = await res.json();
        
        elements.exploreSections.innerHTML = '';
        if (data.sections && data.sections.length > 0) {
            data.sections.forEach(section => {
                const sectionEl = document.createElement('div');
                sectionEl.className = 'explore-section-block';
                sectionEl.innerHTML = `
                    <div class="panel-header" style="margin-bottom: 14px;">
                        <div>
                            <h2 class="section-title">${section.title}</h2>
                            <p class="section-subtitle">${section.description}</p>
                        </div>
                    </div>
                    <div class="songs-grid"></div>
                `;
                const grid = sectionEl.querySelector('.songs-grid');
                section.items.forEach(track => {
                    grid.appendChild(createSongCard(track));
                });
                elements.exploreSections.appendChild(sectionEl);
            });
        }
        initLucide();
    } catch (e) {
        console.error('Error loading explore:', e);
        elements.exploreSections.innerHTML = `
            <div class="empty-state">
                <i data-lucide="wifi-off" class="empty-icon"></i>
                <h3>Error al cargar recomendaciones</h3>
                <p>Verifica tu conexión a internet o intenta buscar directamente arriba.</p>
            </div>
        `;
        initLucide();
    }
}

// --- SEARCH ---
async function performSearch(query) {
    switchView('search');
    elements.searchSubtitle.textContent = `Buscando "${query}"...`;
    elements.searchGrid.innerHTML = `
        <div class="section-loader" style="grid-column: 1 / -1;">
            <div class="spinner"></div>
            <span>Buscando en YouTube Music...</span>
        </div>
    `;

    try {
        const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(query)}`));
        const data = await res.json();

        // If backend recognized this as a playlist, redirect to playlist detail!
        if (data.is_playlist && data.playlist_id) {
            loadPlaylist(data.playlist_id);
            return;
        }

        elements.searchGrid.innerHTML = '';
        if (data.results && data.results.length > 0) {
            elements.searchSubtitle.textContent = `${data.results.length} resultados para "${query}"`;
            data.results.forEach(track => {
                elements.searchGrid.appendChild(createSongCard(track));
            });
        } else {
            elements.searchSubtitle.textContent = `No se encontraron resultados para "${query}"`;
            elements.searchGrid.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1;">
                    <i data-lucide="music-2" class="empty-icon"></i>
                    <h3>No encontramos coincidencias</h3>
                    <p>Prueba con otros términos de búsqueda.</p>
                </div>
            `;
        }
        initLucide();
    } catch (e) {
        console.error('Search error:', e);
        elements.searchSubtitle.textContent = 'Ocurrió un error al realizar la búsqueda';
    }
}

// --- CARD COMPONENT CREATION ---
function createSongCard(track) {
    const card = document.createElement('div');
    card.className = 'song-card';
    const isFav = state.favorites.some(f => f.id === track.id);

    card.innerHTML = `
        <div class="card-thumb-wrapper">
            <img src="${track.thumbnail}" alt="${escapeHtml(track.title)}" class="card-thumb" loading="lazy">
            <div class="card-overlay">
                <button class="card-play-btn" title="Reproducir ahora">
                    <i data-lucide="play" class="fill-current"></i>
                </button>
            </div>
        </div>
        <div class="card-meta">
            <div class="card-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
            <div class="card-artist" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</div>
        </div>
        <div class="card-footer">
            <span class="card-duration">${track.duration}</span>
            <div class="card-actions">
                <button class="card-action-btn ${isFav ? 'active' : ''} btn-card-fav" title="Favorito">
                    <i data-lucide="heart" class="${isFav ? 'fill-current' : ''}"></i>
                </button>
                <button class="card-action-btn btn-card-queue" title="Añadir a la cola">
                    <i data-lucide="plus"></i>
                </button>
            </div>
        </div>
    `;

    card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-card-fav') || e.target.closest('.btn-card-queue')) return;
        playTrack(track, true);
    });

    const favBtn = card.querySelector('.btn-card-fav');
    favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavoriteTrack(track);
        const nowFav = state.favorites.some(f => f.id === track.id);
        favBtn.classList.toggle('active', nowFav);
        const heartIcon = favBtn.querySelector('i');
        if (heartIcon) heartIcon.classList.toggle('fill-current', nowFav);
    });

    const queueBtn = card.querySelector('.btn-card-queue');
    queueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addToQueue(track);
        showToast(`Añadida a la cola: ${track.title}`);
    });

    return card;
}

// --- AUDIO PLAYBACK ENGINE ---
async function playTrack(track, resetQueue = false) {
    if (!track || !track.id) return;

    state.currentTrack = track;
    updatePlayerUI(track);
    showToast(`Cargando: ${track.title}...`);

    if (resetQueue) {
        state.queue = [track];
        state.queueIndex = 0;
        updateQueueBadge();
        fetchRelatedTracksForQueue(track.id);
    }

    try {
        let streamUrl = state.cachedStreams[track.id];
        if (!streamUrl) {
            const res = await fetch(apiUrl(`/api/stream?id=${encodeURIComponent(track.id)}`));
            if (!res.ok) throw new Error('No se pudo obtener el audio');
            const data = await res.json();
            streamUrl = data.url;
            
            // Cap memory cache to 50 items to avoid RAM growth
            if (Object.keys(state.cachedStreams).length > 50) {
                state.cachedStreams = {};
            }
            state.cachedStreams[track.id] = streamUrl;
        }

        elements.audio.src = streamUrl;
        elements.audio.load();
        const playPromise = elements.audio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                state.isPlaying = true;
                updatePlayPauseUI(true);
                updateAmbientColor(track);
                updateMediaSessionMetadata(track);
            }).catch(err => {
                console.warn('Playback autoplay error:', err);
            });
        }
    } catch (err) {
        console.error('Audio playback error:', err);
        showToast('Error al reproducir audio. Saltando a la siguiente...', 'error');
        setTimeout(playNext, 1200);
    }
}

function togglePlayPause() {
    if (!state.currentTrack) return;

    if (elements.audio.paused) {
        elements.audio.play();
        state.isPlaying = true;
        updatePlayPauseUI(true);
    } else {
        elements.audio.pause();
        state.isPlaying = false;
        updatePlayPauseUI(false);
    }
}

function updatePlayPauseUI(isPlaying) {
    elements.visualizer.classList.toggle('playing', isPlaying);
    elements.btnPlayPause.classList.toggle('playing', isPlaying);
    elements.btnPlayPause.innerHTML = isPlaying 
        ? '<i data-lucide="pause" class="fill-current"></i>' 
        : '<i data-lucide="play" class="fill-current"></i>';

    if (elements.fsBtnPlayPause) {
        elements.fsBtnPlayPause.innerHTML = isPlaying 
            ? '<i data-lucide="pause" class="fill-current"></i>' 
            : '<i data-lucide="play" class="fill-current"></i>';
    }

    if (elements.miniBtnPlayPause) {
        elements.miniBtnPlayPause.innerHTML = isPlaying 
            ? '<i data-lucide="pause" class="fill-current"></i>' 
            : '<i data-lucide="play" class="fill-current"></i>';
    }

    initLucide();
}

function playNext() {
    if (state.queue.length === 0) return;

    if (state.isShuffle) {
        state.queueIndex = Math.floor(Math.random() * state.queue.length);
    } else {
        state.queueIndex++;
        if (state.queueIndex >= state.queue.length) {
            if (state.repeatMode === 'all') {
                state.queueIndex = 0;
            } else {
                state.queueIndex = state.queue.length - 1;
                return;
            }
        }
    }

    const nextTrack = state.queue[state.queueIndex];
    if (nextTrack) {
        playTrack(nextTrack, false);
    }
}

function playPrevious() {
    if (elements.audio.currentTime > 3) {
        elements.audio.currentTime = 0;
        return;
    }

    if (state.queue.length === 0) return;
    state.queueIndex--;
    if (state.queueIndex < 0) {
        state.queueIndex = state.queue.length - 1;
    }
    const prevTrack = state.queue[state.queueIndex];
    if (prevTrack) {
        playTrack(prevTrack, false);
    }
}

function toggleShuffle() {
    state.isShuffle = !state.isShuffle;
    elements.btnShuffle.classList.toggle('active', state.isShuffle);
    if (elements.fsBtnShuffle) elements.fsBtnShuffle.classList.toggle('active', state.isShuffle);
    showToast(state.isShuffle ? 'Modo aleatorio activado' : 'Modo aleatorio desactivado');
}

function toggleRepeat() {
    const modes = ['off', 'all', 'one'];
    const nextIdx = (modes.indexOf(state.repeatMode) + 1) % modes.length;
    state.repeatMode = modes[nextIdx];

    const isRepeatOn = state.repeatMode !== 'off';
    elements.btnRepeat.classList.toggle('active', isRepeatOn);
    if (elements.fsBtnRepeat) elements.fsBtnRepeat.classList.toggle('active', isRepeatOn);

    let iconName = 'repeat';
    let toastMsg = 'Repetición desactivada';
    if (state.repeatMode === 'one') {
        iconName = 'repeat-1';
        toastMsg = 'Repetir una canción';
    } else if (state.repeatMode === 'all') {
        toastMsg = 'Repetir lista completa';
    }

    elements.btnRepeat.innerHTML = `<i data-lucide="${iconName}"></i>`;
    if (elements.fsBtnRepeat) elements.fsBtnRepeat.innerHTML = `<i data-lucide="${iconName}"></i>`;
    showToast(toastMsg);
    initLucide();
}

// --- AUDIO EVENTS ---
function setupAudioEvents() {
    elements.audio.addEventListener('timeupdate', () => {
        if (!elements.audio.duration) return;
        const current = elements.audio.currentTime;
        const duration = elements.audio.duration;
        updateProgressUI(current, duration);

        if (duration - current < 15 && state.queue.length > state.queueIndex + 1) {
            const nextTrack = state.queue[state.queueIndex + 1];
            if (nextTrack && !state.cachedStreams[nextTrack.id]) {
                fetch(apiUrl(`/api/stream?id=${encodeURIComponent(nextTrack.id)}`))
                    .then(res => res.json())
                    .then(data => {
                        if (data.url) state.cachedStreams[nextTrack.id] = data.url;
                    })
                    .catch(() => {});
            }
        }
    });

    elements.audio.addEventListener('ended', () => {
        if (state.repeatMode === 'one') {
            elements.audio.currentTime = 0;
            elements.audio.play();
        } else {
            playNext();
        }
    });

    elements.audio.addEventListener('play', () => {
        state.isPlaying = true;
        updatePlayPauseUI(true);
    });

    elements.audio.addEventListener('pause', () => {
        state.isPlaying = false;
        updatePlayPauseUI(false);
    });
}

function updateProgressUI(current, duration) {
    const percent = duration > 0 ? (current / duration) * 100 : 0;
    const curTimeStr = formatTime(current);
    const durTimeStr = formatTime(duration);

    // Standard player bar
    elements.progressFill.style.width = `${percent}%`;
    elements.progressThumb.style.left = `${percent}%`;
    elements.currentTime.textContent = curTimeStr;
    elements.totalDuration.textContent = durTimeStr;

    // Fullscreen Song Visualizer
    if (elements.fsProgressFill) elements.fsProgressFill.style.width = `${percent}%`;
    if (elements.fsProgressThumb) elements.fsProgressThumb.style.left = `${percent}%`;
    if (elements.fsCurrentTime) elements.fsCurrentTime.textContent = curTimeStr;
    if (elements.fsTotalDuration) elements.fsTotalDuration.textContent = durTimeStr;

    // Mini Floating Player
    if (elements.miniProgressFill) elements.miniProgressFill.style.width = `${percent}%`;
    if (elements.miniProgressThumb) elements.miniProgressThumb.style.left = `${percent}%`;
    if (elements.miniCurrentTime) elements.miniCurrentTime.textContent = curTimeStr;
    if (elements.miniTotalDuration) elements.miniTotalDuration.textContent = durTimeStr;
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// --- VOLUME MANAGEMENT ---
function setVolume(val) {
    state.volume = Math.max(0, Math.min(1, val));
    elements.audio.volume = state.volume;
    localStorage.setItem('lumina_volume', state.volume.toString());
    saveUserDataToServer();

    const percent = state.volume * 100;
    elements.volumeFill.style.width = `${percent}%`;
    elements.volumeThumb.style.left = `${percent}%`;

    updateVolumeIcon();
}

function toggleMute() {
    state.isMuted = !state.isMuted;
    elements.audio.muted = state.isMuted;
    updateVolumeIcon();
}

function updateVolumeIcon() {
    if (state.isMuted || state.volume === 0) {
        elements.btnVolumeIcon.innerHTML = '<i data-lucide="volume-x"></i>';
    } else if (state.volume < 0.5) {
        elements.btnVolumeIcon.innerHTML = '<i data-lucide="volume-1"></i>';
    } else {
        elements.btnVolumeIcon.innerHTML = '<i data-lucide="volume-2"></i>';
    }
    initLucide();
}

// --- PLAYER BAR & AMBIENT UI ---
function updatePlayerUI(track) {
    if (!track) return;
    elements.playerCover.src = track.thumbnail;
    elements.playerTitle.textContent = track.title;
    elements.playerArtist.textContent = track.artist;

    const isFav = state.favorites.some(f => f.id === track.id);
    elements.btnToggleFav.classList.toggle('active', isFav);
    elements.iconFav.classList.toggle('fill-current', isFav);

    const sidebarPreview = document.getElementById('sidebar-preview');
    const sidebarThumb = document.getElementById('sidebar-thumb');
    const sidebarTitle = document.getElementById('sidebar-title');
    const sidebarArtist = document.getElementById('sidebar-artist');
    if (sidebarPreview && sidebarThumb) {
        sidebarPreview.style.display = 'flex';
        sidebarThumb.src = track.thumbnail;
        sidebarTitle.textContent = track.title;
        sidebarArtist.textContent = track.artist;
    }

    // Synchronize Fullscreen Visualizer & Mini Player
    updateVisualizerUI(track);
    updateMiniPlayerUI(track);

    if (state.currentView === 'lyrics') {
        loadLyricsForCurrentTrack();
    }
}

// Static ambient mesh without heavy GPU redraws to avoid game lag
function updateAmbientColor(track) {
    if (state.gamerMode) return; // In gamer mode, zero ambient updates

    const colors = [
        ['rgba(99, 102, 241, 0.16)', 'rgba(236, 72, 153, 0.14)', 'rgba(6, 182, 212, 0.08)'],
        ['rgba(168, 85, 247, 0.16)', 'rgba(244, 63, 94, 0.14)', 'rgba(59, 130, 246, 0.08)'],
        ['rgba(16, 185, 129, 0.16)', 'rgba(6, 182, 212, 0.14)', 'rgba(139, 92, 246, 0.08)'],
        ['rgba(245, 158, 11, 0.16)', 'rgba(236, 72, 153, 0.14)', 'rgba(99, 102, 241, 0.08)']
    ];
    let hash = 0;
    for (let i = 0; i < track.title.length; i++) {
        hash = track.title.charCodeAt(i) + ((hash << 5) - hash);
    }
    const palette = colors[Math.abs(hash) % colors.length];

    if (elements.ambientGlow) {
        elements.ambientGlow.style.background = `
            radial-gradient(circle at 20% 15%, ${palette[0]} 0%, transparent 60%),
            radial-gradient(circle at 85% 85%, ${palette[1]} 0%, transparent 60%),
            radial-gradient(circle at 50% 50%, ${palette[2]} 0%, transparent 70%)
        `;
    }
}

// --- GAMER MODE & WINDOW FOCUS PERFORMANCE MANAGER ---
function toggleGamerMode() {
    state.gamerMode = !state.gamerMode;
    applyGamerMode(state.gamerMode);
    saveUserDataToServer();
    showToast(state.gamerMode ? '🎮 Modo Gamer activado: Cero impacto de GPU en juegos' : 'Modo Glassmorphism activado');
}

function applyGamerMode(enabled) {
    document.body.classList.toggle('gamer-mode', enabled);
    const btn = document.getElementById('btn-gamer-mode');
    const txt = document.getElementById('gamer-mode-text');
    if (btn) btn.classList.toggle('active', enabled);
    if (txt) txt.textContent = enabled ? 'Gamer: ON' : 'Gamer';
}

function setupGamerAndFocusListeners() {
    // When switching to a game or another monitor, freeze animations to ensure 0 GPU stutter
    window.addEventListener('blur', () => {
        document.body.classList.add('window-unfocused');
    });

    window.addEventListener('focus', () => {
        document.body.classList.remove('window-unfocused');
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            document.body.classList.add('window-unfocused');
        } else {
            document.body.classList.remove('window-unfocused');
        }
    });
}

// --- QUEUE MANAGEMENT ---
function addToQueue(track) {
    state.queue.push(track);
    updateQueueBadge();
    if (state.currentView === 'queue') {
        renderQueue();
    }
}

function clearQueue() {
    if (state.currentTrack) {
        state.queue = [state.currentTrack];
        state.queueIndex = 0;
    } else {
        state.queue = [];
        state.queueIndex = -1;
    }
    updateQueueBadge();
    renderQueue();
    showToast('Cola de reproducción vaciada');
}

function updateQueueBadge() {
    elements.queueCountBadge.textContent = state.queue.length;
}

async function fetchRelatedTracksForQueue(videoId) {
    try {
        const res = await fetch(apiUrl(`/api/queue?id=${encodeURIComponent(videoId)}`));
        const data = await res.json();
        if (data.tracks && data.tracks.length > 0) {
            data.tracks.forEach(t => {
                if (!state.queue.some(q => q.id === t.id)) {
                    state.queue.push(t);
                }
            });
            updateQueueBadge();
            if (state.currentView === 'queue') renderQueue();
        }
    } catch (e) {
        console.warn('Could not auto-fetch queue:', e);
    }
}

function renderQueue() {
    elements.queueList.innerHTML = '';
    if (state.queue.length === 0) {
        elements.queueList.innerHTML = `
            <div class="empty-state">
                <i data-lucide="list-music" class="empty-icon"></i>
                <h3>Tu cola está vacía</h3>
                <p>Reproduce una canción o haz clic en '+' para agregar música.</p>
            </div>
        `;
        initLucide();
        return;
    }

    state.queue.forEach((track, index) => {
        const isCurrent = index === state.queueIndex;
        const item = document.createElement('div');
        item.className = `queue-item ${isCurrent ? 'active' : ''}`;
        item.innerHTML = `
            <span class="queue-index">${isCurrent ? '▶' : index + 1}</span>
            <img src="${track.thumbnail}" alt="${escapeHtml(track.title)}" class="queue-thumb">
            <div class="queue-info">
                <div class="queue-title">${escapeHtml(track.title)}</div>
                <div class="queue-artist">${escapeHtml(track.artist)}</div>
            </div>
            <span class="queue-duration">${track.duration || '--:--'}</span>
        `;
        item.addEventListener('click', () => {
            state.queueIndex = index;
            playTrack(track, false);
        });
        elements.queueList.appendChild(item);
    });
}

// --- FAVORITES MANAGEMENT ---
function toggleCurrentFavorite() {
    if (!state.currentTrack) return;
    toggleFavoriteTrack(state.currentTrack);
    const isFav = state.favorites.some(f => f.id === state.currentTrack.id);
    elements.btnToggleFav.classList.toggle('active', isFav);
    elements.iconFav.classList.toggle('fill-current', isFav);
    if (elements.fsBtnFav) elements.fsBtnFav.classList.toggle('active', isFav);
    if (elements.fsIconFav) elements.fsIconFav.classList.toggle('fill-current', isFav);
}

function toggleFavoriteTrack(track) {
    const index = state.favorites.findIndex(f => f.id === track.id);
    if (index >= 0) {
        state.favorites.splice(index, 1);
        showToast('Eliminada de tus favoritos');
    } else {
        state.favorites.unshift(track);
        showToast('Guardada en favoritos ❤️');
    }
    localStorage.setItem('lumina_favorites', JSON.stringify(state.favorites));
    saveUserDataToServer();
    updateFavCount();
    if (state.currentView === 'favorites') {
        renderFavorites();
    }
}

function updateFavCount() {
    elements.favCountBadge.textContent = state.favorites.length;
}

function renderFavorites() {
    elements.favoritesGrid.innerHTML = '';
    if (state.favorites.length === 0) {
        elements.favoritesEmpty.style.display = 'block';
    } else {
        elements.favoritesEmpty.style.display = 'none';
        state.favorites.forEach(track => {
            elements.favoritesGrid.appendChild(createSongCard(track));
        });
    }
    initLucide();
}

function playAllFavorites() {
    if (state.favorites.length === 0) {
        showToast('No tienes canciones en favoritos');
        return;
    }
    state.queue = [...state.favorites];
    state.queueIndex = 0;
    updateQueueBadge();
    playTrack(state.queue[0], false);
}

// --- LYRICS VIEW ---
async function loadLyricsForCurrentTrack() {
    if (!state.currentTrack) {
        elements.lyricsTitle.textContent = 'Sin reproducción activa';
        elements.lyricsArtist.textContent = 'Selecciona una canción';
        elements.lyricsContent.innerHTML = '<p class="lyrics-placeholder">Reproduce una canción para ver sus letras...</p>';
        elements.lyricsSource.textContent = '';
        return;
    }

    elements.lyricsTitle.textContent = state.currentTrack.title;
    elements.lyricsArtist.textContent = state.currentTrack.artist;
    elements.lyricsContent.innerHTML = `
        <div class="section-loader" style="padding: 30px 0;">
            <div class="spinner"></div>
            <span>Buscando letras en YouTube Music...</span>
        </div>
    `;

    try {
        const res = await fetch(apiUrl(`/api/lyrics?id=${encodeURIComponent(state.currentTrack.id)}`));
        const data = await res.json();

        if (data.lyrics) {
            elements.lyricsContent.textContent = data.lyrics;
            elements.lyricsSource.textContent = data.source ? `Fuente: ${data.source}` : '';
        } else {
            elements.lyricsContent.innerHTML = `
                <div class="empty-state" style="padding: 30px 0;">
                    <i data-lucide="quote" class="empty-icon"></i>
                    <h3>Letras no disponibles</h3>
                    <p>${data.message || 'Esta canción no incluye letras oficiales en YouTube Music.'}</p>
                </div>
            `;
            initLucide();
        }
    } catch (e) {
        console.error('Error fetching lyrics:', e);
        elements.lyricsContent.innerHTML = '<p class="lyrics-placeholder">Error al cargar las letras.</p>';
    }
}

// --- KEYBOARD SHORTCUTS ---
function setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            if (e.key === 'Escape') {
                e.target.blur();
                closeImportModal();
            }
            return;
        }

        switch (e.key) {
            case 'Escape':
                if (state.isFullscreenVisualizer) {
                    toggleFullscreenVisualizer(false);
                } else if (state.isMiniPlayer) {
                    toggleMiniPlayer();
                }
                break;
            case 'v':
            case 'V':
                if (!e.ctrlKey) {
                    e.preventDefault();
                    toggleFullscreenVisualizer();
                }
                break;
            case 'm':
            case 'M':
                if (!e.ctrlKey) {
                    e.preventDefault();
                    toggleMiniPlayer();
                }
                break;
            case 'F11':
                e.preventDefault();
                toggleNativeFullscreen();
                break;
            case ' ':
                e.preventDefault();
                togglePlayPause();
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (elements.audio.duration) {
                    elements.audio.currentTime = Math.max(0, elements.audio.currentTime - 5);
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (elements.audio.duration) {
                    elements.audio.currentTime = Math.min(elements.audio.duration, elements.audio.currentTime + 5);
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                setVolume(state.volume + 0.05);
                break;
            case 'ArrowDown':
                e.preventDefault();
                setVolume(state.volume - 0.05);
                break;
            case '/':
            case 'f':
                if (e.ctrlKey || e.key === '/') {
                    e.preventDefault();
                    elements.searchInput.focus();
                }
                break;
        }
    });
}

// --- MEDIA SESSION API (WINDOWS HARDWARE CONTROLS) ---
function setupMediaSession() {
    if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => togglePlayPause());
        navigator.mediaSession.setActionHandler('pause', () => togglePlayPause());
        navigator.mediaSession.setActionHandler('previoustrack', () => playPrevious());
        navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            if (details.seekTime && elements.audio.duration) {
                elements.audio.currentTime = details.seekTime;
            }
        });
    }
}

function updateMediaSessionMetadata(track) {
    if ('mediaSession' in navigator && track) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: track.artist,
            album: track.album || 'YouTube Music',
            artwork: [
                { src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }
            ]
        });
    }
}

// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
        <i data-lucide="${type === 'error' ? 'alert-circle' : 'sparkles'}"></i>
        <span>${escapeHtml(message)}</span>
    `;
    elements.toastContainer.appendChild(toast);
    initLucide();

    setTimeout(() => {
        if (toast.parentElement) {
            toast.remove();
        }
    }, 3000);
}

// --- HELPER UTILITIES ---
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[m]);
}
