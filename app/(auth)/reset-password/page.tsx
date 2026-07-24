import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AppFooter } from "@/components/app-footer";
import { ResetPasswordForm } from "./reset-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <div className="flex flex-1 items-center justify-center p-4">
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>Ungültiger Link</CardTitle>
              <CardDescription>
                Diesem Link fehlt das Token. Bitte fordere einen neuen Zurücksetzungslink an.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/forgot-password">Neuen Link anfordern</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
      <AppFooter />
    </div>
  );
}
