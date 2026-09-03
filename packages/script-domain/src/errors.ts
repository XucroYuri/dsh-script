export type DomainErrorCode = 'validation' | 'invalid-state' | 'revision-conflict' | 'forbidden' | 'not-found'

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}
