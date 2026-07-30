/* ── Animated stats counter ───────────────────────────────────────────────── */
// Triggers once when the stats section scrolls into view.

const counters = document.querySelectorAll('.stat-number');
let animated = false;

function runCounters() {
    counters.forEach(counter => {
        const target   = +counter.getAttribute('data-target');
        const suffix   = counter.getAttribute('data-suffix') || '';
        const duration = 1800; // ms
        const steps    = 60;
        let step       = 0;

        const timer = setInterval(() => {
            step++;
            // Cubic ease-out: slow down near the end
            const current = Math.round(target * (1 - Math.pow(1 - step / steps, 3)));
            counter.textContent = current + suffix;

            if (step >= steps) {
                counter.textContent = target + suffix;
                clearInterval(timer);
            }
        }, duration / steps);
    });
}

const statsSection = document.querySelector('.stats-section');

if (statsSection) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !animated) {
                animated = true;
                runCounters();
            }
        });
    }, { threshold: 0.3 });

    observer.observe(statsSection);
}

/* ── Scroll-reveal ────────────────────────────────────────────────────────── */
// Fades in sections with class="reveal" as they enter the viewport.

const revealElements = document.querySelectorAll('.reveal');

if (revealElements.length) {
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                revealObserver.unobserve(entry.target); // only animate once
            }
        });
    }, { threshold: 0.12 });

    revealElements.forEach(el => revealObserver.observe(el));
}

/* ── Smooth scroll with navbar-collapse on mobile ────────────────────────── */
// For any nav link pointing to an on-page anchor:
// 1. Collapse the mobile navbar first (if open)
// 2. Wait for the collapse animation to finish, then scroll with navbar offset

document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', function (e) {
        const targetId = this.getAttribute('href');
        if (!targetId || targetId === '#') return;

        const target = document.querySelector(targetId);
        if (!target) return;

        e.preventDefault();

        const navbarCollapse = document.querySelector('.navbar-collapse');
        const isOpen = navbarCollapse && navbarCollapse.classList.contains('show');

        function scrollToTarget() {
            const navbarHeight = document.querySelector('.custom-navbar')?.offsetHeight || 0;
            const offsetTop = target.getBoundingClientRect().top + window.scrollY - navbarHeight - 10;
            window.scrollTo({ top: offsetTop, behavior: 'smooth' });
        }

        if (isOpen) {
            // Collapse the menu first, then scroll after animation ends (300ms)
            const bsCollapse = bootstrap.Collapse.getInstance(navbarCollapse)
                || new bootstrap.Collapse(navbarCollapse, { toggle: false });
            bsCollapse.hide();
            navbarCollapse.addEventListener('hidden.bs.collapse', scrollToTarget, { once: true });
        } else {
            scrollToTarget();
        }
    });
});

/* ── Back-to-top button ───────────────────────────────────────────────────── */
// Shows after scrolling down 300px, hides when near the top.

const backToTop = document.querySelector('.back-to-top');

if (backToTop) {
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            backToTop.classList.add('show');
        } else {
            backToTop.classList.remove('show');
        }
    }, { passive: true });

    backToTop.addEventListener('click', (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}
