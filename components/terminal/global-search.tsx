"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { buildSearchIndex, looksLikeSymbol, search, type SearchEntry } from "@/lib/search";

const CATEGORY_TAG: Record<string, string> = {
  Index: "IDX",
  Indicator: "IND",
  "Fixed income": "FI",
  Sector: "SEC",
};

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/**
 * Command bar: global search over the terminal catalogue, plus function codes.
 * Ctrl/⌘+K or "/" focuses it; arrows move; Enter opens; Escape closes.
 */
export function GlobalSearch() {
  const router = useRouter();
  const index = useMemo(() => buildSearchIndex(), []);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const groups = useMemo(() => search(index, query), [index, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.results), [groups]);
  const showPanel = open && query.trim().length > 0;
  const active = flat[activeIndex];
  const optionId = (entry: SearchEntry) => `${listId}-${entry.id.replace(/[^a-zA-Z0-9-]/g, "-")}`;

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      } else if (event.key === "/" && !isTypingTarget(event.target)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(entry: SearchEntry) {
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
    router.push(entry.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter" && active) {
      event.preventDefault();
      go(active);
    } else if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div
      className="cmd"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <span className="cmd-prompt" aria-hidden="true">›</span>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showPanel && active ? optionId(active) : undefined}
        aria-label="Search functions, indices, indicators and sectors"
        placeholder="Search, or type a function code — ECO, MKT, FI…"
        value={query}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <kbd className="cmd-kbd" aria-hidden="true">Ctrl K</kbd>
      {showPanel && (
        <div className="cmd-panel">
          <ul id={listId} role="listbox" aria-label="Search results">
            {groups.map((group) => (
              <li key={group.category} role="presentation">
                <div className="cmd-group" role="presentation">{group.category}</div>
                <ul role="group" aria-label={group.category}>
                  {group.results.map((entry) => {
                    const i = flat.indexOf(entry);
                    const isActive = i === activeIndex;
                    return (
                      <li
                        key={entry.id}
                        id={optionId(entry)}
                        role="option"
                        aria-selected={isActive}
                        className={`cmd-option${isActive ? " is-active" : ""}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveIndex(i)}
                        onClick={() => go(entry)}
                      >
                        <span className={`cmd-code${entry.code ? "" : " is-muted"}`}>{entry.code ?? CATEGORY_TAG[entry.category]}</span>
                        <span className="cmd-label">{entry.label}</span>
                        <span className="cmd-detail">{entry.detail}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
          {flat.length === 0 && <p className="cmd-empty">No matching function, index, indicator or sector.</p>}
          {looksLikeSymbol(query) && (
            <p className="cmd-note">Company and symbol search activates when NGX reference data is connected.</p>
          )}
        </div>
      )}
    </div>
  );
}
