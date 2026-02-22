import React, { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink } from 'react-router-dom';
import { getPersona, switchPersona } from '../services/api';
import type { PersonaResponse } from '../types/api';
import './TopNav.css';

const NAV_ITEMS = [
  { to: '/',            label: 'Star Map',   icon: '✦' },
  { to: '/simulation',  label: 'Simulation', icon: '⚙' },
  { to: '/data-qa',     label: 'Data QA',    icon: '◉' },
  { to: '/admin',       label: 'Admin',      icon: '⌘' },
];

export default function TopNav() {
  const [persona, setPersona] = useState<PersonaResponse | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const fetchPersona = useCallback(async () => {
    try {
      const data = await getPersona();
      setPersona(data);
    } catch {
      // API not ready yet — that's fine
    }
  }, []);

  useEffect(() => { fetchPersona(); }, [fetchPersona]);

  // Close menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleSwitch(key: string) {
    try {
      await switchPersona(key);
      await fetchPersona();
    } catch { /* noop */ }
    setMenuOpen(false);
  }

  const currentLabel = persona?.current_persona?.label ?? 'Loading…';

  return (
    <nav className="topnav">
      {/* Brand */}
      <div className="topnav-brand">
        <span className="topnav-logo">✦</span>
        <span className="topnav-title">ExoMaps</span>
      </div>

      {/* Center — page links */}
      <div className="topnav-links">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `topnav-link${isActive ? ' active' : ''}`
            }
          >
            <span className="topnav-link-icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </div>

      {/* Right — persona selector */}
      <div className="topnav-persona" ref={menuRef}>
        <button
          className="topnav-persona-btn"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className="persona-dot" />
          {currentLabel}
          <span className="caret">{menuOpen ? '▴' : '▾'}</span>
        </button>

        {menuOpen && persona && (
          <div className="persona-dropdown">
            <div className="persona-dropdown-header">Switch persona</div>
            {persona.available_personas.map((p) => (
              <button
                key={p.key}
                className={`persona-option${
                  p.key === persona.current_persona_key ? ' selected' : ''
                }`}
                onClick={() => handleSwitch(p.key)}
              >
                {p.label}
                {p.key === persona.current_persona_key && (
                  <span className="check">✓</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
