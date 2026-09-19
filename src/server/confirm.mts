/**
 * Asking the user before a gated action.
 *
 * Three routes, tried in order:
 *
 * 1. The agent already carried an exact confirmation phrase in the call. This
 *    is the route that works in any client, including one with no interactive
 *    surface at all.
 * 2. MCP elicitation, where the server asks the user directly. This is the good
 *    one: a real prompt, answered by a person.
 * 3. Neither is available, so the action is refused with an explanation.
 *
 * Route 3 refuses rather than proceeding. A gate that quietly opens when it
 * cannot ask anyone is not a gate.
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export type ConfirmRequest = {
  tool: string;
  reason: string;
  risk: string;
  phrase: string;
  matches: string[];
  /** One line describing what is about to happen, shown to the user. */
  summary: string;
  /** The phrase the agent supplied with the call, if any. */
  suppliedPhrase?: string | undefined;
};

export type ConfirmOutcome = {
  approved: boolean;
  /** How the decision was reached, for the audit trail. */
  via: "phrase" | "elicitation" | "unavailable";
  message: string;
};

/**
 * Risks that demand the exact phrase even when a friendly prompt is available.
 * Reserved for actions that cannot be undone.
 */
const PHRASE_REQUIRED_RISKS = new Set(["irreversible"]);

export async function requestConfirmation(
  server: Server,
  request: ConfirmRequest,
): Promise<ConfirmOutcome> {
  if (request.suppliedPhrase !== undefined) {
    if (request.suppliedPhrase === request.phrase) {
      return {
        approved: true,
        via: "phrase",
        message: "Confirmed with the exact phrase.",
      };
    }

    return {
      approved: false,
      via: "phrase",
      message: `The confirmation phrase did not match. It must be exactly: ${request.phrase}`,
    };
  }

  const supportsElicitation = server.getClientCapabilities()?.elicitation !== undefined;
  if (!supportsElicitation) {
    return {
      approved: false,
      via: "unavailable",
      message: buildManualInstructions(request),
    };
  }

  const needsPhrase = PHRASE_REQUIRED_RISKS.has(request.risk);

  try {
    const result = await server.elicitInput({
      mode: "form",
      message: buildPrompt(request, needsPhrase),
      requestedSchema: {
        type: "object",
        properties: needsPhrase
          ? {
              phrase: {
                type: "string",
                title: "Confirmation phrase",
                description: `Type exactly: ${request.phrase}`,
              },
            }
          : {
              decision: {
                type: "string",
                title: "Allow this action?",
                enum: ["allow", "deny"],
                description: "Choose allow only if you want this to happen now.",
              },
            },
        required: needsPhrase ? ["phrase"] : ["decision"],
      },
    });

    if (result.action !== "accept") {
      return {
        approved: false,
        via: "elicitation",
        message: `You ${result.action === "decline" ? "declined" : "cancelled"} this action.`,
      };
    }

    if (needsPhrase) {
      const typed = result.content?.phrase;
      if (typed !== request.phrase) {
        return {
          approved: false,
          via: "elicitation",
          message: `The confirmation phrase did not match. It must be exactly: ${request.phrase}`,
        };
      }

      return { approved: true, via: "elicitation", message: "Confirmed." };
    }

    const decision = result.content?.decision;
    return decision === "allow"
      ? { approved: true, via: "elicitation", message: "Allowed." }
      : { approved: false, via: "elicitation", message: "You denied this action." };
  } catch (error) {
    // A client can advertise elicitation and still fail the request. Refusing
    // is the safe direction.
    return {
      approved: false,
      via: "unavailable",
      message: `Could not ask for confirmation (${(error as Error).message}). ${buildManualInstructions(request)}`,
    };
  }
}

function buildPrompt(request: ConfirmRequest, needsPhrase: boolean): string {
  const lines = [
    `Computer Custom wants to run: ${request.tool}`,
    request.summary,
    `Why this is gated: ${request.reason}`,
  ];

  if (request.matches.length > 0) {
    lines.push(`Matched rule: ${request.matches.join(", ")}`);
  }

  if (needsPhrase) {
    lines.push("This cannot be undone.");
  }

  return lines.join("\n");
}

function buildManualInstructions(request: ConfirmRequest): string {
  return [
    `This action is gated (${request.reason}).`,
    "This client cannot show a confirmation prompt.",
    `Ask the user to reply with exactly: ${request.phrase}`,
    `Then repeat the identical call with confirm: "${request.phrase}".`,
    "Never supply that phrase yourself.",
  ].join(" ");
}
