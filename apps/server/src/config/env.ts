import { Expose, Transform } from 'class-transformer';

/**
 * Decorators that bind a config property to an environment variable and convert its text. The loader
 * drops blank variables first, so `PORT=` in a .env file falls back to the default instead of failing.
 */

/** Environment variable name for each config property, so validation errors name the variable to fix. */
const envNames = new Map<string, string>();

export function envNameOf(property: string): string {
  return envNames.get(property) ?? property;
}

function readText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

function bind(name: string, parse: (value: unknown) => unknown): PropertyDecorator {
  return (target, property) => {
    envNames.set(String(property), name);
    Expose({ name })(target, property);
    Transform(({ value }) => parse(readText(value)))(target, property);
  };
}

/** Reads a text variable. */
export function Env(name: string): PropertyDecorator {
  return bind(name, (value) => value);
}

/** Reads a whole-number variable. Text that isn't a number becomes NaN, which validation rejects. */
export function EnvInt(name: string): PropertyDecorator {
  return bind(name, (value) => (typeof value === 'string' ? Number(value) : value));
}
