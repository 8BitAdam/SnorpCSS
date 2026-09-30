/*!
 * Universal Tooltips
 *
 * Add data-tooltip="Text here" to any element.
 *
 * Optional:
 *   data-tooltip-position="top|bottom|left|right"
 *   data-tooltip-delay="300"
 *
 * The tooltip follows the target element while visible.
 */

(() => {
    if (window.__universalTooltips) return;
    window.__universalTooltips = true;

    const ATTR = 'data-tooltip';
    const GAP = 10;
    const PAD = 8;
    const DEFAULT_DELAY = 150;
    const TOUCH_HIDE_MS = 2000;

    // -------------------------------------------------------------------------
    // Styles
    // -------------------------------------------------------------------------

    const style = document.createElement('style');

    style.textContent = `
        .ut-tip {
            position: fixed;
            left: 0;
            top: 0;
            z-index: var(--ut-z, 99999);

            max-width: var(--ut-max-width, 260px);

            padding: 6px 10px;

            border-radius: var(--ut-radius, 6px);

            background: var(--ut-bg, #1f2430);
            color: var(--ut-color, #fff);

            font:
                var(--ut-font-size, 13px)/1.4
                system-ui,
                -apple-system,
                "Segoe UI",
                Roboto,
                sans-serif;

            white-space: pre-line;
            overflow-wrap: anywhere;

            pointer-events: none;

            opacity: 0;

            transition: opacity .12s ease;

            box-shadow: 0 4px 14px rgba(0, 0, 0, .25);
        }

        .ut-tip.ut-visible {
            opacity: 1;
        }

        .ut-tip::after {
            content: "";

            position: absolute;

            width: 8px;
            height: 8px;

            background: inherit;

            transform: rotate(45deg);
        }

        .ut-tip[data-placement="top"]::after {
            bottom: -4px;
            left: var(--ut-arrow, 50%);
            margin-left: -4px;
        }

        .ut-tip[data-placement="bottom"]::after {
            top: -4px;
            left: var(--ut-arrow, 50%);
            margin-left: -4px;
        }

        .ut-tip[data-placement="left"]::after {
            right: -4px;
            top: var(--ut-arrow, 50%);
            margin-top: -4px;
        }

        .ut-tip[data-placement="right"]::after {
            left: -4px;
            top: var(--ut-arrow, 50%);
            margin-top: -4px;
        }

        @media (prefers-reduced-motion: reduce) {
            .ut-tip {
                transition: none;
            }
        }
    `;

    document.head.appendChild(style);

    // -------------------------------------------------------------------------
    // Tooltip element
    // -------------------------------------------------------------------------

    const tip = document.createElement('div');

    tip.className = 'ut-tip';
    tip.id = 'ut-tooltip';

    tip.setAttribute('role', 'tooltip');

    const mount = () => {
        if (!document.body.contains(tip)) {
            document.body.appendChild(tip);
        }
    };

    if (document.body) {
        mount();
    } else {
        document.addEventListener('DOMContentLoaded', mount, {
            once: true
        });
    }

    // -------------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------------

    let current = null;

    let showTimer = null;
    let touchTimer = null;

    let animationFrame = null;

    // -------------------------------------------------------------------------
    // Find tooltip target
    // -------------------------------------------------------------------------

    const findTarget = (node) => {
        return node instanceof Element
            ? node.closest(`[${ATTR}]`)
            : null;
    };

    // -------------------------------------------------------------------------
    // Position tooltip
    // -------------------------------------------------------------------------

    function position(el) {
        if (!el || !document.contains(el)) {
            hide();
            return;
        }

        const r = el.getBoundingClientRect();
        const t = tip.getBoundingClientRect();

        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;

        const fits = {
            top:
                r.top - t.height - GAP >= PAD,

            bottom:
                r.bottom + t.height + GAP <= vh - PAD,

            left:
                r.left - t.width - GAP >= PAD,

            right:
                r.right + t.width + GAP <= vw - PAD
        };

        const opposite = {
            top: 'bottom',
            bottom: 'top',
            left: 'right',
            right: 'left'
        };

        let place = (
            el.getAttribute('data-tooltip-position') || 'top'
        ).toLowerCase();

        if (!Object.prototype.hasOwnProperty.call(fits, place)) {
            place = 'top';
        }

        // Preferred position doesn't fit.
        if (!fits[place]) {

            // Try opposite side.
            if (fits[opposite[place]]) {
                place = opposite[place];
            }

            // Otherwise find any side that fits.
            else {
                const any = [
                    'top',
                    'bottom',
                    'right',
                    'left'
                ].find((p) => fits[p]);

                if (any) {
                    place = any;
                }
            }
        }

        let x;
        let y;

        // -------------------------------------------------------------
        // Horizontal placement
        // -------------------------------------------------------------

        if (place === 'top' || place === 'bottom') {

            x =
                r.left +
                r.width / 2 -
                t.width / 2;

            y =
                place === 'top'
                    ? r.top - t.height - GAP
                    : r.bottom + GAP;
        }

        // -------------------------------------------------------------
        // Vertical placement
        // -------------------------------------------------------------

        else {

            y =
                r.top +
                r.height / 2 -
                t.height / 2;

            x =
                place === 'left'
                    ? r.left - t.width - GAP
                    : r.right + GAP;
        }

        // -------------------------------------------------------------
        // Keep tooltip inside viewport
        // -------------------------------------------------------------

        x = Math.max(
            PAD,
            Math.min(
                x,
                vw - t.width - PAD
            )
        );

        y = Math.max(
            PAD,
            Math.min(
                y,
                vh - t.height - PAD
            )
        );

        // -------------------------------------------------------------
        // Calculate arrow position
        // -------------------------------------------------------------

        const clamp = (value, max) => {
            return Math.max(
                10,
                Math.min(
                    value,
                    max - 10
                )
            );
        };

        const arrow =
            place === 'top' || place === 'bottom'
                ? clamp(
                    r.left + r.width / 2 - x,
                    t.width
                )
                : clamp(
                    r.top + r.height / 2 - y,
                    t.height
                );

        // -------------------------------------------------------------
        // Apply position
        // -------------------------------------------------------------

        tip.style.left = `${Math.round(x)}px`;
        tip.style.top = `${Math.round(y)}px`;

        tip.style.setProperty(
            '--ut-arrow',
            `${Math.round(arrow)}px`
        );

        tip.setAttribute(
            'data-placement',
            place
        );
    }

    // -------------------------------------------------------------------------
    // Continuously follow the element
    // -------------------------------------------------------------------------

    function followTarget() {

        if (!current) {
            animationFrame = null;
            return;
        }

        position(current);

        animationFrame = requestAnimationFrame(followTarget);
    }

    function startFollowing() {

        if (animationFrame !== null) {
            return;
        }

        animationFrame = requestAnimationFrame(followTarget);
    }

    function stopFollowing() {

        if (animationFrame !== null) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
    }

    // -------------------------------------------------------------------------
    // Show
    // -------------------------------------------------------------------------

    function show(el) {

        const text = el.getAttribute(ATTR);

        if (!text || !text.trim()) {
            return;
        }

        current = el;

        // Properly convert literal "\n" into line breaks.
        tip.textContent = text.replace(/\\n/g, '\n');

        el.setAttribute(
            'aria-describedby',
            tip.id
        );

        // Make sure the tooltip can be measured.
        tip.style.left = '0px';
        tip.style.top = '0px';

        // Position before displaying.
        position(el);

        tip.classList.add('ut-visible');

        // Start following the element.
        startFollowing();
    }

    // -------------------------------------------------------------------------
    // Hide
    // -------------------------------------------------------------------------

    function hide() {

        clearTimeout(showTimer);
        clearTimeout(touchTimer);

        stopFollowing();

        if (current) {
            current.removeAttribute(
                'aria-describedby'
            );

            current = null;
        }

        tip.classList.remove('ut-visible');
    }

    // -------------------------------------------------------------------------
    // Schedule show
    // -------------------------------------------------------------------------

    function scheduleShow(el, immediate = false) {

        clearTimeout(showTimer);

        const delay = immediate
            ? 0
            : parseInt(
                el.getAttribute('data-tooltip-delay'),
                10
            );

        const ms = Number.isNaN(delay)
            ? (immediate ? 0 : DEFAULT_DELAY)
            : delay;

        showTimer = setTimeout(() => {
            show(el);
        }, ms);
    }

    // -------------------------------------------------------------------------
    // Pointer hover
    // -------------------------------------------------------------------------

    document.addEventListener(
        'pointerover',
        (e) => {

            if (e.pointerType === 'touch') {
                return;
            }

            const el = findTarget(e.target);

            if (!el || el === current) {
                return;
            }

            hide();
            scheduleShow(el);
        }
    );

    document.addEventListener(
        'pointerout',
        (e) => {

            if (e.pointerType === 'touch') {
                return;
            }

            const el = findTarget(e.target);

            if (!el) {
                return;
            }

            // Moving between children of the same element
            // should not hide the tooltip.
            if (
                e.relatedTarget instanceof Node &&
                el.contains(e.relatedTarget)
            ) {
                return;
            }

            hide();
        }
    );

    // -------------------------------------------------------------------------
    // Keyboard focus
    // -------------------------------------------------------------------------

    document.addEventListener(
        'focusin',
        (e) => {

            const el = findTarget(e.target);

            if (el) {
                hide();
                scheduleShow(el, true);
            }
        }
    );

    document.addEventListener(
        'focusout',
        hide
    );

    // -------------------------------------------------------------------------
    // Touch
    // -------------------------------------------------------------------------

    document.addEventListener(
        'pointerdown',
        (e) => {

            if (e.pointerType !== 'touch') {
                return;
            }

            const el = findTarget(e.target);

            hide();

            if (el) {

                show(el);

                touchTimer = setTimeout(
                    hide,
                    TOUCH_HIDE_MS
                );
            }
        }
    );

    // -------------------------------------------------------------------------
    // Escape
    // -------------------------------------------------------------------------

    document.addEventListener(
        'keydown',
        (e) => {

            if (e.key === 'Escape') {
                hide();
            }
        }
    );

    // -------------------------------------------------------------------------
    // If scrolling/resizing, immediately reposition.
    // -------------------------------------------------------------------------

    window.addEventListener(
        'scroll',
        () => {

            if (current) {
                position(current);
            }
        },
        true
    );

    window.addEventListener(
        'resize',
        () => {

            if (current) {
                position(current);
            }
        }
    );

    // -------------------------------------------------------------------------
    // Hide if target is removed.
    // -------------------------------------------------------------------------

    new MutationObserver(() => {

        if (
            current &&
            !document.contains(current)
        ) {
            hide();
        }

    }).observe(
        document.documentElement,
        {
            childList: true,
            subtree: true
        }
    );

})();