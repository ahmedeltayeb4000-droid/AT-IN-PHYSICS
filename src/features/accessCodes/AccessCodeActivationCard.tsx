import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/Button";
import { GlassCard } from "../../components/ui/Card";
import { Input } from "../../components/ui/FormControls";
import { redeemAccessCode } from "./accessCodeRedemption";

type ActivationState =
  | { readonly kind: "idle" }
  | { readonly kind: "success"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

const INVALID_CODE_MESSAGE =
  "We could not activate a course with that Access Code. Check the code and try again.";

export function AccessCodeActivationCard() {
  const queryClient = useQueryClient();
  const inputReference = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [state, setState] = useState<ActivationState>({ kind: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setState({ kind: "idle" });
    try {
      const result = await redeemAccessCode(code);
      setCode("");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["enrollments", "user"],
        }),
        queryClient.invalidateQueries({ queryKey: ["courses", "published"] }),
      ]);
      setState({
        kind: "success",
        message:
          result.enrollmentState === "already-redeemed-by-you"
            ? "This course is already activated on your account."
            : "Course activated successfully.",
      });
    } catch {
      setState({ kind: "error", message: INVALID_CODE_MESSAGE });
      inputReference.current?.focus();
    } finally {
      setIsSubmitting(false);
    }
  }

  const statusId = "access-code-activation-status";

  return (
    <GlassCard className="mt-8 p-6">
      <h2 className="text-xl font-bold text-text">Activate Course</h2>
      <p className="mt-2 text-sm text-text-muted">
        Enter the Access Code provided for your course.
      </p>
      <form
        className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-end"
        onSubmit={handleSubmit}
      >
        <Input
          ref={inputReference}
          id="access-code"
          name="accessCode"
          label="Access Code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          disabled={isSubmitting}
          aria-describedby={statusId}
          className="font-mono uppercase tracking-wide"
        />
        <Button
          type="submit"
          isLoading={isSubmitting}
          disabled={isSubmitting || !code.trim()}
          className="sm:min-w-32"
        >
          {isSubmitting ? "Activating..." : "Activate"}
        </Button>
      </form>
      <p
        id={statusId}
        className={`mt-4 min-h-5 text-sm ${
          state.kind === "error"
            ? "text-danger"
            : state.kind === "success"
              ? "text-emerald-400"
              : "text-text-muted"
        }`}
        role={state.kind === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {state.kind === "idle" ? "" : state.message}
      </p>
    </GlassCard>
  );
}
