import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');
const logFormat = process.env.LOG_FORMAT || (isDev ? 'pretty' : 'json');

const transport = isDev && logFormat === 'pretty'
  ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
  : undefined;

export const logger = pino({
  level: logLevel,
  transport,
  base: {
    service: 'openclaw-relay',
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
