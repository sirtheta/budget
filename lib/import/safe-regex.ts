import vm from "node:vm";
import type { Groups, LineMatcher } from "@/lib/import/pdf-parse";

/**
 * Regex execution with a hard timeout, for layouts that users write.
 *
 * A pattern like `(a+)+$` backtracks exponentially and, run in-process, would
 * freeze the Node event loop for every user. `vm.Script#runInContext` with
 * `timeout` makes V8 terminate the running script — verified on Node 24 to
 * interrupt a catastrophic regex — so the worst case is bounded to the budget.
 *
 * The regex and the lines enter the context as data (a string and JSON); no
 * user text is ever evaluated as code. This is a timeout, not a security
 * sandbox.
 *
 * One script run covers one regex over all lines: a `runInContext` call costs
 * about 0.1 ms, which per line would add up for a long statement.
 */

const MESSAGE = "Ein Regex im Layout braucht zu lange (vermutlich endloses Backtracking). Bitte vereinfachen.";

export class RegexTimeoutError extends Error {
  constructor() {
    super(MESSAGE);
  }
}

export interface SafeMatcherOptions {
  /** Longest a single regex may run over all lines. */
  perRegexMs?: number;
  /** Longest all regexes of one matcher may run together. */
  totalMs?: number;
}

const RUN = new vm.Script(`(function () {
  var lines = JSON.parse(__lines);
  var re = new RegExp(__source);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var m = re.exec(lines[i]);
    out.push(m ? (m.groups ? Object.assign({}, m.groups) : {}) : null);
  }
  return JSON.stringify(out);
})()`);

export function createSafeMatcher({ perRegexMs = 500, totalMs = 2000 }: SafeMatcherOptions = {}): LineMatcher {
  let remaining = totalMs;

  return (source, lines) => {
    if (remaining <= 0) throw new RegexTimeoutError();
    const context = vm.createContext({ __source: source, __lines: JSON.stringify(lines) });
    const started = performance.now();
    try {
      const json = RUN.runInContext(context, { timeout: Math.max(1, Math.min(perRegexMs, Math.ceil(remaining))) });
      return JSON.parse(json as string) as (Groups | null)[];
    } catch (err) {
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
        remaining = 0;
        throw new RegexTimeoutError();
      }
      throw err;
    } finally {
      remaining -= performance.now() - started;
    }
  };
}
