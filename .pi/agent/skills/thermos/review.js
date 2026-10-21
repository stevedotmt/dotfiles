const task = [
  `Review branch ${args.branch} in ${args.repo}: HEAD ${args.head} against merge-base ${args.base} (${args.baseRef}).`,
  `Intent: ${args.intent}.`,
  `Read the complete context file ${args.context} (### Git / diff output and ### Changed file contents), in chunks as needed.`,
  "Return prioritized findings with exact file:line references and evidence."
].join(" ");
const results = await runs.all([
  { key: "audit", agent: "thermo-nuclear-review-subagent", task },
  { key: "quality", agent: "thermo-nuclear-code-quality-review-subagent", task }
]);
return results.map(r => ({ agent: r.agent, ok: r.ok, error: r.error, output: r.output }));
