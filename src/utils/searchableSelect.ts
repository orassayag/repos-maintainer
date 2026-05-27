import Enquirer from 'enquirer';

const { Select } = Enquirer as any;

type Choice = {
  name: string;
  value: any;
};

type KeypressEvent = {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
};

const PASSTHROUGH_KEYS = new Set([
  'up',
  'down',
  'return',
  'enter',
  'escape',
  'tab',
  'pageup',
  'pagedown',
  'home',
  'end',
]);

/**
 * A searchable select prompt for Enquirer.
 * Adapted from events-and-people-syncer.
 */
export class SearchableSelect extends (Select as { new (options: any): any }) {
  protected searchTerm: string = '';
  protected _allChoices: Choice[] | null = null;

  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(options: any) {
    super(options);
  }

  async initialize(): Promise<void> {
    await super.initialize();
    this._allChoices = (this as any).choices.slice();
  }

  async dispatch(s: string | undefined, key: KeypressEvent): Promise<void> {
    const isPassthrough =
      !s || key?.ctrl || key?.meta || PASSTHROUGH_KEYS.has(key?.name ?? '');

    if (isPassthrough) {
      await super.dispatch(s, key);
      return;
    }

    if (key?.name === 'backspace') {
      if (this.searchTerm.length > 0) {
        this.searchTerm = this.searchTerm.slice(0, -1);
      }
    } else {
      this.searchTerm += s;
    }

    this._applyFilter();
    (this as any).render();
  }

  private _applyFilter(): void {
    if (!this._allChoices) return;
    const term = this.searchTerm.toLowerCase();
    const filtered = this._allChoices.filter((c: Choice) =>
      c.name.toLowerCase().includes(term)
    );

    (this as any).choices = filtered;
    (this as any).index = Math.min((this as any).index, filtered.length - 1);
    if ((this as any).index < 0) (this as any).index = 0;
  }

  header(): Promise<string> {
    const cursor = '█';
    const matchCount = (this as any).choices.length;
    const totalCount = this._allChoices?.length ?? 0;
    const styles = (this as any).styles;

    const headerText = `  Search: ${this.searchTerm}${cursor} (${matchCount}/${totalCount} matches)`;

    return Promise.resolve(
      styles && styles.muted ? styles.muted(headerText) : headerText
    );
  }
}
