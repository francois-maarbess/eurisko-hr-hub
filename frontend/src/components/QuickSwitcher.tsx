import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface QuickSwitcherItem {
  id: string;
  label: string;
  description: string;
  group: string;
  keywords?: string;
  onSelect: () => void;
}

export default function QuickSwitcher({ items, onClose }: { items: QuickSwitcherItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.label} ${item.description} ${item.keywords || ''}`.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setActiveIndex(0);
  };

  const choose = (item: QuickSwitcherItem | undefined) => {
    if (!item) return;
    item.onSelect();
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  };

  return (
    <>
      <div className="modal-backdrop quick-switcher-backdrop" onClick={onClose} />
      <div className="quick-switcher" role="dialog" aria-modal="true" aria-label="Quick switcher">
        <div className="quick-switcher-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></svg>
          <input
            ref={inputRef}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder="Search pages and requests..."
            aria-label="Search pages and requests"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="quick-switcher-results" role="listbox" aria-label="Search results">
          {results.length === 0 ? (
            <div className="quick-switcher-empty">No matching pages or requests.</div>
          ) : (
            results.map((item, index) => (
              <button
                key={item.id}
                className={`quick-switcher-item${index === activeIndex ? ' active' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(item)}
                role="option"
                aria-selected={index === activeIndex}
              >
                <span className="quick-switcher-item-icon" aria-hidden="true">{item.group === 'Requests' ? '↗' : '⌘'}</span>
                <span className="quick-switcher-item-copy">
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </span>
                <span className="quick-switcher-group">{item.group}</span>
              </button>
            ))
          )}
        </div>
        <div className="quick-switcher-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Open</span>
        </div>
      </div>
    </>
  );
}
