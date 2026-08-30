import { auth0 } from "@/lib/auth0";

export default async function HomePage() {
  const session = await auth0.getSession();

  return (
    <main>
      <span className="badge">TEST MODE</span>
      <h1>Connect your AI to Counter</h1>
      <p className="lede">
        Sign in once and get a real wallet, a real signing key generated on your own machine, and a
        one-command way to let any AI tool make a real (test-money) purchase on your behalf. Your
        private key never leaves your computer — Counter never holds it.
      </p>
      {session === null ? (
        <a className="button" href="/auth/login?returnTo=/connect">
          Sign up / Log in
        </a>
      ) : (
        <a className="button" href="/connect">
          Continue to Connect your AI
        </a>
      )}
    </main>
  );
}
