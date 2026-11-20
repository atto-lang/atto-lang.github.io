'use strict';

(() => {
  const shell = document.querySelector('.deck-shell');
  const slides = Array.from(document.querySelectorAll('.slide[data-slide]'));
  const jumpLinks = Array.from(document.querySelectorAll('.slide-jump a'));
  const previousButton = document.getElementById('previous');
  const nextButton = document.getElementById('next');
  const fullscreenButton = document.getElementById('fullscreen');
  const progress = document.querySelector('.progress-track');
  const slideCount = document.querySelector('.slide-count');
  const stage = document.querySelector('.slide-stage');
  const total = slides.length;

  if (!shell || !total || !previousButton || !nextButton || !slideCount || !stage) return;

  let current = 1;
  let touchStart = null;

  function validSlide(index) {
    return Math.min(total, Math.max(1, index));
  }

  function slideFromHash() {
    const match = /^#\/(\d{1,2})$/.exec(window.location.hash);
    if (!match) return 1;
    const parsed = Number(match[1]);
    return Number.isSafeInteger(parsed) ? validSlide(parsed) : 1;
  }

  function render(index) {
    current = validSlide(index);
    shell.dataset.index = String(current);

    slides.forEach((slide, position) => {
      const active = position + 1 === current;
      slide.hidden = !active;
      slide.setAttribute('aria-hidden', String(!active));
    });

    jumpLinks.forEach((link, position) => {
      if (position + 1 === current) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    });

    previousButton.disabled = current === 1;
    nextButton.disabled = current === total;
    progress?.setAttribute('aria-valuenow', String(current));
    slideCount.firstChild.textContent = String(current).padStart(2, '0') + ' ';
    document.title = 'AttoPL — Slide ' + current + ' of ' + total;
  }

  function goTo(index) {
    const destination = validSlide(index);
    if (destination === current) return;
    window.location.hash = '#/' + destination;
  }

  function isTypingTarget(target) {
    return target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable="true"]'));
  }

  async function toggleFullscreen() {
    if (!document.fullscreenEnabled) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Some browsers or embedding contexts disallow fullscreen.
    }
  }

  previousButton.addEventListener('click', () => goTo(current - 1));
  nextButton.addEventListener('click', () => goTo(current + 1));
  fullscreenButton?.addEventListener('click', toggleFullscreen);

  if (fullscreenButton && !document.fullscreenEnabled) {
    fullscreenButton.disabled = true;
    fullscreenButton.title = 'Fullscreen is unavailable in this browser';
  }

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
    const key = event.key;
    if (key === 'ArrowRight' || key === 'PageDown' || key === ' ') {
      event.preventDefault();
      goTo(current + 1);
    } else if (key === 'ArrowLeft' || key === 'PageUp') {
      event.preventDefault();
      goTo(current - 1);
    } else if (key === 'Home') {
      event.preventDefault();
      goTo(1);
    } else if (key === 'End') {
      event.preventDefault();
      goTo(total);
    } else if (key.toLowerCase() === 'f' && !event.repeat) {
      event.preventDefault();
      toggleFullscreen();
    }
  });

  stage.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });

  stage.addEventListener('touchend', (event) => {
    if (!touchStart || event.changedTouches.length !== 1) return;
    const deltaX = event.changedTouches[0].clientX - touchStart.x;
    const deltaY = event.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(deltaX) < 65 || Math.abs(deltaX) < Math.abs(deltaY) * 1.3) return;
    goTo(current + (deltaX < 0 ? 1 : -1));
  }, { passive: true });

  stage.addEventListener('touchcancel', () => { touchStart = null; }, { passive: true });
  window.addEventListener('hashchange', () => render(slideFromHash()));

  render(slideFromHash());
})();
