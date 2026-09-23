'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Records that this announcement was actually on screen.
 *
 * Tied to the element becoming visible rather than to the page loading: a read receipt
 * that fires for everything in a scrolling list the moment the page opens makes "412 of
 * 480 have seen this" a lie, and the whole point of the number is that an admin can trust
 * it before deciding to send the message again.
 */
export function MarkAnnouncementRead({ id }: { id: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  const router = useRouter();
  const sent = useRef(false);

  useEffect(() => {
    const element = marker.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || sent.current) continue;
          sent.current = true;
          observer.disconnect();
          void fetch(`/api/announcements/${id}/read`, { method: 'POST' })
            .then(() => router.refresh())
            .catch(() => {
              // A missed receipt is a slightly low count, not a broken page.
            });
        }
      },
      { threshold: 0.6 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [id, router]);

  return <span ref={marker} aria-hidden className="block h-px w-px" data-testid="read-marker" />;
}
