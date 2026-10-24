import { StackcrewError } from '../errors.js';

/** Replace `{{sc:name}}` placeholders only; other brace syntax passes through. */
export function fillTemplate(text, vars) {
  return text.replace(/\{\{sc:([A-Za-z0-9_]+)\}\}/g, (_, name) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      throw new StackcrewError('TEMPLATE', `Unknown template placeholder {{sc:${name}}}`);
    }
    return vars[name];
  });
}
