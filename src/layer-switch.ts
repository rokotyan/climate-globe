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

  private mark(): void {
    for (const [id, b] of this.buttons) b.classList.toggle('active', id === this.current);
  }
}
