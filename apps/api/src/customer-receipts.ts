import { z } from "zod";
import { HttpError } from "./auth.ts";
import type { TenantState } from "./types.ts";

const detailsSchema = z
  .object({
    rfc: z
      .string()
      .max(32)
      .transform((s) => s.trim().toUpperCase())
      .pipe(
        z
          .string()
          .regex(
            /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/,
            "Enter an RFC with 12 or 13 characters.",
          ),
      ),
    legal_name: z.string().trim().min(1).max(200),
    postal_code: z.string().regex(/^\d{5}$/),
    tax_regime: z.string().regex(/^\d{3}$/),
    cfdi_use: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.string().regex(/^[A-Z]{1,2}\d{2}$/)),
    email: z.string().trim().email().max(254).optional(),
  })
  .strict();
const submissionSchema = z
  .object({ revision: z.number().int().nonnegative(), details: detailsSchema })
  .strict();
export interface BillingSubmission {
  revision: number;
  submitted_at: string;
  details: z.infer<typeof detailsSchema>;
}
export function billingSummary(state: TenantState, orderId: string) {
  const billing = state.order_metadata[orderId]?.billing;
  return {
    status: billing ? "DETAILS_RECEIVED" : "NOT_REQUESTED",
    revision: billing?.revision ?? 0,
    rfc_masked: billing
      ? "*".repeat(billing.details.rfc.length - 4) +
        billing.details.rfc.slice(-4)
      : null,
  };
}
export function saveBillingDetails(
  state: TenantState,
  orderId: string,
  body: unknown,
) {
  const input = submissionSchema.parse(body);
  const meta = state.order_metadata[orderId];
  if (!meta) throw new HttpError(404, "Order not found.");
  if (input.revision !== (meta.billing?.revision ?? 0))
    throw new HttpError(
      409,
      "Billing details changed. Refresh before replacing them.",
    );
  meta.billing = {
    revision: input.revision + 1,
    submitted_at: new Date().toISOString(),
    details: input.details,
  };
  return billingSummary(state, orderId);
}
