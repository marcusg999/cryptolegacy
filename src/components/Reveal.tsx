'use client';

import { useEffect } from 'react';

/**
 * Drives [data-reveal] across the app.
 *
 * First-party, tiny, and in the bundle rather than on a CDN — the CSP forbids
 * a third-party script on any page that touches decrypted content, and most
 * pages in this app do.
 */
export function Reveal() {
  useEffect(() => {
    const els = document.querySelectorAll('[data-reveal]');
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach((el) => el.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return null;
}
