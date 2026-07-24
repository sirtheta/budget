import Link from "next/link";
import { requireSession } from "@/lib/permissions";
import { NavLinks } from "@/components/nav-links";
import { MobileNav } from "@/components/mobile-nav";
import { UserMenu } from "@/components/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { AppFooter } from "@/components/app-footer";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b bg-card sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex h-14 items-center justify-between gap-4">
          <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
            <MobileNav role={session.user.role} />
            <Link
              href="/dashboard"
              className="font-bold text-sm text-primary mr-3 shrink-0 hidden xl:block tracking-tight"
            >
              Haushaltsbudget
            </Link>
            <div className="hidden md:block overflow-x-auto">
              <NavLinks role={session.user.role} />
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            <UserMenu name={session.user.name ?? ""} email={session.user.email ?? ""} />
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</main>
      <AppFooter />
    </div>
  );
}
