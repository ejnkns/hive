// The imports workflow's instance state type, self-contained for the
// referenced imports ops (they cannot import types from the rendered entry).

export type ParsedIdea = {
  title: string;
  text: string;
  category: string;
  tags: string[];
  priority: string;
  effort: string;
  status: string;
  summary: string;
};

export type ImportsState = {
  name?: string;
  rawText?: string;
  // The parse task's input digest (rawText as JSON), written by prepare_input
  // so the parse agent knows what to split and classify.
  digest?: string;
  // The parse task's output, recorded for the import card's display.
  ideas?: ParsedIdea[];
};
