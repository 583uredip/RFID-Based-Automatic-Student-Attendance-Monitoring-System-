/**
 * Site-Wide Interactive Live Search Module (Minimalist & Professional)
 * Kapotaksha Secondary High School
 */

(function () {
    'use strict';

    // Comprehensive Site Search Index
    const SITE_INDEX = [
        // ── About & Main ──
        { title: "About Kapotaksha Secondary High School (KCHS)", category: "About", url: "index.html#about-ahs", snippet: "Kapotaksha Secondary High School history, mission, values, and location." },
        { title: "Rules & Regulations", category: "Policy", url: "about/RulesRegulation.html", snippet: "Official code of conduct, academic policies, discipline, and school rules." },
        { title: "Intimidation & Anti-Bullying Policy", category: "Policy", url: "about/IntimidationPolicy.html", snippet: "Zero-tolerance policy on intimidation, harassment, safety and student welfare." },
        { title: "Contact & Location", category: "Contact", url: "index.html#contact", snippet: "School address: Padmapukur, Koyra, Khulna. Email: s117204s@gmail.com." },

        // ── People & Governance ──
        { title: "Teachers & Staff Directory", category: "People", url: "people/teachers.html", snippet: "Complete directory of teachers and administrative staff at KSHS." },
        { title: "Ramen Chandra Roy (Headmaster)", category: "People", url: "people/teachers.html", snippet: "Headmaster of Kapotaksha Secondary High School." },
        { title: "Bhairab Kumar Mondal (Assistant Headmaster)", category: "People", url: "people/teachers.html", snippet: "Assistant Headmaster of Kapotaksha Secondary High School." },
        { title: "Executive Committee (2025-2026)", category: "People", url: "people/executivecommittee2025-26.html", snippet: "Current governing body, executive leaders, and committee members." },
        { title: "Founders & History", category: "People", url: "people/Founders.html", snippet: "Visionary founders who established Kapotaksha High School." },
        { title: "Advisers Panel", category: "People", url: "people/adviser.html", snippet: "Advisory board members guiding KSHS development." },
        { title: "Old Students Association (OSA)", category: "People", url: "people/OSA.html", snippet: "Alumni network, reunions, executive committee, and alumni activities." },
        { title: "Former Committee Members", category: "People", url: "people/formercommittee.html", snippet: "Archive of previous governing body members and school leadership." },
        { title: "Students Directory", category: "People", url: "people/students.html", snippet: "Student body information and class representatives." },

        // ── Activities & News ──
        { title: "Activities & News Portal", category: "News", url: "activiryandnews/ActivityAndNews.html", snippet: "School announcements, news updates, sports events, and notice board." },
        { title: "Academic Examination Notice", category: "Notice", url: "activiryandnews/templates/exam-template.html", snippet: "Examination schedules, routines, and guidelines for students." },
        { title: "Official School Notices", category: "Notice", url: "activiryandnews/templates/notice-template.html", snippet: "Important school circulars, holiday notices, and administrative updates." },
        { title: "Co-Curricular Activities", category: "Activities", url: "activiryandnews/templates/activity-template.html", snippet: "Debate, sports, science fair, cultural competitions, and student clubs." },

        // ── Events ──
        { title: "School Events Overview", category: "Events", url: "events/Events.html", snippet: "Annual celebrations, festivals, orientation sessions, and cultural events." },
        { title: "Saraswati Puja 2026", category: "Events", url: "events/saraswatiPuja2026.html", snippet: "Saraswati Puja festival celebrations, schedule, and photo gallery." },
        { title: "Saraswati Puja 2025", category: "Events", url: "events/saraswatiPuja2025.html", snippet: "Archive of Saraswati Puja 2025 celebration." },
        { title: "Durga Puja Celebration", category: "Events", url: "events/durgaPuja2025.html", snippet: "Annual Durga Puja celebration and festivities." },
        { title: "Holi Festival 2026", category: "Events", url: "events/holi2026.html", snippet: "Holi spring festival celebrations at KSHS campus." },
        { title: "Summer Orientation 2026", category: "Events", url: "events/summerOrientation2026.html", snippet: "Welcoming new students during Summer 2026 Orientation." },
        { title: "Spring Orientation 2026", category: "Events", url: "events/springOrientation2026.html", snippet: "Spring 2026 student orientation program." },

        // ── Media & Photo Gallery ──
        { title: "Photo Lightbox Gallery", category: "Gallery", url: "Media/Gallery.html", snippet: "Interactive photo gallery with full-screen slideshow viewer and captions." },
        { title: "Saraswati Puja Photo Gallery", category: "Gallery", url: "Media/events/saraswati-puja.html", snippet: "Photos and full-screen slideshow of Saraswati Puja celebrations." },
        { title: "Durga Puja Photo Gallery", category: "Gallery", url: "Media/events/durga-puja.html", snippet: "Photos of Durga Puja festivities." },
        { title: "Holi Celebration Photos", category: "Gallery", url: "Media/events/holi.html", snippet: "Color festival photo album." },
        { title: "Cultural Evening Photos", category: "Gallery", url: "Media/events/cultural-evening.html", snippet: "Stage performances, music, dance, and drama photo gallery." },
        { title: "Orientation Photo Album", category: "Gallery", url: "Media/events/orientation.html", snippet: "Summer and Spring student orientation photo gallery." },
        { title: "AHS Campus & Team Photos", category: "Gallery", url: "Media/events/ahs-photos.html", snippet: "Campus buildings, Development Team, Media Team, and Organizers photo album." }
    ];

    class SiteSearchEngine {
        constructor() {
            this.selectedIndex = -1;
            this.currentResults = [];
            this.computeBasePath();
            this.initDOM();
            this.bindEvents();
        }

        computeBasePath() {
            const path = window.location.pathname.replace(/\\/g, '/');
            if (path.includes('/Media/events/') || path.includes('/activiryandnews/templates/')) {
                this.basePath = '../../';
            } else if (path.includes('/about/') || path.includes('/people/') || path.includes('/activiryandnews/') || path.includes('/events/') || path.includes('/Media/')) {
                this.basePath = '../';
            } else {
                this.basePath = './';
            }
        }

        initDOM() {
            let modal = document.getElementById('site-search-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'site-search-modal';
                modal.className = 'site-search-modal';
                modal.setAttribute('role', 'dialog');
                modal.setAttribute('aria-modal', 'true');

                modal.innerHTML = `
                    <div class="search-dialog-box">
                        <div class="search-input-header">
                            <span class="search-icon-svg">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="11" cy="11" r="8"></circle>
                                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                </svg>
                            </span>
                            <input type="text" id="search-live-input" class="search-live-input" placeholder="Search KSHS..." autocomplete="off">
                            <span class="search-shortcut-badge">ESC</span>
                            <button id="search-close-btn" class="search-close-btn" aria-label="Close search">&times;</button>
                        </div>
                        <div class="search-results-wrapper" id="search-results-wrapper">
                            <div class="search-empty-state">
                                <p class="search-empty-text">Type to search Kapotaksha Secondary High School...</p>
                            </div>
                        </div>
                        <div class="search-footer-info">
                            <span><span class="search-footer-key">Up</span> <span class="search-footer-key">Down</span> Navigate</span>
                            <span><span class="search-footer-key">Enter</span> Select</span>
                            <span><span class="search-footer-key">Ctrl + K</span> Shortcut</span>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }

            this.modal = modal;
            this.input = document.getElementById('search-live-input');
            this.resultsWrapper = document.getElementById('search-results-wrapper');
            this.btnClose = document.getElementById('search-close-btn');
        }

        bindEvents() {
            // Attach click handler to any search triggers on page
            document.querySelectorAll('.btn-search, [data-search-trigger], form[role="search"]').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.open();
                });
                if (el.tagName === 'FORM') {
                    el.addEventListener('submit', (e) => {
                        e.preventDefault();
                        this.open();
                    });
                }
            });

            // Keyboard shortcut Ctrl+K or Cmd+K
            document.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                    e.preventDefault();
                    if (this.modal.classList.contains('active')) {
                        this.close();
                    } else {
                        this.open();
                    }
                } else if (this.modal.classList.contains('active')) {
                    if (e.key === 'Escape') {
                        this.close();
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        this.moveSelection(1);
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        this.moveSelection(-1);
                    } else if (e.key === 'Enter') {
                        if (this.selectedIndex >= 0 && this.currentResults[this.selectedIndex]) {
                            e.preventDefault();
                            window.location.href = this.resolveUrl(this.currentResults[this.selectedIndex].url);
                        }
                    }
                }
            });

            // Live typing inside search modal
            this.input.addEventListener('input', (e) => {
                this.performSearch(e.target.value);
            });

            // Close button click
            this.btnClose.addEventListener('click', () => this.close());

            // Click outside overlay
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.close();
                }
            });
        }

        resolveUrl(relUrl) {
            return this.basePath + relUrl;
        }

        open(initialQuery = '') {
            this.modal.classList.add('active');
            document.body.style.overflow = 'hidden';
            if (initialQuery) {
                this.input.value = initialQuery;
            }
            this.input.focus();
            this.performSearch(this.input.value);
        }

        close() {
            this.modal.classList.remove('active');
            document.body.style.overflow = '';
        }

        performSearch(query) {
            const trimmed = query.trim().toLowerCase();
            this.selectedIndex = -1;

            if (!trimmed) {
                this.currentResults = [];
                this.resultsWrapper.innerHTML = `
                    <div class="search-empty-state">
                        <p class="search-empty-text">Type to search Kapotaksha Secondary High School...</p>
                    </div>
                `;
                return;
            }

            const terms = trimmed.split(/\s+/).filter(Boolean);
            const matches = SITE_INDEX.filter(item => {
                const searchStr = `${item.title} ${item.category} ${item.snippet}`.toLowerCase();
                return terms.every(term => searchStr.includes(term));
            });

            this.currentResults = matches;

            if (matches.length === 0) {
                this.resultsWrapper.innerHTML = `
                    <div class="search-empty-state">
                        <p class="search-empty-text">No results found for "<strong>${this.escapeHTML(query)}</strong>"</p>
                    </div>
                `;
                return;
            }

            // Group results by category
            const grouped = {};
            matches.forEach(item => {
                if (!grouped[item.category]) grouped[item.category] = [];
                grouped[item.category].push(item);
            });

            let html = '';
            let globalIndex = 0;

            Object.keys(grouped).forEach(cat => {
                html += `<div class="search-group-title">${cat}</div>`;
                grouped[cat].forEach(item => {
                    const targetUrl = this.resolveUrl(item.url);
                    const highlightedTitle = this.highlightText(item.title, trimmed);
                    const highlightedSnippet = this.highlightText(item.snippet, trimmed);

                    html += `
                        <a href="${targetUrl}" class="search-result-item" data-result-index="${globalIndex}">
                            <div class="search-item-content">
                                <h4 class="search-item-title">${highlightedTitle}</h4>
                                <p class="search-item-snippet">${highlightedSnippet}</p>
                            </div>
                            <span class="search-item-category">${item.category}</span>
                        </a>
                    `;
                    globalIndex++;
                });
            });

            this.resultsWrapper.innerHTML = html;
        }

        highlightText(text, query) {
            if (!query || query.length < 2) return this.escapeHTML(text);
            const terms = query.split(/\s+/).filter(t => t.length >= 2);
            if (terms.length === 0) return this.escapeHTML(text);

            let pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
            return this.escapeHTML(text).replace(pattern, '<mark class="search-highlight">$1</mark>');
        }

        escapeHTML(str) {
            return str.replace(/[&<>'"]/g, tag => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                "'": '&#39;',
                '"': '&quot;'
            }[tag] || tag));
        }

        moveSelection(direction) {
            const items = this.resultsWrapper.querySelectorAll('.search-result-item');
            if (items.length === 0) return;

            this.selectedIndex += direction;
            if (this.selectedIndex < 0) this.selectedIndex = items.length - 1;
            if (this.selectedIndex >= items.length) this.selectedIndex = 0;

            items.forEach((item, idx) => {
                if (idx === this.selectedIndex) {
                    item.classList.add('selected');
                    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                } else {
                    item.classList.remove('selected');
                }
            });
        }
    }

    // Auto initialize site search
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.kshsSearch = new SiteSearchEngine();
        });
    } else {
        window.kshsSearch = new SiteSearchEngine();
    }
})();
