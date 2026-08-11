export class CommunicationsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommunicationsConfigurationError';
  }
}

export class CommunicationsApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseBody?: unknown
  ) {
    super(message);
    this.name = 'CommunicationsApiError';
  }
}
