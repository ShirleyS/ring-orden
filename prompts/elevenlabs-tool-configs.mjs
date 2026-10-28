const sessionId = {
  type: "string",
  dynamic_variable: "ring_orden_session_id",
};
const requestId = {
  type: "string",
  description:
    "Create a fresh unique ID for this exact operation. If the same operation is retried, reuse the identical ID and request body.",
  minLength: 1,
  maxLength: 200,
};
const utterance = (description) => ({
  type: "string",
  description,
  minLength: 1,
  maxLength: 1500,
});
const emptyBody = { type: "object", properties: {}, required: [] };

const definitions = [
  {
    name: "create_session",
    description:
      "Start one new order conversation after the caller says they want to order. Call this once per conversation before any order changes, and reuse its returned session ID for every later order tool.",
    body: {
      type: "object",
      properties: {
        request_id: {
          type: "string",
          dynamic_variable: "system__conversation_id",
          minLength: 1,
          maxLength: 200,
        },
        phone: {
          type: ["string", "null"],
          dynamic_variable: "system__caller_id",
          pattern: "^\\+\\d{8,15}$",
        },
        name: {
          type: "string",
          description:
            "The customer's name only if they explicitly gave it; otherwise omit this field.",
          maxLength: 120,
        },
      },
      required: ["request_id"],
      additionalProperties: false,
    },
    assignments: [
      {
        dynamic_variable: "ring_orden_session_id",
        value_path: "session_id",
        source: "response",
        sanitize: true,
        preserve_native_type: false,
      },
    ],
  },
  {
    name: "get_business_info",
    description:
      "Read this restaurant's current name, address, hours, ordering rules, language, and pickup timing. Use before answering business questions; do not guess these details.",
    body: emptyBody,
  },
  {
    name: "get_menu",
    description:
      "Read this restaurant's authoritative menu, prices, modifiers, and availability before answering menu questions or adding items to an order.",
    body: emptyBody,
  },
  {
    name: "get_order_state",
    description:
      "Recover the latest saved order and authoritative total for the active call. Use before reading back or confirming an order.",
    body: {
      type: "object",
      properties: { session_id: sessionId },
      required: ["session_id"],
      additionalProperties: false,
    },
  },
  {
    name: "process_order_turn",
    description:
      "Apply the caller's exact latest order words to the active saved order. Call for each new ordering utterance; ask the caller any clarification returned by the server, and never invent a price or availability.",
    body: {
      type: "object",
      properties: {
        session_id: sessionId,
        utterance: utterance(
          "The customer's exact latest words about their order; do not paraphrase or add intent they did not express.",
        ),
        request_id: requestId,
      },
      required: ["session_id", "utterance", "request_id"],
      additionalProperties: false,
    },
  },
  {
    name: "confirm_order",
    description:
      "Submit the order only after you have read the final server-generated items and total to the caller and they clearly agreed. Include their exact consent words.",
    body: {
      type: "object",
      properties: {
        session_id: sessionId,
        utterance: utterance(
          "The caller's exact current consent words after hearing the complete order summary and total.",
        ),
        confirmed: { type: "boolean", constant_value: true },
        request_id: requestId,
      },
      required: ["session_id", "utterance", "confirmed", "request_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_pickup_options",
    description:
      "Read the current estimated pickup time for the active order before promising a pickup time.",
    body: {
      type: "object",
      properties: { session_id: sessionId },
      required: ["session_id"],
      additionalProperties: false,
    },
  },
  {
    name: "request_human",
    description:
      "Create a callback escalation when the caller asks for a person or needs help beyond your authority. Use the caller's stated reason and do not claim a live transfer is available.",
    body: {
      type: "object",
      properties: {
        session_id: sessionId,
        reason: {
          type: "string",
          description: "Why the caller asked for a person or human assistance.",
        },
        request_id: requestId,
      },
      required: ["session_id", "reason", "request_id"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate_issue",
    description:
      "Preserve a payment dispute, unsupported request, or repeated misunderstanding for the restaurant team to review and call back about.",
    body: {
      type: "object",
      properties: {
        session_id: sessionId,
        reason: {
          type: "string",
          description: "The unresolved issue as explained by the caller.",
        },
        request_id: requestId,
      },
      required: ["session_id", "reason", "request_id"],
      additionalProperties: false,
    },
  },
];

function safeOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("API origin must be a clean HTTPS origin.");
  return url.origin;
}

export function buildElevenLabsToolConfigs({ apiOrigin, secretId }) {
  if (!secretId?.trim()) throw new Error("An ElevenLabs workspace secret ID is required.");
  const origin = safeOrigin(apiOrigin);
  return definitions.map(({ name, description, body, assignments = [] }) => ({
    type: "webhook",
    name,
    description,
    api_schema: {
      url: `${origin}/api/tools/${name}`,
      method: "POST",
      path_params_schema: [],
      query_params_schema: [],
      request_body_schema: structuredClone(body),
      request_headers: {
        Authorization: { secret_id: secretId },
        "Content-Type": "application/json",
      },
    },
    assignments,
    dynamic_variables: {
      dynamic_variable_placeholders: { ring_orden_session_id: "UNSET" },
    },
    response_timeout_secs: name === "process_order_turn" ? 45 : 20,
  }));
}
