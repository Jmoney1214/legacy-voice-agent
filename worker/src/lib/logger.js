// Structured JSON logger with request ID tracing

export function createLogger(requestId) {
  function emit(level, message, data) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      requestId,
      message,
    };
    if (data !== undefined) {
      entry.data = data;
    }
    console.log(JSON.stringify(entry));
  }

  return {
    info: (message, data) => emit("info", message, data),
    warn: (message, data) => emit("warn", message, data),
    error: (message, data) => emit("error", message, data),
  };
}
