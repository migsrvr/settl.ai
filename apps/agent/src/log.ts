export type Logger = (level: 'info' | 'warning' | 'error', message: string) => void;

export function createLogger(secrets: string[] = [], output: (line: string) => void = console.log): Logger {
  const values = secrets.filter(Boolean).sort((a, b) => b.length - a.length);
  return (level, message) => {
    let safe = message;
    for (const secret of values) safe = safe.split(secret).join('[redacted]');
    safe = safe.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
      .replace(/\b(?:sk-|gsk_|AIza|stl_agent_)[A-Za-z0-9_-]+/g, '[redacted]');
    output(`[${level}] ${safe}`);
  };
}
