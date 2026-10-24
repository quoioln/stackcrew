import { StackcrewError } from '../errors.js';

/** Replace `{{sc:name}}` placeholders only; other brace syntax passes through. */
export function fillTemplate(text, vars) {
  return text.replace(/\{\{sc:([^}]*)\}\}/g, (_, name) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) {
      throw new StackcrewError('TEMPLATE', `Unknown template placeholder {{sc:${name}}}`);
    }
    if (typeof vars[name] !== 'string') {
      throw new StackcrewError('TEMPLATE', `Template value for {{sc:${name}}} is not a string`);
    }
    return vars[name];
  });
}
