'use client';
import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
export default function ThemeToggle() {
  const [utac, setUtac] = useState(true);
  useEffect(() => {
    setUtac(document.documentElement.dataset.theme === 'utac');
  }, []);
  function toggle() {
    const next = !utac;
    document.documentElement.dataset.theme = next ? 'utac' : 'dark';
    try {
      localStorage.setItem('nexus-theme', next ? 'utac' : 'dark');
    } catch {}
    setUtac(next);
  }
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label={utac ? 'Switch to dark theme' : 'Switch to UTAC theme'}
      aria-pressed={utac}
      title={utac ? 'Return to NEXUS dark theme' : 'Use UTAC-inspired colors'}
    >
      {utac ? <Moon size={16} /> : <Sun size={16} />}
      <span>{utac ? 'Dark theme' : 'UTAC theme'}</span>
    </button>
  );
}

