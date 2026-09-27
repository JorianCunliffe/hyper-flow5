/** Preserve JSON API errors for callers, but do not parse platform error pages as JSON. */
export function checkApiResponse(response: Response): Response {
  if (!response.ok && !/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) {
    const requestId = response.headers.get('x-vercel-id');
    throw new Error(`Server request failed (HTTP ${response.status}). Please try again.${requestId ? ` Reference: ${requestId}` : ''}`);
  }
  return response;
}
