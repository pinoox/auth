import type { AuthLogEvent, AuthLogSink } from './types';

export interface AuthLogger {
  emit: (event: AuthLogEvent) => void;
  debug: (code: string, message: string, context?: Record<string, unknown>) => void;
  info: (code: string, message: string, context?: Record<string, unknown>) => void;
  warn: (code: string, message: string, context?: Record<string, unknown>) => void;
  error: (code: string, message: string, context?: Record<string, unknown>) => void;
  setSink: (sink: AuthLogSink | null) => void;
}

const defaultSink = (event: AuthLogEvent, enabled: boolean): void => {
  if (!enabled && event.level === 'debug') {
    return;
  }

  const prefix = `[pinoox-auth:${event.code}]`;
  const payload = event.context ? [prefix, event.message, event.context] : [prefix, event.message];

  switch (event.level) {
    case 'error':
      console.error(...payload);
      break;
    case 'warn':
      console.warn(...payload);
      break;
    case 'info':
      console.info(...payload);
      break;
    default:
      console.debug(...payload);
  }
};

export function createLogger(debug = false, sink?: AuthLogSink | null): AuthLogger {
  let customSink = sink ?? null;

  const emit = (event: AuthLogEvent): void => {
    if (customSink) {
      customSink(event);
      return;
    }

    defaultSink(event, debug);
  };

  return {
    emit,
    debug: (code, message, context) => emit({ level: 'debug', code, message, context }),
    info: (code, message, context) => emit({ level: 'info', code, message, context }),
    warn: (code, message, context) => emit({ level: 'warn', code, message, context }),
    error: (code, message, context) => emit({ level: 'error', code, message, context }),
    setSink: (next) => {
      customSink = next;
    },
  };
}
