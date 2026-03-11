import pino from 'pino';
import { env } from '../../config/index.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  base: {
    env: env.NODE_ENV,
  },
});

export function createLogger(name: string) {
  return logger.child({ module: name });
}

export type Logger = ReturnType<typeof createLogger>;
