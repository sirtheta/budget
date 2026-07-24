"use client";

import { useActionState } from "react";
import { toast } from "sonner";

export type FormState = { error?: string; success?: boolean } | undefined;

/**
 * Wires a Server Action into a dialog form, handling the success toast and
 * closing the dialog.
 *
 * The success handling lives inside the action rather than in an effect keyed
 * on the returned state. An effect would fire on every state identity change
 * (React warns about the cascading render it causes) and could close the
 * dialog again on an unrelated re-render; here it runs exactly once per
 * successful submit.
 */
export function useDialogFormAction(
  action: (prev: FormState, formData: FormData) => Promise<FormState>,
  { onSuccess, successMessage }: { onSuccess: () => void; successMessage: string }
) {
  return useActionState<FormState, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result?.success) {
      toast.success(successMessage);
      onSuccess();
    }
    return result;
  }, undefined);
}
