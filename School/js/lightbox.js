/**
 * Interactive Photo Lightbox Gallery & Slideshow Component
 * Kapotaksha Secondary High School
 */

(function () {
    'use strict';

    class PhotoLightbox {
        constructor() {
            this.items = [];
            this.currentIndex = 0;
            this.isPlaying = false;
            this.slideshowTimer = null;
            this.slideshowInterval = 3500; // 3.5 seconds per slide
            this.progressTimer = null;
            this.isZoomed = false;
            this.touchStartX = 0;
            this.touchEndX = 0;
            this.currentCategory = 'all';

            this.initDOM();
            this.bindEvents();
            this.scanItems();
            this.setupCategoryFilters();
        }

        initDOM() {
            // Check if lightbox modal already exists, else create dynamically
            let modal = document.getElementById('lightbox-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'lightbox-modal';
                modal.className = 'lightbox-modal';
                modal.setAttribute('role', 'dialog');
                modal.setAttribute('aria-modal', 'true');
                modal.setAttribute('aria-label', 'Photo viewer modal');

                modal.innerHTML = `
                    <div class="lightbox-progress-bar" id="lightbox-progress"></div>
                    <div class="lightbox-header">
                        <div class="lightbox-meta-info">
                            <span class="lightbox-counter" id="lightbox-counter">1 / 1</span>
                            <span class="lightbox-category-tag" id="lightbox-category">GALLERY</span>
                        </div>
                        <div class="lightbox-toolbar">
                            <button class="lightbox-btn" id="lightbox-btn-play" title="Play Slideshow (Space)">&#9654;</button>
                            <button class="lightbox-btn" id="lightbox-btn-zoom" title="Toggle Zoom"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></button>
                            <button class="lightbox-btn" id="lightbox-btn-fullscreen" title="Toggle Fullscreen">&#x26F6;</button>
                            <button class="lightbox-btn lightbox-btn-close" id="lightbox-btn-close" title="Close (Esc)">&times;</button>
                        </div>
                    </div>
                    <div class="lightbox-stage">
                        <button class="lightbox-nav-btn lightbox-nav-prev" id="lightbox-btn-prev" aria-label="Previous photo">&#10094;</button>
                        <div class="lightbox-img-wrapper" id="lightbox-img-wrapper">
                            <img src="" alt="" class="lightbox-main-img" id="lightbox-main-img">
                        </div>
                        <button class="lightbox-nav-btn lightbox-nav-next" id="lightbox-btn-next" aria-label="Next photo">&#10095;</button>
                    </div>
                    <div class="lightbox-caption-bar">
                        <h3 class="lightbox-caption-title" id="lightbox-caption-title">Photo Title</h3>
                        <p class="lightbox-caption-desc" id="lightbox-caption-desc"></p>
                    </div>
                    <div class="lightbox-filmstrip" id="lightbox-filmstrip"></div>
                `;
                document.body.appendChild(modal);
            }

            this.modal = modal;
            this.mainImg = document.getElementById('lightbox-main-img');
            this.imgWrapper = document.getElementById('lightbox-img-wrapper');
            this.counter = document.getElementById('lightbox-counter');
            this.categoryTag = document.getElementById('lightbox-category');
            this.captionTitle = document.getElementById('lightbox-caption-title');
            this.captionDesc = document.getElementById('lightbox-caption-desc');
            this.filmstrip = document.getElementById('lightbox-filmstrip');
            this.progressBar = document.getElementById('lightbox-progress');
            this.btnPlay = document.getElementById('lightbox-btn-play');
            this.btnZoom = document.getElementById('lightbox-btn-zoom');
            this.btnFullscreen = document.getElementById('lightbox-btn-fullscreen');
            this.btnClose = document.getElementById('lightbox-btn-close');
            this.btnPrev = document.getElementById('lightbox-btn-prev');
            this.btnNext = document.getElementById('lightbox-btn-next');
        }

        scanItems() {
            // Support both .photo-item and .gallery-item containing images
            const rawItems = Array.from(document.querySelectorAll('.photo-item, .gallery-item'));
            this.items = rawItems.filter(el => {
                // Ignore cards that link to external pages unless they have data-lightbox
                const img = el.querySelector('img');
                if (!img) return false;
                // If filtered, check display status
                if (el.style.display === 'none') return false;
                return true;
            });

            this.items.forEach((item, index) => {
                item.setAttribute('data-lightbox-index', index);
                // Ensure zoom overlay icon exists for high-res feel
                if (!item.querySelector('.photo-zoom-icon') && item.classList.contains('photo-item')) {
                    const icon = document.createElement('div');
                    icon.className = 'photo-zoom-icon';
                    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>';
                    item.appendChild(icon);
                }
            });
        }

        bindEvents() {
            // Click trigger on photo items
            document.body.addEventListener('click', (e) => {
                const item = e.target.closest('.photo-item, .gallery-item');
                // Check if item is inside photo grid and not an external category link (or handled)
                if (item && item.querySelector('img')) {
                    // If it's a category link in Gallery.html without data-lightbox, check if lightbox mode enabled
                    if (item.hasAttribute('data-lightbox') || item.classList.contains('photo-item')) {
                        e.preventDefault();
                        this.scanItems(); // refresh visible items list
                        const idx = this.items.indexOf(item);
                        if (idx !== -1) {
                            this.open(idx);
                        }
                    }
                }
            });

            // Navigation buttons
            this.btnPrev.addEventListener('click', (e) => { e.stopPropagation(); this.prev(); });
            this.btnNext.addEventListener('click', (e) => { e.stopPropagation(); this.next(); });
            this.btnClose.addEventListener('click', () => this.close());
            this.btnPlay.addEventListener('click', () => this.togglePlay());
            this.btnZoom.addEventListener('click', () => this.toggleZoom());
            this.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());

            // Click background overlay to close
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal || e.target.classList.contains('lightbox-stage')) {
                    this.close();
                }
            });

            // Double-click image wrapper to zoom
            this.imgWrapper.addEventListener('click', (e) => {
                if (e.target === this.mainImg) {
                    this.toggleZoom();
                }
            });

            // Keyboard Shortcuts
            document.addEventListener('keydown', (e) => {
                if (!this.modal.classList.contains('active')) return;
                switch (e.key) {
                    case 'Escape':
                        this.close();
                        break;
                    case 'ArrowLeft':
                        this.prev();
                        break;
                    case 'ArrowRight':
                        this.next();
                        break;
                    case ' ':
                        e.preventDefault();
                        this.togglePlay();
                        break;
                }
            });

            // Mobile Touch Swipe Navigation
            this.modal.addEventListener('touchstart', (e) => {
                this.touchStartX = e.changedTouches[0].screenX;
            }, { passive: true });

            this.modal.addEventListener('touchend', (e) => {
                this.touchEndX = e.changedTouches[0].screenX;
                this.handleSwipe();
            }, { passive: true });
        }

        handleSwipe() {
            const swipeThreshold = 50;
            const deltaX = this.touchEndX - this.touchStartX;
            if (deltaX < -swipeThreshold) {
                this.next();
            } else if (deltaX > swipeThreshold) {
                this.prev();
            }
        }

        open(index) {
            if (this.items.length === 0) return;
            this.currentIndex = index;
            this.modal.classList.add('active');
            document.body.style.overflow = 'hidden';
            this.renderFilmstrip();
            this.updateStage(true);
        }

        close() {
            this.modal.classList.remove('active');
            document.body.style.overflow = '';
            this.stopSlideshow();
            this.resetZoom();
        }

        updateStage(immediate = false) {
            if (!this.items[this.currentIndex]) return;
            const currentItem = this.items[this.currentIndex];
            const img = currentItem.querySelector('img');
            if (!img) return;

            const imgSrc = currentItem.getAttribute('data-fullsrc') || img.src;
            const title = currentItem.getAttribute('data-title') ||
                         currentItem.querySelector('.photo-item-label, .gallery-label')?.textContent ||
                         img.alt || 'KSHS Photo';
            const category = currentItem.getAttribute('data-category') ||
                            currentItem.closest('[data-year]')?.getAttribute('data-year') || 'GALLERY';
            const year = currentItem.getAttribute('data-year') || '';

            // Reset zoom state on photo change
            this.resetZoom();

            // Transition effect
            if (!immediate) {
                this.mainImg.classList.remove('fade-in');
                this.mainImg.classList.add('fade-out');

                setTimeout(() => {
                    this.mainImg.src = imgSrc;
                    this.mainImg.alt = title;
                    this.mainImg.classList.remove('fade-out');
                    this.mainImg.classList.add('fade-in');
                }, 180);
            } else {
                this.mainImg.src = imgSrc;
                this.mainImg.alt = title;
                this.mainImg.classList.add('fade-in');
            }

            // Update Text Details
            this.counter.textContent = `${this.currentIndex + 1} / ${this.items.length}`;
            this.categoryTag.textContent = category.toUpperCase();
            this.captionTitle.textContent = title;
            this.captionDesc.textContent = year ? `Year / Event: ${year}` : 'Kapotaksha Secondary High School Gallery';

            // Highlight Active Filmstrip Thumbnail
            this.updateFilmstripActive();
        }

        renderFilmstrip() {
            this.filmstrip.innerHTML = '';
            this.items.forEach((item, idx) => {
                const img = item.querySelector('img');
                if (!img) return;

                const thumb = document.createElement('img');
                thumb.src = img.src;
                thumb.alt = img.alt || `Thumbnail ${idx + 1}`;
                thumb.className = 'lightbox-thumb' + (idx === this.currentIndex ? ' active' : '');
                thumb.addEventListener('click', () => {
                    this.currentIndex = idx;
                    this.updateStage();
                    if (this.isPlaying) this.resetSlideshowTimer();
                });
                this.filmstrip.appendChild(thumb);
            });
        }

        updateFilmstripActive() {
            const thumbs = this.filmstrip.querySelectorAll('.lightbox-thumb');
            thumbs.forEach((t, i) => {
                if (i === this.currentIndex) {
                    t.classList.add('active');
                    t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                } else {
                    t.classList.remove('active');
                }
            });
        }

        next() {
            if (this.items.length === 0) return;
            this.currentIndex = (this.currentIndex + 1) % this.items.length;
            this.updateStage();
            if (this.isPlaying) this.resetSlideshowTimer();
        }

        prev() {
            if (this.items.length === 0) return;
            this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
            this.updateStage();
            if (this.isPlaying) this.resetSlideshowTimer();
        }

        togglePlay() {
            if (this.isPlaying) {
                this.stopSlideshow();
            } else {
                this.startSlideshow();
            }
        }

        startSlideshow() {
            this.isPlaying = true;
            this.btnPlay.classList.add('active');
            this.btnPlay.innerHTML = '&#10074;&#10074;'; // Pause icon
            this.btnPlay.title = 'Pause Slideshow (Space)';
            this.resetSlideshowTimer();
        }

        stopSlideshow() {
            this.isPlaying = false;
            this.btnPlay.classList.remove('active');
            this.btnPlay.innerHTML = '&#9654;'; // Play icon
            this.btnPlay.title = 'Play Slideshow (Space)';
            if (this.slideshowTimer) clearInterval(this.slideshowTimer);
            if (this.progressTimer) clearInterval(this.progressTimer);
            this.progressBar.style.width = '0%';
        }

        resetSlideshowTimer() {
            if (this.slideshowTimer) clearInterval(this.slideshowTimer);
            if (this.progressTimer) clearInterval(this.progressTimer);

            let startTime = Date.now();
            this.progressBar.style.width = '0%';

            this.progressTimer = setInterval(() => {
                let elapsed = Date.now() - startTime;
                let pct = Math.min((elapsed / this.slideshowInterval) * 100, 100);
                this.progressBar.style.width = pct + '%';
            }, 50);

            this.slideshowTimer = setInterval(() => {
                this.next();
            }, this.slideshowInterval);
        }

        toggleZoom() {
            this.isZoomed = !this.isZoomed;
            if (this.isZoomed) {
                this.imgWrapper.classList.add('zoomed');
                this.btnZoom.classList.add('active');
            } else {
                this.resetZoom();
            }
        }

        resetZoom() {
            this.isZoomed = false;
            this.imgWrapper.classList.remove('zoomed');
            this.btnZoom.classList.remove('active');
        }

        toggleFullscreen() {
            if (!document.fullscreenElement) {
                this.modal.requestFullscreen().catch(err => {
                    console.log('Fullscreen request failed: ', err);
                });
                this.btnFullscreen.classList.add('active');
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
                this.btnFullscreen.classList.remove('active');
            }
        }

        setupCategoryFilters() {
            const filterBtns = document.querySelectorAll('.gallery-filter-btn');
            if (filterBtns.length === 0) return;

            filterBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const cat = btn.getAttribute('data-filter');
                    filterBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    const photoItems = document.querySelectorAll('.photo-item, .gallery-item');
                    photoItems.forEach(item => {
                        const itemCat = item.getAttribute('data-category');
                        if (cat === 'all' || itemCat === cat) {
                            item.style.display = '';
                            item.style.opacity = '1';
                            item.style.transform = 'scale(1)';
                        } else {
                            item.style.display = 'none';
                        }
                    });

                    this.scanItems(); // Re-index currently visible gallery items
                });
            });
        }
    }

    // Auto initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            window.kshsLightbox = new PhotoLightbox();
        });
    } else {
        window.kshsLightbox = new PhotoLightbox();
    }
})();
