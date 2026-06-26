export function parseTelegramMessageId(messageId: string): number | undefined {
  const parsed = Number(messageId);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
