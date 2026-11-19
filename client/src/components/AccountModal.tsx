import { UserRound } from "lucide-react";

export default function AccountLauncher() {
  return (
    <a
      className="account-launcher"
      href="/account"
      aria-label="Account information"
    >
      <UserRound size={15} />
      <span>Account</span>
    </a>
  );
}
