import {
  DEMO_CATALOG,
  type CatalogItem,
  type Order,
  type Operation,
} from "../../ring-orden-core/src/index.ts";
import {
  retrieveMemories,
  type CorrectionMemory,
} from "../../ring-orden-memory/src/index.ts";
export interface InterpretationResult {
  operations: Operation[];
  reply: string;
  correction?: {
    observed_text: string;
    previous_interpretation: Record<string, unknown>;
    corrected_interpretation: Record<string, unknown>;
  };
}
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,!?;:'’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export function isExplicitConfirmation(utterance: string): boolean {
  // Exact consent phrases only. Negation, questions and uncertain Chinese text fail closed.
  const chinese = utterance.trim().replace(/[，,。.!！\s]/g, "");
  if (/^(?:(?:是的|对))?(?:请)?(?:确认(?:订单|下单)|下单)$/.test(chinese)) return true;
  const text = normalize(utterance);
  return (
    /^(yes|si|correct|confirmed|looks good|yes please|si por favor|place my order)$/.test(
      text,
    ) ||
    /^(?:(?:yes|si) )?(?:confirm(?: my| the)? order|confirm(?:ar|o)?(?: (?:mi|el))?(?: pedido)?|that(?: is| s) (?:right|correct))(?: please| por favor)?$/.test(
      text,
    )
  );
}
const productPatterns: [string, RegExp][] = [
  [
    "chocolate_croissant",
    /\b(?:chocolate croissants?|choc croissants?|croissants? (?:de |con )?chocolate)\b/g,
  ],
  ["ube_croissant", /\b(?:ube croissants?|croissants? (?:de )?ube)\b/g],
  ["iced_latte", /\b(?:iced lattes?|lattes? (?:helados?|frios?)|late frio)\b/g],
  ["cappuccino", /\b(?:cappuccinos?|capuccinos?|capuchinos?)\b/g],
  ["americano", /\b(?:americanos?|american coffee)\b/g],
  ["latte", /\b(?:lattes?|lates?)\b/g],
  ["croissant", /\b(?:croissants?|cuernitos?)\b/g],
];
const modifiers: [string, RegExp][] = [
  ["oat_milk", /\b(?:oat|avena)\b/],
  ["almond_milk", /\b(?:almond|almendra)\b/],
  ["soy_milk", /\b(?:soy|soya)\b/],
  ["decaf", /\b(?:decaf|descafeinado)\b/],
  ["extra_shot", /\b(?:extra shot|extra espresso|shot extra|otro shot)\b/],
];
const count = (s: string) => {
  const a = [
    ...s.matchAll(
      /\b(\d+|one|two|three|four|five|six|ten|a|an|un|una|uno|dos|tres|cuatro|cinco|seis|diez)\b/g,
    ),
  ].at(-1)?.[1];
  const ns: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    ten: 10,
    a: 1,
    an: 1,
    un: 1,
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    diez: 10,
  };
  return a ? (ns[a] ?? Number(a)) : 1;
};
const drink = (id: string) => /latte|americano|cappuccino/.test(id);
function clarify(question: string): InterpretationResult {
  return {
    operations: [{ action: "request_clarification", question }],
    reply: question,
  };
}
function targets(text: string, order: Order, restrict?: string) {
  let lines = order.items.filter(
    (i) => !restrict || i.catalog_item_id === restrict,
  );
  if (/\b(latte|lattes|coffee|coffees|cafe|cafes)\b/.test(text))
    lines = lines.filter((i) => drink(i.catalog_item_id));
  if (
    /\b(both|all|ambos|ambas|todos|todas|los dos|las dos)\b/.test(text) &&
    !/\b(only|solo|just)\b/.test(text)
  )
    return lines;
  if (/\b(first|primero|primera|primer|1st)\b/.test(text))
    return lines.slice(0, 1);
  if (/\b(second|segundo|segunda|2nd)\b/.test(text)) return lines.slice(1, 2);
  if (/\b(third|tercero|tercera|3rd)\b/.test(text)) return lines.slice(2, 3);
  if (lines.length === 1) return lines;
  return [];
}
export function interpretDemo(
  utterance: string,
  order: Order,
  catalog: CatalogItem[] = DEMO_CATALOG,
  memories: CorrectionMemory[] = [],
): InterpretationResult {
  let text = normalize(utterance);
  if (!text) return clarify("What would you like to order?");
  if (
    /\b(human|person|manager|representative|humano|persona|gerente|dispute|reembolso)\b/.test(
      text,
    )
  )
    return {
      operations: [
        { action: "escalate_issue", reason: utterance.slice(0, 500) },
      ],
      reply: "I’ll ask the team to help you. Your order is saved.",
    };
  if (/\b(cancel|cancela|cancelar)\b/.test(text))
    return {
      operations: [{ action: "cancel_order" }],
      reply: "Your order has been cancelled.",
    };
  if (isExplicitConfirmation(utterance))
    return {
      operations: [{ action: "confirm_order", confirmed: true }],
      reply: "Your order is confirmed. I’ll get your payment link ready.",
    };
  const relevant = retrieveMemories(memories, {
    merchant_id: order.merchant_id,
    query: text,
    catalog_item_ids: catalog.map((i) => i.id),
    catalog,
  });
  for (const m of relevant) {
    const meaning = m.corrected_interpretation;
    const product = String(meaning.product ?? meaning.catalog_item_id ?? "");
    const mod = String(meaning.modifier ?? meaning.modifier_id ?? "");
    const item = catalog.find((i) => i.id === product);
    if (
      item &&
      modifiers.some(([id]) => id === mod) &&
      (/abena/.test(text) || text.includes(normalize(m.observed_text)))
    )
      text = text.replace(/abena/g, "avena");
    else if (item && !mod && text.includes(normalize(m.observed_text)))
      text = text.replace(normalize(m.observed_text), normalize(item.name));
  }
  if (/purple croissant/.test(text))
    return clarify("Do you mean the ube croissant?");
  // A narrowed scope repairs a previously applied shared modifier without guessing a new one.
  if (
    /\b(only|just|solo)\b/.test(text) &&
    /\b(first|second|primero|primera|segundo|segunda)\b/.test(text) &&
    !modifiers.some(([, p]) => p.test(text))
  ) {
    const drinks = order.items.filter((i) => drink(i.catalog_item_id));
    const selected = targets(text, { ...order, items: drinks });
    const shared =
      drinks.length > 1
        ? drinks[0].modifiers.filter((m) =>
            drinks.every((i) =>
              i.modifiers.some((x) => x.modifier_id === m.modifier_id),
            ),
          )
        : [];
    if (shared.length === 1 && selected.length === 1) {
      const operations: Operation[] = drinks
        .filter((i) => i.line_id !== selected[0].line_id)
        .map((i) => ({
          action: "remove_modifier",
          target: { line_id: i.line_id },
          modifier_id: shared[0].modifier_id,
        }));
      return {
        operations,
        reply: "Done — only that latte keeps the modifier.",
      };
    }
    if (drinks.length > 1)
      return clarify("Which change should apply only to that latte?");
  }
  const pending = normalize(order.clarification ?? "");
  const mods = modifiers
    .filter(([, pattern]) => pattern.test(text))
    .map(([id]) => id);
  // Follow-up answers carry the requested modifier in the persisted clarification.
  if (
    pending &&
    mods.length === 0 &&
    /\b(first|second|primero|primera|segundo|segunda|both|ambos)\b/.test(text)
  ) {
    const pendingMod = modifiers.find(
      ([id]) =>
        pending.includes(id.replace(/_/g, " ")) ||
        pending.includes(
          id === "extra_shot"
            ? "extra shot"
            : id === "oat_milk"
              ? "oat"
              : id === "decaf"
                ? "decaf"
                : id === "almond_milk"
                  ? "almond"
                  : "soy",
        ),
    )?.[0];
    if (pendingMod) mods.push(pendingMod);
  }
  if (
    /\b(no|actually|instead|make|change|both|only|just|cambia|pon|solo|ambos|quita)\b/.test(
      text,
    ) ||
    mods.length > 0 ||
    pending
  ) {
    const productMentions = productPatterns.filter(([, p]) =>
      new RegExp(p.source).test(text),
    );
    const isNew =
      /\b(?:add|another|want|give|order|dame|quiero|regalas|ponme|echame)\b/.test(
        text,
      ) && productMentions.length > 0;
    const obviousNew = order.items.length === 0 || isNew;
    if (!obviousNew) {
      const regular = /\b(regular|normal|whole|dairy|vaca|entera)\b/.test(text);
      if (mods.length || regular) {
        const requested = mods.length ? mods[0] : "regular milk";
        const onlyDrinks = {
          ...order,
          items: order.items.filter((i) => drink(i.catalog_item_id)),
        };
        const selected = targets(text, onlyDrinks);
        if (!selected.length)
          return clarify(
            `Which latte would you like ${requested.replace(/_/g, " ")} in — the first, the second, or both?`,
          );
        const operations: Operation[] = [];
        let correction: InterpretationResult["correction"];
        for (const line of selected) {
          if (regular) {
            for (const m of line.modifiers.filter((m) =>
              /milk$/.test(m.modifier_id),
            ))
              operations.push({
                action: "remove_modifier",
                target: { line_id: line.line_id },
                modifier_id: m.modifier_id,
              });
          }
          for (const modifier_id of mods) {
            const isMilk = /milk$/.test(modifier_id);
            const previous = line.modifiers.find((m) =>
              /milk$/.test(m.modifier_id),
            );
            if (isMilk) {
              for (const m of line.modifiers.filter(
                (m) =>
                  /milk$/.test(m.modifier_id) && m.modifier_id !== modifier_id,
              ))
                operations.push({
                  action: "remove_modifier",
                  target: { line_id: line.line_id },
                  modifier_id: m.modifier_id,
                });
            }
            operations.push({
              action: "add_modifier",
              target: { line_id: line.line_id },
              modifier_id,
            });
            if (
              /\b(no|actually|instead|quise|dije|avena)\b/.test(text) &&
              previous?.modifier_id !== modifier_id &&
              isMilk
            ) {
              correction = {
                observed_text: pending.includes("abena") ? "abena" : utterance,
                previous_interpretation: {
                  product: line.catalog_item_id,
                  modifier: previous?.modifier_id ?? "unresolved",
                },
                corrected_interpretation: {
                  product: line.catalog_item_id,
                  modifier: modifier_id,
                },
              };
            }
          }
        }
        return {
          operations,
          reply: regular
            ? "Done — regular milk for that latte. Anything else?"
            : `Done — ${mods.map((m) => m.replace(/_/g, " ")).join(" and ")} added. Anything else?`,
          ...(correction ? { correction } : {}),
        };
      }
    }
  }
  if (/\b(remove|take|off|delete|quita|quitar|elimina|sin)\b/.test(text)) {
    const matches = productPatterns.filter(([, p]) =>
      new RegExp(p.source).test(text),
    );
    const id = matches[0]?.[0];
    const selection = id
      ? order.items.filter((i) => i.catalog_item_id === id)
      : targets(text, order);
    if (!selection.length)
      return clarify("Which item would you like me to remove?");
    return {
      operations: selection.map((i) => ({
        action: "remove_item",
        target: { line_id: i.line_id },
      })),
      reply: "Removed. Anything else?",
    };
  }
  if (
    /\b(i said|make that|quantity|cantidad|dije|sean|cambia a)\b/.test(text) &&
    /\b(two|three|dos|tres|[1-9])\b/.test(text)
  ) {
    const selected = targets(text, order);
    if (!selected.length)
      return clarify("Which item should I change the quantity of?");
    return {
      operations: [
        {
          action: "change_quantity",
          target: { line_id: selected[0].line_id },
          quantity: count(text),
        },
      ],
      reply: "Quantity updated. Anything else?",
    };
  }
  if (/\b(my name is|mi nombre es|me llamo)\b/.test(text))
    return {
      operations: [
        {
          action: "set_customer_name",
          name: utterance
            .replace(/.*(?:my name is|mi nombre es|me llamo)\s*/i, "")
            .trim()
            .slice(0, 100),
        },
      ],
      reply: "Thank you. Anything else for your order?",
    };
  const found: { id: string; start: number; end: number }[] = [];
  for (const [id, pattern] of productPatterns) {
    for (const match of text.matchAll(new RegExp(pattern.source, "g"))) {
      const start = match.index!;
      const end = start + match[0].length;
      if (!found.some((f) => start < f.end && end > f.start))
        found.push({ id, start, end });
    }
  }
  found.sort((a, b) => a.start - b.start);
  if (found.length) {
    const operations: Operation[] = [];
    for (let i = 0; i < found.length; i++) {
      const p = found[i];
      const item = catalog.find((c) => c.id === p.id);
      if (!item)
        return clarify(
          "That item is not on today’s menu. Would you like a latte or a croissant?",
        );
      if (!item.available)
        return clarify(
          `${item.name} is currently unavailable. Would you like another item?`,
        );
      const prefix = text.slice(i ? found[i - 1].end : 0, p.start);
      const suffix = text.slice(
        p.end,
        i + 1 < found.length ? found[i + 1].start : text.length,
      );
      const qty = count(prefix);
      const allMods = drink(p.id)
        ? mods.filter((id) => item.modifiers.some((m) => m.id === id))
        : [];
      if (
        qty > 1 &&
        /\b(uno|one|first|primero|primera)\b/.test(suffix) &&
        allMods.length
      ) {
        operations.push(
          {
            action: "add_item",
            catalog_item_id: p.id,
            quantity: 1,
            modifier_ids: allMods,
          },
          { action: "add_item", catalog_item_id: p.id, quantity: qty - 1 },
        );
      } else
        operations.push({
          action: "add_item",
          catalog_item_id: p.id,
          quantity: qty,
          modifier_ids: allMods,
        });
    }
    if (/abena/.test(text) && !relevant.length) {
      const question = "Did you mean oat milk for “abena”?";
      operations.push({ action: "request_clarification", question });
      return { operations, reply: question };
    }
    return {
      operations,
      reply: `Added ${found.map((p) => catalog.find((c) => c.id === p.id)?.name).join(" and ")}. Anything else, or shall I confirm your order?`,
    };
  }
  if (
    /^(done|that s all|that is all|listo|es todo|nothing else|no more|finish)$/.test(
      text,
    )
  )
    return {
      operations: [],
      reply: "Please review your order and say “confirm my order” to place it.",
    };
  return clarify(
    "I can help with coffee and pastries from today’s menu. What would you like?",
  );
}
