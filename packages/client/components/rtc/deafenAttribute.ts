/** LiveKit attribute used to broadcast deafen (headset-off) to the room. */
export const VOICE_DEAFENED_ATTR = "muchat.deafened";

export function isDeafenedAttribute(
  attributes: Record<string, string> | undefined,
): boolean {
  return attributes?.[VOICE_DEAFENED_ATTR] === "true";
}

export function deafenAttributeValue(deafened: boolean): string {
  return deafened ? "true" : "false";
}
