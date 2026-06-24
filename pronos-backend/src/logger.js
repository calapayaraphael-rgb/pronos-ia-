function line(level, args) {
  const ts = new Date().toISOString();
  const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  return `${ts} [${level}] ${msg}`;
}
export const log = {
  info: (...a) => console.log(line("INFO", a)),
  warn: (...a) => console.warn(line("WARN", a)),
  error: (...a) => console.error(line("ERROR", a)),
};
