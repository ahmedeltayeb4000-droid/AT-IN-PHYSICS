type SignOutOperation = Readonly<{
  signOut: () => Promise<void>;
  navigateHome: () => void;
  setPending: (pending: boolean) => void;
  reportError: (error: unknown) => void;
}>;

export async function runSignOutOperation({
  signOut,
  navigateHome,
  setPending,
  reportError,
}: SignOutOperation) {
  setPending(true);
  try {
    await signOut();
    navigateHome();
  } catch (error) {
    reportError(error);
  } finally {
    setPending(false);
  }
}
