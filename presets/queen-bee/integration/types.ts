// The integration workflow's instance state type, self-contained for the
// referenced integration op. The integration workflow carries no
// workflow-instance domain data — it only drives flow config and git.

export type IntegrationState = Record<string, never>;
