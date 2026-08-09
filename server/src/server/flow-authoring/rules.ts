/** The rules rung of the flow-authoring knowledge: the failure modes observed
 * in real generated flows, stated positively as rules the model must follow.
 * Each rule exists because a real generation violated it — see the failure
 * table in the module doc for the history. Phrased as "do this", never "don't
 * do that". */

export const AUTHORING_RULES = `## Rules that make generated flows actually work

- Every \`ai-task\` and \`ai-chat\` declares a \`systemPrompt\` that names the job and the completion tool to call. A prompt-less agent produces prose instead of structured output, or the runner fails fast.
- When an ai-task must return data, declare \`completionOutput\` with exactly the fields the flow records — the only output an ai-task can carry is its completion-tool arguments.
- Record structured output with a sibling operation \`patch\` task that copies \`output.<field>\` into instanceState, and gate its \`taskError\` into a retry/needs-review state. A patch op fails when a sourced value is missing, so that state is mandatory, not optional.
- Every instance-state field shown by \`instance\`/\`display\` hints has a writer: a patch op, an edge field, a createInstance payload key, or an engine op. An instance that displays a field nothing writes is a broken card.
- Every created instance receives its seed data. Required createInstance fields reject empty values, and auto tasks seed their input from instanceState — so give each new instance the field its first task reads.
- A task's completion tool is offered automatically; list only infrastructure tools explicitly in \`tools\`.
- Every workflow with fallible tasks has a way out: a needs-review/error state with a retry action. An instance that can never leave a running state is a zombie.
- Design the whole lifecycle before writing the spec: which states exist, which are reachable from \`initial\`, which transitions fire under which gate, which terminals finish. A state nothing reaches, or that cannot leave, is a design flaw the check flags.
- Choose the pattern that matches the request (structured intake, human review, pipeline/fan-out, git-backed work) and copy its shape — do not improvise a new lifecycle when a tested one fits.`;
