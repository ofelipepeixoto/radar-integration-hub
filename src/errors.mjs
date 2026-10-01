export class HubError extends Error {
  constructor(code) { super(code); this.name = 'HubError'; this.code = code; }
}
