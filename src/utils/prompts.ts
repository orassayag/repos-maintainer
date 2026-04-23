import Enquirer from 'enquirer';

export interface SelectChoice<T = string> {
  name: string;
  value: T;
}

export interface SelectConfig<T = string> {
  message: string;
  choices: SelectChoice<T>[];
}

export async function select<T = string>(config: SelectConfig<T>): Promise<T> {
  const { Select } = Enquirer as any;
  const prompt = new Select({
    name: 'value',
    message: config.message,
    choices: config.choices.map(c => c.name),
    result(name: string) {
      return config.choices.find(c => c.name === name)?.value;
    }
  });

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
    validate: config.validate
  });

  return await prompt.run();
}
