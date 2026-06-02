import { useCallback, useEffect, useRef, useState } from 'react';

const SOUND_URL = `${import.meta.env.BASE_URL}sounds/notification.wav`;

/**
 * Plays the project's notification sound (public/sounds/notification.wav).
 * Falls back silently if the browser blocks autoplay before user interaction.
 */
export function useNotificationSound() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isArmed, setIsArmed] = useState(false);

  useEffect(() => {
    if (!audioRef.current) {
      const a = new Audio(SOUND_URL);
      a.preload = 'auto';
      a.volume = 0.9;
      audioRef.current = a;
    }
    const arm = () => {
      setIsArmed(true);
      // Try a silent play to unlock autoplay policy
      const a = audioRef.current;
      if (a) {
        const prev = a.volume;
        a.volume = 0;
        a.play().then(() => { a.pause(); a.currentTime = 0; a.volume = prev; }).catch(() => { a.volume = prev; });
      }
    };
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, []);

  const playNotificationSound = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!isArmed) return;
    let a = audioRef.current;
    if (!a) {
      a = new Audio(SOUND_URL);
      a.volume = 0.9;
      audioRef.current = a;
    }
    try {
      a.currentTime = 0;
      await a.play();
    } catch {
      // ignore autoplay errors
    }
  }, [isArmed]);

  return { playNotificationSound };
}
