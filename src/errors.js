/**
 * Error with a machine-readable code.
 * Codes: 'FRONTMATTER' | 'TEMPLATE' | 'CATALOG' | 'PROFILE' | 'MARKER' | 'BUDGET' | 'RENDER' | 'GIT'
 */
export class StackcrewError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'StackcrewError';
  }
}
