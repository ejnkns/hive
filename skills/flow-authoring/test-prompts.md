# Flow generation test prompts

Copy-paste prompts for testing flow generation in the definition editor's AI
pane. Every prompt can be run two ways:

- **Start conversation** — the agent asks clarifying questions and drafts the
  spec with you. Good for testing the conversational loop: questions should be
  few and design-relevant, and the spec preview should update after every
  decision.
- **I'm feeling lucky** — the agent produces the spec in one shot, no
  questions. Good for testing the one-shot path: no mid-generation stalls, the
  preview appears when the agent commits the spec, and Finalize lands the
  gate-clean source in the editor.

The prompts deliberately cover different domains to test that generation is
domain-agnostic, and different engine capabilities (multi-workflow + edges,
fan-out of structured output, HITL chat, escalation/retry, git work,
cross-instance dependencies).

## What to verify on every run

- The session reaches **done** and the gate-passed TypeScript lands in the
  editor automatically.
- **I'm feeling lucky**: the agent writes the spec without asking questions and
  finalizes on its own. If it stalls, the console should show the 60s timeout
  behavior — not a 10s kill.
- **Conversational**: the agent asks only what actually changes the design,
  then drafts; the spec preview updates after each `set_flow_spec`.
- The final definition has: a `systemPrompt` on every ai-task/ai-chat,
  `completionOutput` for any structured data, a `needs_review`-style escape
  hatch for fallible tasks, and zero gate warnings.
- **Close session** cleans up (the flow disappears from the library); reloading
  the page resumes an open session.

---

## 1. Ticket triage (structured intake — baseline)

```text
A flow where users submit support tickets. An AI triages each ticket into a
category, a priority (low/medium/high), and a suggested team. After triage a
human resolves the ticket or escalates it.
```

Expect: single workflow, one ai-task with `completionOutput` (category,
priority, suggested team), a patch op, `taskError` → needs_review with
retry/discard, and manual resolve/escalate actions. The baseline — start here
on any change.

## 2. Incident response (multi-workflow + fan-out + HITL chat)

```text
A flow for incident response. Users file incidents with a description and
impact level. An AI triages each incident: assigns a severity (sev1/sev2/sev3),
a short root-cause hypothesis, and a list of investigation tasks. Each
investigation task becomes its own workflow instance with a title and an
assignee team, which a responder marks done when complete. While tasks run, the
on-call engineer can open a chat session with an AI assistant on the incident
to coordinate. When all tasks for an incident are done, the incident is
resolved; if triage fails, the incident goes to needs_review for a human to fix
and retry.
```

Expect: two workflows connected by a `fanOut` edge (`object[]` completion
output), an ai-chat HITL session alongside the pipeline, and a needs_review
escape hatch. Watch how it expresses "when all tasks are done" — the gate
vocabulary can't say that directly, so a good answer routes resolution through
a responder action or a manual resolve rather than inventing a gate the
validator rejects.

## 3. Editorial pipeline (long lifecycle + escalation)

```text
A content editorial pipeline. A writer submits a pitch (title and one-line
idea). An AI produces an outline plus editorial metadata: target audience, tone,
and a list of suggested sections. A human approves the outline or sends it back
for revision; on revision the writer edits the pitch and the AI re-outlines,
escalating to a senior editor after 3 failed attempts. Once approved, the
writer drafts the article in a chat session with an AI co-writer. A second
human reviews the draft and either approves it for publication or sends it
back, limited to 2 revision rounds before escalation. Published is terminal.
```

Expect: a long multi-state lifecycle with human checkpoints at every stage,
`errorCountAtLeast` escalation loops, and an ai-chat drafting session. Every
state must have a way out (the structural-soundness warnings flag any that
don't).

## 4. Release train (git work + dependencies + bulk ops)

```text
A release train. A release manager creates a release with a title and a list of
feature cards. Each feature card becomes its own workflow instance that a
worker implements in a git repository: an isolated worktree is prepared, the
worker implements and commits the work, the work is verified committed, a
reviewer accepts or rejects, and accepted work merges. A card may depend on
other cards and cannot run until they are done. When all cards in the release
are accepted, the release is shipped. The release manager can approve all
remaining cards at once.
```

Expect: the git-work pattern (prepare_worktree → worker with git tools →
verify_workspace → review → merge_branch), `dependsOnState` for card
dependencies, and `dispatchToAll` for the bulk approve. This one most often
exposes vocabulary limits — "when all cards are accepted" needs a cross-instance
condition the gate vocabulary can't express, so a strong answer ships via a
manual action or leans on `dependsOnState`/`dispatchToAll`.

## 5. Meeting notes → action items (HITL chat + object[] + fan-out)

```text
A flow with two workflows. In the first, a human pastes meeting notes into a
chat session with an AI; the AI extracts action items from the notes. Each
action item becomes its own workflow instance with a title, an assignee, and a
due date, which a human marks done.
```

Expect: `startOnUserInput` ai-chat (the live transcript in the UI), `object[]`
completion output for the extracted items, and a `fanOut` edge creating one
instance per item. Strong test of the pipeline pattern — and where a sloppy
spec shows up fastest (e.g. forgetting the creation path, which the
"nothing ever creates an instance" warning now catches).

## 6. Vendor invoice approval (human review, financial domain)

```text
A flow for invoice approvals. An employee submits an invoice with the vendor
name and amount. An AI checks it against policy and recommends approve or
flag-for-review with a short reason. Invoices under a threshold can be approved
directly by the AI's recommendation; anything flagged or over the threshold
goes to a manager, who approves, rejects, or requests a correction (the
employee edits the invoice and resubmits, max 2 times). Approved invoices are
paid; rejected ones are closed.
```

Expect: a human-review lifecycle with a decision gate (`taskOutputEquals` on
the AI's recommendation) routing to auto-approve vs manager review, and a
bounded correction loop.

## 7. Recruiting pipeline (multi-stage, AI screening + human steps)

```text
A hiring pipeline. A recruiter adds a candidate with a resume summary and the
role they applied for. An AI screens the candidate: scores fit (1-5), flags
concerns, and suggests interview questions. The recruiter can either reject the
candidate or move them to a phone screen; after the screen the interviewer logs
notes in a chat session with an AI that drafts a structured summary. The final
stage is an interview panel decision: hire, no-hire, or hold (hold reopens the
candidate for a later round, max 2 holds).
```

Expect: a multi-stage lifecycle mixing ai-task screening (structured output),
ai-chat for the interview summary, and a bounded "hold" loop via
`errorCountAtLeast` or an explicit action counter.

## 8. Vague request (conversational-mode test)

```text
I want a flow for my team's requests.
```

Expect: **conversational mode only** — the agent should ask a few
design-relevant questions (what entity, who does what, where AI is used, what
happens on failure) instead of guessing. This is the test that distinguishes
conversational from lucky: lucky will make reasonable assumptions and build
something; conversational should not produce a spec until it has the answers.

## 9. Out-of-domain sanity check (genericity)

```text
A flow to track orders in a small bakery. Bakers submit an order with the
customer name and items. An AI suggests a pickup time and flags any
allergen-sensitive items. The baker confirms or edits the pickup time, then
marks the order ready; the customer picks it up and it's closed. If the AI
suggestion fails, a human sets the time manually.
```

Expect: the structured-intake/human-review shape applied to an unfamiliar
domain — the same lifecycle patterns, renamed nouns. Confirms generation is
domain-agnostic (not idea/card/ticket-shaped by default).

## Testing matrix

| Prompt | Exercises | Watch for |
| --- | --- | --- |
| 1 Ticket triage | structured intake, escape hatch | gate-clean baseline |
| 2 Incident response | 2 workflows, fan-out, HITL, cross-instance | how "all tasks done" is expressed |
| 3 Editorial pipeline | long lifecycle, escalation, ai-chat | no-way-out states |
| 4 Release train | git-work, dependsOnState, dispatchToAll | vocabulary limits |
| 5 Meeting notes | HITL chat, object[], fan-out | creation path |
| 6 Invoices | decision gate, bounded correction | threshold routing |
| 7 Recruiting | multi-stage, mixed AI roles, hold loop | bounded loops |
| 8 Vague request | conversational clarification | agent asks, doesn't guess |
| 9 Bakery orders | domain genericity | same patterns, new nouns |
