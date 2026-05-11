import Enquirer from 'enquirer';

interface SelectChoice<T = string> {
  name: string;
  value: T;
}

export interface SelectConfig<T = string> {
  message: string;
  choices: SelectChoice<T>[];
}

const ESC_GUARD_MS = 200;
let lastEscTimestamp: number | null = null;

function recordEsc(): void {
  lastEscTimestamp = Date.now();
}

function msSinceLastEsc(): number {
  if (lastEscTimestamp === null) return Infinity;
  return Date.now() - lastEscTimestamp;
}

function patchCancel(prompt: any): void {
  let cancelled = false;

  prompt.cancel = (_err?: any): any => {
    const age = msSinceLastEsc();
    if (age < ESC_GUARD_MS) {
      return; // swallow phantom cancel from readline timer
    }
    if (cancelled) return;
    cancelled = true;
    recordEsc();

    // Clean up enquirer's internal readline listeners before exiting
    // to prevent the "ERR_USE_AFTER_CLOSE: readline was closed" error
    if (prompt.close) {
      prompt.close();
    }

    console.log('\n👋 Goodbye!');
    process.exit(0);
  };
}

export async function select<T = string>(config: SelectConfig<T>): Promise<T> {
  const { Select } = Enquirer as any;
  const prompt = new Select({
    name: 'value',
    message: config.message,
    choices: config.choices.map((c) => c.name),
    result(name: string): T | undefined {
      return config.choices.find((c) => c.name === name)?.value;
    },
    escape(): void {
      this.cancel();
    },
  });

  patchCancel(prompt);

  return await prompt.run();
}

export interface InputConfig {
  message: string;
  validate?: (input: string) => boolean | string | Promise<boolean | string>;
}

export async function input(config: InputConfig): Promise<string> {
  const { Input } = Enquirer as any;
  const prompt = new Input({
    name: 'value',
    message: config.message,
    validate: config.validate,
    escape(): void {
      this.cancel();
    },
  });

  patchCancel(prompt);

  return await prompt.run();
}
