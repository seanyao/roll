/* global React */
const { useState, useEffect, useRef, createContext, useContext } = React;

// ─────────────────────────────────────────────────────────────────────────────
// I18n — one context to pass the localized data tree down.
// ─────────────────────────────────────────────────────────────────────────────
const RollI18n = createContext(null);
const useT = () => useContext(RollI18n);

// ─────────────────────────────────────────────────────────────────────────────
// SectionLabel — small mono tag that opens every section
// ─────────────────────────────────────────────────────────────────────────────
function SectionLabel({ children, n }) {
  return (
    <div className="r-section-label">
      {n && <span className="r-section-num">{n}</span>}
      <span>{children}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Badge — pill, outline preferred. Label localized via i18n context.
// ─────────────────────────────────────────────────────────────────────────────
function Badge({ kind }) {
  const t = useT();
  const label = t?.UI?.badgeLabels?.[kind] ?? kind;
  return <span className={`r-badge r-badge-${kind}`}>{label}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Logo — small geometric mark
// ─────────────────────────────────────────────────────────────────────────────
function Logo({ size = 22 }) {
  return (
    <span className="r-logo" style={{ width: size, height: size }}>
      <span className="r-logo-dot" />
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Icons — minimal stroke icons (no emoji)
// ─────────────────────────────────────────────────────────────────────────────
function Icon({ name, size = 16 }) {
  const stroke = "currentColor";
  const sw = 1.5;
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke, strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "sun":  return (<svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>);
    case "moon": return (<svg {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>);
    case "copy": return (<svg {...p}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>);
    case "check":return (<svg {...p}><path d="M5 12l4.5 4.5L19 7"/></svg>);
    case "arrow":return (<svg {...p}><path d="M5 12h14M13 5l7 7-7 7"/></svg>);
    case "ext":  return (<svg {...p}><path d="M7 17 17 7M9 7h8v8"/></svg>);
    case "github": return (<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 .5C5.73.5.99 5.24.99 11.5c0 4.86 3.15 8.98 7.52 10.43.55.1.75-.24.75-.53 0-.26-.01-.95-.02-1.86-3.06.66-3.71-1.47-3.71-1.47-.5-1.27-1.22-1.6-1.22-1.6-1-.68.08-.67.08-.67 1.11.08 1.7 1.14 1.7 1.14.98 1.68 2.57 1.2 3.2.92.1-.71.39-1.2.7-1.48-2.44-.28-5.01-1.22-5.01-5.43 0-1.2.43-2.18 1.13-2.95-.11-.28-.49-1.4.11-2.92 0 0 .93-.3 3.05 1.13a10.6 10.6 0 0 1 5.55 0c2.12-1.43 3.05-1.13 3.05-1.13.6 1.52.22 2.64.11 2.92.7.77 1.13 1.75 1.13 2.95 0 4.22-2.57 5.14-5.02 5.42.4.34.76 1.02.76 2.06 0 1.49-.01 2.69-.01 3.06 0 .29.2.64.76.53 4.36-1.46 7.5-5.58 7.5-10.43C23.01 5.24 18.27.5 12 .5z"/></svg>);
    // Layer glyphs
    case "human": return (<svg {...p}><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20c.7-3.6 3.4-5.6 6.5-5.6s5.8 2 6.5 5.6"/></svg>);
    case "loop":  return (<svg {...p}><path d="M3 12a9 9 0 0 1 15.5-6.3M21 12a9 9 0 0 1-15.5 6.3"/><path d="M17 4v4h4M7 20v-4H3"/></svg>);
    case "dream": return (<svg {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/><circle cx="16" cy="9" r=".7" fill="currentColor"/><circle cx="13" cy="6" r=".7" fill="currentColor"/></svg>);
    // Guide glyphs
    case "book":   return (<svg {...p}><path d="M4 5a2 2 0 0 1 2-2h13v17H6a2 2 0 0 0-2 2V5z"/><path d="M19 17H6a2 2 0 0 0-2 2"/></svg>);
    case "cycle":  return (<svg {...p}><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>);
    case "moon2":  return (<svg {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>);
    case "swap":   return (<svg {...p}><path d="M4 7h14l-3-3M20 17H6l3 3"/></svg>);
    case "list":   return (<svg {...p}><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>);
    case "gear":   return (<svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>);
    default: return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ThemeToggle — sun / moon segmented switch (controlled)
// ─────────────────────────────────────────────────────────────────────────────
function ThemeToggle({ theme, onChange }) {
  return (
    <div className="r-theme-toggle" role="group" aria-label="Theme">
      {[{ id: "light", icon: "sun" }, { id: "dark", icon: "moon" }].map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`r-theme-btn${theme === opt.id ? " is-active" : ""}`}
          onClick={() => onChange(opt.id)}
          aria-label={opt.id}
          aria-pressed={theme === opt.id}
        >
          <Icon name={opt.icon} size={14} />
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LangToggle — EN / 中 segmented text switch
// ─────────────────────────────────────────────────────────────────────────────
function LangToggle({ lang, onChange }) {
  return (
    <div className="r-lang-toggle" role="group" aria-label="Language">
      {[{ id: "EN", label: "EN" }, { id: "ZH", label: "中" }].map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`r-lang-btn${lang === opt.id ? " is-active" : ""}`}
          onClick={() => onChange(opt.id)}
          aria-pressed={lang === opt.id}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// InstallSnippet — copyable terminal snippet
// ─────────────────────────────────────────────────────────────────────────────
function InstallSnippet({ command }) {
  const t = useT();
  const labels = t?.UI?.installCopy ?? { idle: "copy", done: "copied" };
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard?.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <button type="button" className="r-install" onClick={onCopy} aria-label="Copy install command">
      <span className="r-install-prompt">$</span>
      <span className="r-install-cmd">{command}</span>
      <span className="r-install-copy" aria-hidden>
        <Icon name={copied ? "check" : "copy"} size={14} />
        <span className="r-install-copy-label">{copied ? labels.done : labels.idle}</span>
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Terminal — animated log of a real loop cycle
// ─────────────────────────────────────────────────────────────────────────────
function Terminal({ lines, animate = true }) {
  const t = useT();
  const liveLabel = t?.UI?.terminalLive ?? "live";
  const [count, setCount] = useState(animate ? 0 : lines.length);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!animate) { setCount(lines.length); return; }
    let i = 0;
    setCount(0);
    const tick = () => {
      i += 1;
      setCount(i);
      if (i < lines.length) {
        const next = lines[i];
        const delay = next.kind === "blank" ? 120 : next.kind === "stamp" ? 700 : 380;
        timerRef.current = setTimeout(tick, delay);
      }
    };
    timerRef.current = setTimeout(tick, 500);
    return () => clearTimeout(timerRef.current);
  }, [animate, lines]);

  const shown = lines.slice(0, count);

  return (
    <div className="r-terminal" role="img" aria-label="Roll loop terminal session">
      <div className="r-terminal-chrome">
        <span className="r-terminal-dot" style={{ background: "#ff5f57" }} />
        <span className="r-terminal-dot" style={{ background: "#febc2e" }} />
        <span className="r-terminal-dot" style={{ background: "#28c840" }} />
        <span className="r-terminal-title">roll-loop-roll · tmux</span>
        <span className="r-terminal-status">
          <span className="r-pulse" /> {liveLabel}
        </span>
      </div>
      <div className="r-terminal-body">
        {shown.map((l, i) => <TerminalLine key={i} line={l} />)}
      </div>
    </div>
  );
}

function TerminalLine({ line }) {
  if (line.kind === "blank") return <div className="r-tl-blank" />;
  if (line.kind === "cursor") return <div className="r-tl-cursor"><span className="r-tl-caret" /></div>;
  if (line.kind === "prompt") {
    return (
      <div className="r-tl r-tl-prompt">
        <span className="r-tl-sym">$</span>
        <span className="r-tl-cmd">{line.text}</span>
      </div>
    );
  }
  if (line.kind === "ok") {
    return (
      <div className="r-tl r-tl-ok">
        <span className="r-tl-sym">✓</span>
        <span className="r-tl-label">{line.text}</span>
        {line.detail && <span className="r-tl-detail">{line.detail}</span>}
      </div>
    );
  }
  if (line.kind === "stamp") {
    return (
      <div className={`r-tl r-tl-stamp${line.muted ? " r-tl-muted" : ""}`}>
        <span className="r-tl-time">[{line.time}]</span>
        <span className="r-tl-text">{line.text}</span>
      </div>
    );
  }
  if (line.kind === "step") {
    return (
      <div className={`r-tl r-tl-step${line.ok ? " r-tl-step-ok" : ""}`}>
        <span className="r-tl-arrow">→</span>
        <span className="r-tl-arrowLabel">{line.arrow}</span>
        <span className="r-tl-mid">{line.label}</span>
        <span className="r-tl-detail">· {line.text}</span>
      </div>
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FeatureCard — reused across feature groups
// ─────────────────────────────────────────────────────────────────────────────
function FeatureCard({ feature, domain }) {
  return (
    <article className="r-card r-feature">
      {domain && <div className="r-domain">{domain}</div>}
      <div className={`r-feature-name${feature.mono ? " is-mono" : ""}`}>{feature.name}</div>
      <p className="r-feature-desc">{feature.desc}</p>
      {feature.badges?.length > 0 && (
        <div className="r-feature-badges">
          {feature.badges.map((b, i) => <Badge key={i} kind={b} />)}
        </div>
      )}
    </article>
  );
}

// Expose
Object.assign(window, { RollI18n, useT, SectionLabel, Badge, Logo, Icon, ThemeToggle, LangToggle, InstallSnippet, Terminal, FeatureCard });
