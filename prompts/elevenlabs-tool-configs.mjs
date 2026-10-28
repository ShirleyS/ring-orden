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
      "Start one new empty order after the caller says they want to order. Never copy a previous order or favorite merely from a caller-ID match. Ask the caller to confirm any saved display_name before using it. Call this once per conversation before changes and reuse its returned session ID for every later order tool.",
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
    name: "apply_order_operations",
    description:
      "Apply structured changes you understood from the caller to the existing draft. Fetch get_menu first and use only its exact item/modifier IDs. RingOrden validates availability and calculates prices. Use confirm_order separately after a full readback and explicit consent. Never substitute unavailable items without asking.",
    body: {
      type: "object",
      properties: {
        session_id: sessionId,
        utterance: utterance(
          "The caller's exact words requesting these changes.",
        ),
        request_id: requestId,
        operations_json: {
          type: "string",
          description:
            'A JSON array of operations. Allowed shapes: {"action":"add_item","catalog_item_id":"ID","quantity":1,"modifier_ids":["ID"]}; {"action":"remove_item","target":{"line_id":"ORDER_LINE_ID"}}; {"action":"modify_item","target":{"line_id":"ORDER_LINE_ID"},"changes":{"quantity":1,"modifier_ids":["ID"]}}; {"action":"set_customer_name","name":"NAME"}; {"action":"set_fulfillment","fulfillment_type":"pickup"}; {"action":"set_pickup_time","scheduled_for":"ISO-8601"}; {"action":"add_note","note":"TEXT"}; {"action":"request_clarification","question":"TEXT"}. Never include prices, totals, or confirm_order. If IDs or intent are unclear, ask a question.',
        },
      },
      required: ["session_id", "utterance", "request_id", "operations_json"],
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

const scopedTool = (name, description, properties = {}, required = []) => ({
  name,
  description,
  body: {
    type: "object",
    properties: { session_id: sessionId, ...properties },
    required: ["session_id", ...required],
    additionalProperties: false,
  },
});
definitions.push(
  scopedTool(
    "get_customer_context",
    "Read minimal permitted customer context for this session. Caller recognition is not verification.",
  ),
  scopedTool(
    "get_customer_preferences",
    "Read saved explicit preferences and inferred suggestions; obey redaction and verification_required.",
  ),
  scopedTool(
    "update_customer_preference",
    "Save a permanent preference only after the caller explicitly confirms; verified identity is required. One-time order instructions belong in process_order_turn.",
    {
      preference_key: {
        type: "string",
        description: "A bounded preference key, for example milk or sweetness.",
      },
      preference_value: {
        type: "string",
        description:
          "The customer's confirmed preference, not an inferred assumption.",
      },
      scope: { type: "string", enum: ["permanent"] },
      confirmed: { type: "boolean" },
    },
    ["preference_key", "preference_value", "scope", "confirmed"],
  ),
  scopedTool(
    "get_previous_orders",
    "Read verified customer order history. A caller phone match alone does not authorize history.",
    {
      mode: { type: "string", enum: ["recent", "most_recent", "frequent"] },
      limit: { type: "integer", minimum: 1, maximum: 20 },
    },
  ),
  scopedTool(
    "reorder_previous_order",
    "Create a separate repriced draft from a verified completed order. Never submits; read back and obtain confirmation before confirm_order.",
    {
      order_id: {
        type: "string",
        description:
          "An authorized previous order ID returned by get_previous_orders.",
      },
    },
    ["order_id"],
  ),
  scopedTool(
    "get_billing_profile_status",
    "Check whether billing profiles exist without exposing RFC or fiscal details.",
  ),
  scopedTool(
    "request_invoice",
    "Create a pending invoice request for an eligible paid order and verified billing profile. Never claim CFDI issued unless issued:true.",
    {
      order_id: { type: "string" },
      profile_id: { type: "string" },
      confirmed: {
        type: "boolean",
        description:
          "True only after the customer explicitly requests and confirms this invoice request.",
      },
    },
    ["order_id", "confirmed"],
  ),
  scopedTool(
    "verify_customer",
    "Initiate verification through a secure WhatsApp link only after consent. QUEUED does not mean delivered. Never ask the caller to read a secret aloud.",
    {
      consent: {
        type: "boolean",
        description:
          "True only if the caller explicitly agreed to receive this verification link on WhatsApp.",
      },
    },
  ),
  scopedTool(
    "customer_followup",
    "Queue a WhatsApp secure form link after explicit consent: billing for RFC, receipt for completed/confirmed order, recovery for the exact partial order within ten minutes. Report actual queue/provider status.",
    {
      purpose: { type: "string", enum: ["billing", "receipt", "recovery"] },
      consent: { type: "boolean" },
    },
    ["purpose", "consent"],
  ),
  scopedTool(
    "set_customer_followup_consent",
    "Record explicit permission for a WhatsApp receipt when completed, or a ten-minute recovery link if this call ends with an unfinished order. This schedules permission; it does not claim a message was sent.",
    {
      purpose: { type: "string", enum: ["receipt", "recovery"] },
      consent: { type: "boolean" },
      utterance: {
        type: "string",
        description:
          "The customer's exact words agreeing to or declining this specific follow-up.",
      },
    },
    ["purpose", "consent", "utterance"],
  ),
  scopedTool(
    "customer_link",
    "Issue the existing customer order link without sending a message. Prefer customer_followup for consent-aware WhatsApp delivery.",
  ),
);

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

// ElevenLabs uses a restricted JSON-schema dialect, not arbitrary OpenAPI keywords.
function providerSchema(schema, key = "body") {
  const {
    type,
    description,
    dynamic_variable,
    properties,
    required,
    items,
    enum: values,
  } = schema;
  const result = { type };
  if (dynamic_variable) result.dynamic_variable = dynamic_variable;
  else if (description) result.description = description;
  else if (!properties && !items)
    result.description =
      key === "confirmed"
        ? "True only when the caller explicitly confirmed this exact request; otherwise false. Never invent confirmation."
        : `The ${key.replaceAll("_", " ")} explicitly provided or requested by the caller. Omit optional values that are unknown.`;
  if (values) result.enum = values;
  if (properties)
    result.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [
        key,
        providerSchema(value, key),
      ]),
    );
  if (required) result.required = required;
  if (items) result.items = providerSchema(items);
  return result;
}

export function buildElevenLabsToolConfigs({ apiOrigin, secretId }) {
  if (!secretId?.trim())
    throw new Error("An ElevenLabs workspace secret ID is required.");
  const origin = safeOrigin(apiOrigin);
  return definitions.map(({ name, description, body, assignments = [] }) => ({
    type: "webhook",
    name,
    description,
    api_schema: {
      url: `${origin}/api/tools/${name}`,
      method: "POST",
      path_params_schema: {},
      query_params_schema: null,
      request_body_schema: providerSchema(body),
      request_headers: {
        Authorization: { secret_id: secretId },
        "Content-Type": "application/json",
      },
    },
    assignments:
      name === "reorder_previous_order"
        ? [
            {
              dynamic_variable: "ring_orden_session_id",
              value_path: "session_id",
              source: "response",
              sanitize: true,
              preserve_native_type: false,
            },
          ]
        : assignments,
    dynamic_variables: {
      dynamic_variable_placeholders: { ring_orden_session_id: "UNSET" },
    },
    response_timeout_secs: name === "process_order_turn" ? 45 : 20,
  }));
}

/** The dashboard JSON editor uses its own complete form representation. */
export function buildElevenLabsFormToolConfigs(options) {
  return buildElevenLabsToolConfigs(options).map((tool) => {
    const schema = tool.api_schema.request_body_schema;
    const properties = Object.entries(schema.properties).map(([id, value]) => ({
      id,
      type: Array.isArray(value.type) ? value.type[0] : value.type,
      value_type: value.dynamic_variable ? "dynamic_variable" : "llm_prompt",
      description:
        value.description ||
        (id === "confirmed"
          ? "True only after the caller explicitly confirms the current request; otherwise false."
          : `The ${id.replaceAll("_", " ")} for this exact operation.`),
      dynamic_variable: value.dynamic_variable || "",
      constant_value: "",
      enum: value.enum || null,
      is_system_provided: false,
      required: schema.required.includes(id),
    }));
    if (!properties.length)
      properties.push({
        id: "request_context",
        type: "string",
        value_type: "llm_prompt",
        description: "Optional operation marker; it may be omitted.",
        dynamic_variable: "",
        constant_value: "",
        enum: null,
        is_system_provided: false,
        required: false,
      });
    return {
      ...tool,
      disable_interruptions: false,
      force_pre_tool_speech: false,
      interruption_mode: "allow",
      pre_tool_speech: "auto",
      tool_call_sound: null,
      tool_call_sound_behavior: "auto",
      tool_error_handling_mode: "auto",
      execution_mode: "immediate",
      follow_redirects: false,
      follow_redirects_allowed_domains: [],
      api_schema: {
        ...tool.api_schema,
        request_body_schema: {
          id: "body",
          type: "object",
          description:
            "Supply only documented inputs for this authenticated operation.",
          properties,
          required: schema.required.length > 0,
          dynamic_variable: "",
          value_type: "llm_prompt",
        },
        request_headers: [
          {
            type: "secret",
            name: "Authorization",
            secret_id: options.secretId,
          },
        ],
        content_type: "application/json",
        auth_connection: null,
        mtls_auth_connection: null,
        response_filter: null,
      },
      dynamic_variables: { dynamic_variable_placeholders: {} },
      response_mocks: [],
    };
  });
}
