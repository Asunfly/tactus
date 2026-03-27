function tryParseProtocolError(message) {
  try {
    const parsed = JSON.parse(message);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // Ignore malformed JSON-looking errors and fall back to the raw string.
  }
  return null;
}

function isIgnorableStaleContextMessage(message) {
  return /Cannot find context with specified id/i.test(message);
}

export function normalizePlaywrightProtocolError(error) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const parsed = tryParseProtocolError(rawMessage);
  const normalizedMessage = typeof parsed?.message === 'string' ? parsed.message : rawMessage;

  if (isIgnorableStaleContextMessage(normalizedMessage)) {
    return {
      code: -32001,
      message: normalizedMessage,
    };
  }

  if (typeof parsed?.message === 'string') {
    return {
      ...(typeof parsed.code === 'number' ? { code: parsed.code } : {}),
      message: parsed.message,
    };
  }

  return {
    message: normalizedMessage,
  };
}
