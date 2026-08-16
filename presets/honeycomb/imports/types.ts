// The imports workflow's instance state type, self-contained for the
// referenced imports ops (they cannot import types from the rendered entry).

export type ParsedIdea = { title: string; text: string; source: string };

export type ImportsState = {
  name?: string;
  source?: string;
  rawText?: string;
  // The parse task's input digest (source + rawText as JSON), written by
  // prepare_input so the parse agent can tag every split idea's source.
  digest?: string;
  // The parse task's output, recorded for the import card's display.
  ideas?: ParsedIdea[];
};
