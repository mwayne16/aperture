import { ValidateBy, ValidateIf } from 'class-validator';

/** Checks one untrusted value and returns the problem to show, or null when the value is valid. */
type FieldRule = (value: unknown) => string | null;

/**
 * Validates a property with one of the shared field rules, so the API reports the same message as
 * the app's forms.
 */
export function FollowsRule(rule: FieldRule): PropertyDecorator {
  return ValidateBy({
    name: 'followsRule',
    validator: {
      validate: (value: unknown) => rule(value) === null,
      defaultMessage: (args?: { value: unknown }) => rule(args?.value) ?? '',
    },
  });
}

/**
 * Skips the property's other validators when it is omitted. Unlike IsOptional, an explicit null is
 * still validated, so `{ "targetPrice": null }` is rejected instead of passing as "no change".
 */
export function Omittable(): PropertyDecorator {
  return ValidateIf((_object: object, value: unknown) => value !== undefined);
}
