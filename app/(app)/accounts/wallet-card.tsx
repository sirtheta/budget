import type { WalletView } from "@/lib/crypto-wallets";
import { Money } from "@/components/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WalletStakesDialog } from "./wallet-stakes-dialog";
import { WalletFormDialog } from "./wallet-form-dialog";

/**
 * One physical wallet and who owns how much of it. The stake accounts keep
 * their own rows in the accounts list below — this card is where the split is
 * readable at a glance and where a top-up is entered.
 */
export function WalletCard({ wallet }: { wallet: WalletView }) {
  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>{wallet.name}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {wallet.totalBtc.toFixed(8)} BTC ·{" "}
            {wallet.rateChf === null ? (
              "Kurs n/a"
            ) : (
              <Money cents={wallet.totalValueCents} withCurrency />
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WalletStakesDialog wallet={wallet} />
          <WalletFormDialog wallet={{ id: wallet.id, name: wallet.name, notes: wallet.notes }} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ul className="divide-y text-sm">
          {wallet.stakes.map((stake) => (
            <li key={stake.accountId} className="flex items-start justify-between gap-2 py-2">
              <span className="flex items-center gap-2">
                {stake.name}
                {stake.excludeFromNetWorth && (
                  <Badge variant="secondary">Ausserhalb Vermögen</Badge>
                )}
              </span>
              <span className="text-right">
                <span className="tabular-nums">{stake.btcAmount.toFixed(8)} BTC</span>
                <span className="text-muted-foreground"> · {stake.sharePct.toFixed(1)} %</span>
                <br />
                <Money cents={stake.valueCents} withCurrency />
                {stake.gainLossCents !== null && (
                  <>
                    {" ("}
                    <Money cents={stake.gainLossCents} colored forceSign />
                    {")"}
                  </>
                )}
              </span>
            </li>
          ))}
          {wallet.stakes.length === 0 && (
            <li className="py-2 text-muted-foreground">
              Noch keine Anteile zugeordnet. Beim Bearbeiten eines Krypto-Kontos «Gehört zu
              Wallet» setzen.
            </li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}
