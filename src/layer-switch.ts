import {LAYERS, type LayerId} from './data';

/**
 * The layer tabs.
 *
 * Layers are fetched on first use rather than up front - each is about 3 MB,
 * and most viewers will only ever look at one or two.
 */
export class LayerSwitch {
  private buttons = new Map<LayerId, HTMLButtonElement>();
  private current: LayerId = 'co2';
  private busy = false;
  /** Seconds per layer when cycling unattended; 0 is off. See ?cycle. */
  cycleSeconds = 0;
  private elapsed = 0;

  constructor(root: HTMLElement, private onSelect: (id: LayerId) => Promise<void>) {
    for (const {id, label} of LAYERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'layer-tab';
      b.textContent = label;
      b.addEventListener('click', () => void this.select(id));
      root.appendChild(b);
      this.buttons.set(id, b);
    }
    this.mark();
  }

  async select(id: LayerId): Promise<void> {
    if (id === this.current || this.busy || !this.buttons.has(id)) return;
    this.busy = true;
    const button = this.buttons.get(id)!;
    button.classList.add('loading');
    try {
      await this.onSelect(id);
      this.current = id;
      this.mark();
    } catch (err) {
      console.error(`layer ${id} failed to load`, err);
    } finally {
      button.classList.remove('loading');
      this.busy = false;
    }
  }

  /** Number keys pick a layer by position. */
  selectByIndex(i: number): void {
    const layer = LAYERS[i];
    if (layer) void this.select(layer.id);
  }

  /** Relative move, wrapping - the arrow keys. */
  step(delta: number): void {
    const at = LAYERS.findIndex((l) => l.id === this.current);
    const next = (at + delta + LAYERS.length) % LAYERS.length;
    this.elapsed = 0; // a deliberate switch gets a full dwell before the cycle moves on
    this.selectByIndex(next);
  }

  /**
   * Advance on the render clock rather than a timer, so it keeps step with the
   * animation and stops dead when the tab is hidden instead of queueing up
   * switches to fire all at once on return.
   */
  tick(dt: number): void {
    if (this.cycleSeconds <= 0) return;
    this.elapsed += dt;
    if (this.elapsed < this.cycleSeconds) return;
    this.elapsed = 0;
    this.step(1);
  }

  private mark(): void {
    for (const [id, b] of this.buttons) b.classList.toggle('active', id === this.current);
  }
}
