/**
 * Dark and light themes.
 *
 * The piece was made for black - a globe hanging in nothing - and that stays the
 * default. Light is for the places black does not sit well: a page it is
 * embedded in, a slide, a print. Everything the HUD draws comes from the custom
 * properties in style.css, so the theme is one attribute on <html>; the only
 * thing outside CSS's reach is the WebGL clear colour, which the renderer reads
 * back from the same stylesheet via `background`.
 *
 * Where the opening theme comes from, in order: `?theme=` in the URL (so the
 * recorder and an embed can ask for one outright), then a choice the viewer
 * made here before, then the OS preference. Only an explicit toggle is saved -
 * a URL parameter is a request for this visit, not a preference - and until the
 * viewer has chosen, the page keeps following the OS if it changes.
 */

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'climate-globe:theme';

const SUN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="4"/>' +
  '<path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8' +
  'M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>';

const MOON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/></svg>';

function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

function savedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isTheme(v) ? v : null;
  } catch {
    return null;
  }
}

function osTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function initialTheme(params: URLSearchParams): Theme {
  const requested = params.get('theme');
  if (isTheme(requested)) return requested;
  return savedTheme() ?? osTheme();
}

export class ThemeSwitch {
  private current: Theme;
  /** Fires after the attribute is set, so CSS-derived values read back right. */
  onChange: ((theme: Theme) => void) | null = null;

  constructor(private button: HTMLButtonElement, initial: Theme) {
    this.current = initial;
    this.apply();
    button.addEventListener('click', () => this.toggle());

    // Follow the OS until the viewer makes a choice of their own.
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    media?.addEventListener('change', (e) => {
      if (savedTheme() === null) this.set(e.matches ? 'light' : 'dark', false);
    });
  }

  get theme(): Theme {
    return this.current;
  }

  /** The 't' key and the button both land here. */
  toggle(): void {
    this.set(this.current === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme, remember = true): void {
    if (remember) {
      try {
        localStorage.setItem(STORAGE_KEY, theme);
      } catch {
        // Private mode or storage disabled: the choice just does not persist.
      }
    }
    if (theme === this.current) return;
    this.current = theme;
    this.apply();
    this.onChange?.(theme);
  }

  /**
   * The page background as 0..1 rgb, read from the stylesheet so the canvas
   * clears to exactly what the CSS around it shows - one definition, not two
   * that have to be kept in step by hand.
   */
  get background(): [number, number, number] {
    const css = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    return parseHex(css) ?? (this.current === 'light' ? [1, 1, 1] : [0, 0, 0]);
  }

  private apply(): void {
    const theme = this.current;
    document.documentElement.dataset.theme = theme;
    // The browser chrome on phones takes its colour from here; left at black it
    // would cap a light page with a dark bar.
    const hex = toHex(this.background);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hex);

    // The icon shows where the button goes, not where the page is.
    const toLight = theme === 'dark';
    this.button.innerHTML = toLight ? SUN : MOON;
    const label = toLight ? 'Switch to light theme' : 'Switch to dark theme';
    this.button.setAttribute('aria-label', label);
    this.button.title = `${label} (t)`;
  }
}

/** `#rgb` or `#rrggbb` to 0..1 components; anything else is null. */
function parseHex(css: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const n = parseInt(hex, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
