/** Fixture shared by the Stoat simulator and the phase-3 harness (lab only). */

/** Test ULIDs (Crockford base32: no I, L, O, U). */
const ulid = (tag: string) => (tag + "0".repeat(26)).slice(0, 26);

const person = (letter: string, name: string, roles: string[] = []) => ({
  id: ulid(`01JPX${letter}`),
  name,
  roles,
  session: `lab-session-${letter.toLowerCase()}-0000000000`,
});

export const LAB = {
  server: ulid("01JSRV"),
  owner: ulid("01J0WNER"),
  botToken: "lab-bot-token-0000000000",
  rooms: {
    R1: ulid("01JRM1"), // open, 8 places
    R2: ulid("01JRM2"), // open, unlimited
    R3: ulid("01JRM3"), // private: role DIR only (absent from the bot's Ready)
    R4: ulid("01JRM4"), // open, 1 place
  },
  text: ulid("01JTXT"),
  people: {
    A: person("A", "Ana"),
    B: person("B", "Bia", ["DIR"]),
    C: person("C", "Caio"),
    D: person("D", "Davi"),
    E: person("E", "Eva", ["DIR"]),
  },
} as const;
