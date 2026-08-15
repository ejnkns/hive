/** The authoring tools' shared result helpers: the error shape the
 * definition/file tools return. Only flow-authoring/session/tools/* import from here. */

// The shared error result shape for the authoring tools.
export function toolError(
  call: { id: string },
  message: string
): {
  toolCallId: string;
  content: string;
  isError: boolean;
} {
  return { toolCallId: call.id, content: message, isError: true };
}
