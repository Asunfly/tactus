export function formatServerErrorMessage(baseMessage: string, status?: number | null): string {
  if (!status || status < 500) {
    return baseMessage;
  }
  return `${baseMessage}（HTTP ${status}）`;
}
