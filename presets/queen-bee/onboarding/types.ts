// The onboarding workflow's instance state type, self-contained for the
// referenced onboarding ops. Onboarding carries no workflow-instance domain
// data — it drives flow config and git only.

export type OnboardingState = Record<string, never>;
